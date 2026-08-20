import { spawn } from "node:child_process";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type {
  AgentInvocationOutcome,
  AgentInvocationService,
} from "@designflow/sdk";
import type { FreshFrameEvidence } from "./fresh-figma-evidence";
import type { FreshScaffoldResult } from "./fresh-project-scaffolder";

export interface FreshUiBuilderInput {
  readonly evidence: unknown;
  readonly frame: {
    readonly id: string;
    readonly name: string;
    readonly width: number;
    readonly height: number;
  };
  readonly fixedStack: readonly ["Vite", "React", "TypeScript", "Plain CSS"];
  readonly allowedWritePaths: readonly string[];
  readonly currentFiles?: Readonly<Record<string, string>>;
  readonly buildFailure?: {
    readonly stdout: string;
    readonly stderr: string;
    readonly exitCode?: number;
  };
}

export interface FreshUiBuilderProposal {
  readonly files: readonly {
    readonly path: string;
    readonly action: "create" | "modify";
    readonly content: string;
    readonly reason: string;
    readonly relatedDesignNodeIds: readonly string[];
  }[];
  readonly assumptions: readonly string[];
  readonly unresolvedItems: readonly string[];
  readonly unexecutableReason?: string | null;
}

const MAX_FILES = 16;
const MAX_FILE_BYTES = 500_000;
const MAX_TOTAL_BYTES = 2_000_000;
const MAX_BUILD_OUTPUT = 16_000;
const BUILD_TIMEOUT_MS = 60_000;
const ALLOWED_FILES = new Set(["src/App.tsx", "src/styles.css"]);

export interface FreshBuildResult {
  readonly passed: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
}

export interface FreshGenerationRequest {
  readonly evidence: FreshFrameEvidence;
  readonly scaffold: FreshScaffoldResult;
  readonly invokeBuilder: (
    input: FreshUiBuilderInput,
    signal?: AbortSignal,
  ) => Promise<unknown>;
  readonly runBuild?: (targetPath: string, signal?: AbortSignal) => Promise<FreshBuildResult>;
  readonly installDependencies?: (targetPath: string, signal?: AbortSignal) => Promise<FreshBuildResult>;
  readonly signal?: AbortSignal;
}

/** Invoke the already-wired agent runtime without making it a CLI concern. */
export async function invokeFreshUiBuilder(
  runtime: AgentInvocationService,
  input: FreshUiBuilderInput,
  signal?: AbortSignal,
): Promise<unknown> {
  const outcome: AgentInvocationOutcome = await runtime.invoke({
    agentId: "fresh-ui-builder-agent",
    objective: "Generate the first buildable Fresh UI implementation from authoritative Figma evidence.",
    input,
    attempt: input.buildFailure === undefined ? 1 : 2,
  }, signal);
  if (outcome.type === "failure") {
    throw Object.assign(new Error(outcome.message), { code: outcome.code });
  }
  return outcome.output;
}

export interface FreshGenerationResult {
  readonly targetPath: string;
  readonly generatedFiles: readonly string[];
  readonly build: FreshBuildResult;
  readonly repairAttempts: number;
}

export class FreshGenerationError extends Error {
  public constructor(
    public readonly code:
      | "ERR_FRESH_UI_AI_UNAVAILABLE"
      | "ERR_FRESH_UI_AI_QUOTA"
      | "ERR_FRESH_UI_AI_TIMEOUT"
      | "ERR_FRESH_UI_BUILDER_RESPONSE"
      | "ERR_FRESH_UI_PROPOSAL_DISALLOWED"
      | "ERR_FRESH_UI_BUILD_FAILED"
      | "ERR_FRESH_UI_REPAIR_EXHAUSTED"
      | "ERR_FRESH_UI_BUILD_CANCELLED",
    message: string,
    public readonly metadata: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "FreshGenerationError";
    Object.setPrototypeOf(this, FreshGenerationError.prototype);
  }
}

function bounded(value: string): string {
  return value.length <= MAX_BUILD_OUTPUT ? value : `${value.slice(0, MAX_BUILD_OUTPUT)}\n… output truncated`;
}

function classifyBuilderError(error: unknown): FreshGenerationError {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : "";
  if (code.includes("QUOTA") || code.includes("RATE_LIMIT")) {
    return new FreshGenerationError("ERR_FRESH_UI_AI_QUOTA", "The Fresh UI Builder quota is unavailable.", { cause: code });
  }
  if (code.includes("ABORTED")) {
    return new FreshGenerationError("ERR_FRESH_UI_BUILD_CANCELLED", "The Fresh UI Builder request was cancelled.", { cause: code });
  }
  if (code.includes("TIMEOUT")) {
    return new FreshGenerationError("ERR_FRESH_UI_AI_TIMEOUT", "The Fresh UI Builder request timed out.", { cause: code });
  }
  if (code.includes("UNAVAILABLE") || code.includes("SERVICE") || code.includes("AUTHENTICATION")) {
    return new FreshGenerationError("ERR_FRESH_UI_AI_UNAVAILABLE", "The Fresh UI Builder provider is unavailable.", { cause: code });
  }
  if (error instanceof FreshGenerationError) return error;
  return new FreshGenerationError(
    "ERR_FRESH_UI_BUILDER_RESPONSE",
    error instanceof Error ? error.message : "The Fresh UI Builder returned an invalid response.",
  );
}

function validateProposal(raw: unknown): FreshUiBuilderProposal {
  if (typeof raw !== "object" || raw === null) {
    throw new FreshGenerationError(
      "ERR_FRESH_UI_BUILDER_RESPONSE",
      "The Fresh UI Builder response did not match the required file proposal schema.",
    );
  }
  const parsed = raw as Partial<FreshUiBuilderProposal>;
  if (!Array.isArray(parsed.files) || !Array.isArray(parsed.assumptions) || !Array.isArray(parsed.unresolvedItems)) {
    throw new FreshGenerationError(
      "ERR_FRESH_UI_BUILDER_RESPONSE",
      "The Fresh UI Builder response did not match the required file proposal schema.",
    );
  }
  const files = parsed.files as FreshUiBuilderProposal["files"];
  if (parsed.unexecutableReason !== undefined && parsed.unexecutableReason !== null && files.length === 0) {
    throw new FreshGenerationError("ERR_FRESH_UI_BUILDER_RESPONSE", parsed.unexecutableReason);
  }
  if (files.length === 0) {
    throw new FreshGenerationError("ERR_FRESH_UI_BUILDER_RESPONSE", "The Fresh UI Builder returned no implementation files.");
  }
  if (files.length > MAX_FILES) {
    throw new FreshGenerationError("ERR_FRESH_UI_PROPOSAL_DISALLOWED", "The Fresh UI proposal contains too many files.");
  }

  const seen = new Set<string>();
  let totalBytes = 0;
  for (const file of files) {
    const path = file.path;
    if (seen.has(path)) {
      throw new FreshGenerationError("ERR_FRESH_UI_PROPOSAL_DISALLOWED", `The Fresh UI proposal repeats ${path}.`);
    }
    seen.add(path);
    if (isAbsolute(path) || path.includes("\\") || path.split("/").some((part) => part === ".." || part === "" || part === ".")) {
      throw new FreshGenerationError("ERR_FRESH_UI_PROPOSAL_DISALLOWED", `The Fresh UI proposal contains an unsafe path: ${path}`);
    }
    const allowed = ALLOWED_FILES.has(path) || path.startsWith("src/assets/");
    if (!allowed || path === "src/assets/") {
      throw new FreshGenerationError("ERR_FRESH_UI_PROPOSAL_DISALLOWED", `The Fresh UI proposal cannot write ${path}.`);
    }
    const bytes = Buffer.byteLength(file.content, "utf8");
    if (bytes > MAX_FILE_BYTES) {
      throw new FreshGenerationError("ERR_FRESH_UI_PROPOSAL_DISALLOWED", `The Fresh UI proposal file is too large: ${path}`);
    }
    totalBytes += bytes;
  }
  if (!seen.has("src/App.tsx") || !seen.has("src/styles.css")) {
    throw new FreshGenerationError("ERR_FRESH_UI_PROPOSAL_DISALLOWED", "The Fresh UI proposal must include src/App.tsx and src/styles.css.");
  }
  if (totalBytes > MAX_TOTAL_BYTES) {
    throw new FreshGenerationError("ERR_FRESH_UI_PROPOSAL_DISALLOWED", "The Fresh UI proposal is too large.");
  }
  return parsed as FreshUiBuilderProposal;
}

async function assertTarget(targetPath: string, outputRoot: string): Promise<string> {
  const resolved = resolve(targetPath);
  const resolvedRoot = resolve(outputRoot);
  const targetRelativeToRoot = relative(resolvedRoot, resolved);
  if (
    targetRelativeToRoot.length === 0
    || targetRelativeToRoot === ".."
    || targetRelativeToRoot.startsWith(`..${sep}`)
    || isAbsolute(targetRelativeToRoot)
    || targetRelativeToRoot.split(sep).length !== 1
  ) {
    throw new FreshGenerationError("ERR_FRESH_UI_PROPOSAL_DISALLOWED", "Fresh project target is outside its approved output root.");
  }
  const canonical = await realpath(resolved).catch(() => {
    throw new FreshGenerationError("ERR_FRESH_UI_PROPOSAL_DISALLOWED", "Fresh project target does not exist.");
  });
  const canonicalRoot = await realpath(resolvedRoot).catch(() => resolvedRoot);
  const canonicalRelative = relative(canonicalRoot, canonical);
  if (canonicalRelative.length === 0 || canonicalRelative === ".." || canonicalRelative.startsWith(`..${sep}`) || isAbsolute(canonicalRelative)) {
    throw new FreshGenerationError("ERR_FRESH_UI_PROPOSAL_DISALLOWED", "Fresh project target resolved outside its approved output root.");
  }
  const parent = await realpath(dirname(canonical));
  if (relative(parent, canonical).includes(`..${sep}`) || isAbsolute(relative(parent, canonical))) {
    throw new FreshGenerationError("ERR_FRESH_UI_PROPOSAL_DISALLOWED", "Fresh project target escaped its host directory.");
  }
  const stat = await lstat(canonical);
  if (!stat.isDirectory()) throw new FreshGenerationError("ERR_FRESH_UI_PROPOSAL_DISALLOWED", "Fresh project target is not a directory.");
  return canonical;
}

async function writeProposal(targetPath: string, proposal: FreshUiBuilderProposal): Promise<readonly string[]> {
  const canonical = await assertTarget(targetPath, dirname(targetPath));
  const written: string[] = [];
  for (const file of proposal.files) {
    const destination = resolve(canonical, file.path);
    const escaped = relative(canonical, destination);
    if (escaped.length === 0 || escaped === ".." || escaped.startsWith(`..${sep}`) || isAbsolute(escaped)) {
      throw new FreshGenerationError("ERR_FRESH_UI_PROPOSAL_DISALLOWED", `Fresh UI write escaped the project: ${file.path}`);
    }
    await rejectSymlinkPath(canonical, destination);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, file.content, { encoding: "utf8", flag: "w" });
    written.push(file.path);
  }
  return written;
}

async function rejectSymlinkPath(root: string, destination: string): Promise<void> {
  let current = destination;
  for (;;) {
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new FreshGenerationError("ERR_FRESH_UI_PROPOSAL_DISALLOWED", `Fresh UI write cannot follow a symbolic link: ${relative(root, current)}`);
      }
    } catch (error) {
      if (error instanceof FreshGenerationError) throw error;
      if ((error as { code?: string }).code !== "ENOENT") throw error;
    }
    if (current === root) return;
    const parent = dirname(current);
    const parentRelative = relative(root, parent);
    if (parent === current || parentRelative === ".." || parentRelative.startsWith(`..${sep}`) || isAbsolute(parentRelative)) {
      throw new FreshGenerationError("ERR_FRESH_UI_PROPOSAL_DISALLOWED", "Fresh UI write escaped its project root.");
    }
    current = parent;
  }
}

export async function installFreshProjectDependencies(targetPath: string, signal?: AbortSignal): Promise<FreshBuildResult> {
  return runFreshCommand(targetPath, ["install", "--ignore-scripts", "--no-audit", "--no-fund"], signal);
}

async function readAllowedFiles(targetPath: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const path of ALLOWED_FILES) {
    result[path] = await readFile(resolve(targetPath, path), "utf8");
  }
  return result;
}

export async function runFreshProjectBuild(targetPath: string, signal?: AbortSignal): Promise<FreshBuildResult> {
  return runFreshCommand(targetPath, ["run", "build"], signal);
}

async function runFreshCommand(targetPath: string, args: readonly string[], signal?: AbortSignal): Promise<FreshBuildResult> {
  if (signal?.aborted) {
    throw new FreshGenerationError("ERR_FRESH_UI_BUILD_CANCELLED", "Fresh project build was cancelled.");
  }
  return new Promise((resolveBuild, rejectBuild) => {
    const child = spawn("npm", args, { cwd: targetPath, shell: false });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => child.kill("SIGTERM"), BUILD_TIMEOUT_MS);
    const onAbort = (): void => { child.kill("SIGTERM"); };
    signal?.addEventListener("abort", onAbort, { once: true });
    const append = (current: string, chunk: Buffer): string => bounded(`${current}${chunk.toString("utf8")}`);
    child.stdout?.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
    const finish = (result: FreshBuildResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolveBuild(result);
    };
    child.once("error", (error) => {
      if (settled) return;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      rejectBuild(new FreshGenerationError("ERR_FRESH_UI_BUILD_FAILED", `Fresh project build could not start: ${error.message}`));
    });
    child.once("close", (exitCode) => {
      if (signal?.aborted) {
        finish({ passed: false, stdout, stderr, exitCode });
        return;
      }
      finish({ passed: exitCode === 0, stdout, stderr, exitCode });
    });
  });
}

function builderInput(evidence: FreshFrameEvidence, currentFiles?: Readonly<Record<string, string>>, buildFailure?: FreshBuildResult): FreshUiBuilderInput {
  const { retrievedAt: _retrievedAt, ...provenance } = evidence.snapshot.provenance;
  return {
    evidence: {
      frame: evidence.frame,
      source: evidence.snapshot.source,
      nodes: evidence.snapshot.nodes,
      variables: evidence.snapshot.variables,
      styles: evidence.snapshot.styles,
      components: evidence.snapshot.components,
      assets: evidence.snapshot.assets,
      screenshots: evidence.snapshot.screenshots,
      capabilities: evidence.snapshot.capabilities,
      warnings: evidence.snapshot.warnings,
      provenance,
      sourceProvenance: evidence.snapshot.sourceProvenance,
      specificationEvidence: evidence.specificationEvidence,
      ...(evidence.referenceScreenshot === undefined ? {} : { referenceScreenshot: evidence.referenceScreenshot }),
    },
    frame: evidence.frame,
    fixedStack: ["Vite", "React", "TypeScript", "Plain CSS"],
    allowedWritePaths: ["src/App.tsx", "src/styles.css", "src/assets/**"],
    ...(currentFiles === undefined ? {} : { currentFiles }),
    ...(buildFailure === undefined ? {} : {
      buildFailure: {
        stdout: buildFailure.stdout,
        stderr: buildFailure.stderr,
        ...(buildFailure.exitCode === null ? {} : { exitCode: buildFailure.exitCode ?? undefined }),
      },
    }),
  };
}

export async function generateFreshUiProject(request: FreshGenerationRequest): Promise<FreshGenerationResult> {
  if (request.signal?.aborted) {
    throw new FreshGenerationError("ERR_FRESH_UI_BUILD_CANCELLED", "Fresh UI generation was cancelled.");
  }
  const targetPath = await assertTarget(request.scaffold.targetPath, request.scaffold.outputRoot);
  const build = request.runBuild ?? runFreshProjectBuild;
  let proposal: FreshUiBuilderProposal;
  try {
    proposal = validateProposal(await request.invokeBuilder(builderInput(request.evidence), request.signal));
  } catch (error) {
    throw classifyBuilderError(error);
  }
  const generatedFileSet = new Set(await writeProposal(targetPath, proposal));
  if (request.installDependencies !== undefined) {
    const install = await request.installDependencies(targetPath, request.signal);
    if (request.signal?.aborted) {
      throw new FreshGenerationError("ERR_FRESH_UI_BUILD_CANCELLED", "Fresh project dependency installation was cancelled.");
    }
    if (!install.passed) {
      throw new FreshGenerationError("ERR_FRESH_UI_BUILD_FAILED", "Fresh project dependencies could not be installed.", {
        stdout: install.stdout,
        stderr: install.stderr,
        exitCode: install.exitCode,
      });
    }
  }
  let result = await build(targetPath, request.signal);
  let repairAttempts = 0;
  while (!result.passed && repairAttempts < 2) {
    if (request.signal?.aborted) {
      throw new FreshGenerationError("ERR_FRESH_UI_BUILD_CANCELLED", "Fresh project build was cancelled.");
    }
    repairAttempts += 1;
    try {
      const repair = validateProposal(await request.invokeBuilder(
        builderInput(request.evidence, await readAllowedFiles(targetPath), result),
        request.signal,
      ));
      for (const path of await writeProposal(targetPath, repair)) generatedFileSet.add(path);
    } catch (error) {
      throw classifyBuilderError(error);
    }
    result = await build(targetPath, request.signal);
  }
  if (!result.passed) {
    throw new FreshGenerationError(
      repairAttempts === 2 ? "ERR_FRESH_UI_REPAIR_EXHAUSTED" : "ERR_FRESH_UI_BUILD_FAILED",
      repairAttempts === 2 ? "Fresh UI compile repair budget exhausted." : "Generated Fresh UI project did not build.",
      { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, repairAttempts },
    );
  }
  return { targetPath, generatedFiles: [...generatedFileSet], build: result, repairAttempts };
}
