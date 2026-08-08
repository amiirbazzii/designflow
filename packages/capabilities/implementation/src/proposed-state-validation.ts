import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { proposedFileChangesSchema, type ProposedFileChanges } from "@designflow/sdk";
import { ImplementationError } from "./errors";

/**
 * Deterministic pre-approval validation of the PROPOSED project state:
 * every changed executable source module must compile/resolve under the
 * project's real build tooling even when nothing currently imports it. The
 * registered project is never mutated — the proposed state is materialized
 * in a temporary workspace (project copy + node_modules symlink + exact
 * proposed file operations) and the project's own build command runs there
 * against a synthetic entry that imports each changed executable module.
 */

/** Executable source modules that must compile; styles/assets/docs are dependencies, not entries. */
const EXECUTABLE_SOURCE = /\.(jsx|tsx|js|ts|mjs)$/i;

/** The single executable-source classification shared by every proposal gate. */
export function isExecutableSourcePath(path: string): boolean {
  return EXECUTABLE_SOURCE.test(path);
}
const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist", "build", "out", "coverage", ".turbo", ".next", ".nuxt", ".svelte-kit", ".designflow"]);
const MAX_WORKSPACE_FILES = 2_000;
const MAX_WORKSPACE_BYTES = 20_000_000;
const MAX_DIAGNOSTIC_LINES = 12;
const MAX_DIAGNOSTIC_LINE_LENGTH = 500;
export const PROPOSED_STATE_ENTRY_FILE = "designflow-proposed-entry.js";

export interface ProposedModuleDiagnostic { readonly file?: string; readonly message: string; }
export interface ProposedModuleValidationResult {
  readonly status: "passed" | "failed" | "unavailable";
  /** Changed executable modules the synthetic entry imported. */
  readonly validatedFiles: readonly string[];
  readonly diagnostics: readonly ProposedModuleDiagnostic[];
  /** sha256 of the exact proposal JSON this validation is bound to. */
  readonly proposalHash: string;
  readonly command?: readonly string[];
  readonly exitCode?: number;
  readonly durationMs?: number;
  /** Optional deterministic validation performed after the compile gate in the same workspace. */
  readonly postBuild?: ProposedStatePostBuildResult;
}

export interface ProposedStatePostBuildResult {
  readonly status: "passed" | "failed" | "unavailable";
  readonly diagnostics: readonly ProposedModuleDiagnostic[];
}

export interface ProposedModuleValidationOptions {
  readonly buildCommand?: { readonly executable: string; readonly args: readonly string[] };
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  /** Runs only after the exact proposed state has compiled, before cleanup. */
  readonly postBuild?: (workspace: string) => Promise<ProposedStatePostBuildResult>;
}

export function changedExecutableFiles(proposal: ProposedFileChanges): string[] {
  return proposal.files
    .filter((file) => file.action !== "delete" && EXECUTABLE_SOURCE.test(file.path))
    .map((file) => file.path);
}

const hashProposal = (proposal: ProposedFileChanges): string =>
  createHash("sha256").update(JSON.stringify(proposal), "utf8").digest("hex");

function copyProjectInto(root: string, workspace: string): void {
  let files = 0;
  let bytes = 0;
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(name)) continue;
        walk(full);
        continue;
      }
      if (!stat.isFile()) continue;
      files += 1;
      bytes += stat.size;
      if (files > MAX_WORKSPACE_FILES || bytes > MAX_WORKSPACE_BYTES)
        throw new ImplementationError("ERR_PROPOSED_STATE_TOO_LARGE", "The project is too large for bounded proposed-state validation.");
      const destination = join(workspace, relative(root, full));
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, new Uint8Array(readFileSync(full)));
    }
  };
  walk(root);
}

function applyProposalInto(workspace: string, proposal: ProposedFileChanges): void {
  for (const file of proposal.files) {
    if (file.action === "delete") continue;
    const destination = join(workspace, file.path);
    if (!destination.startsWith(workspace + sep)) throw new ImplementationError("ERR_UNSAFE_PATH", `Proposed path escapes the validation workspace: ${file.path}`);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, file.content ?? "", "utf8");
  }
}

function writeSyntheticEntry(workspace: string, modules: readonly string[]): void {
  const entry = modules.map((path) => `import "./${path}";`).join("\n") + "\n";
  writeFileSync(join(workspace, PROPOSED_STATE_ENTRY_FILE), entry, "utf8");
  const htmlPath = join(workspace, "index.html");
  const stat = lstatSync(htmlPath, { throwIfNoEntry: false });
  const entryReference = `/${PROPOSED_STATE_ENTRY_FILE}`;
  if (stat?.isFile()) {
    // Point the html entry at the synthetic module so an html-driven bundler
    // (Vite) traverses every changed module, reachable or not.
    const html = readFileSync(htmlPath, "utf8");
    const rewritten = /<script\b[^>]*type\s*=\s*["']module["'][^>]*>/i.test(html)
      ? html.replace(/(<script\b[^>]*type\s*=\s*["']module["'][^>]*src\s*=\s*["'])([^"']+)(["'])/i, `$1${entryReference}$3`)
      : html.replace(/<\/body>/i, `<script type="module" src="${entryReference}"></script></body>`);
    writeFileSync(htmlPath, rewritten, "utf8");
  } else {
    writeFileSync(htmlPath, `<!doctype html><html><body><script type="module" src="${entryReference}"></script></body></html>`, "utf8");
  }
}

function boundedDiagnostics(output: string, workspace: string, modules: readonly string[]): ProposedModuleDiagnostic[] {
  const interesting = /error|not exported|could not resolve|failed to resolve|cannot find|unexpected|expected/i;
  const lines = output
    .split("\n")
    .map((line) => line.replaceAll(workspace + sep, "").replaceAll(workspace, "").trimEnd())
    .filter((line) => line.trim().length > 0 && (interesting.test(line) || modules.some((module) => line.includes(module))))
    .slice(0, MAX_DIAGNOSTIC_LINES)
    .map((line) => (line.length > MAX_DIAGNOSTIC_LINE_LENGTH ? `${line.slice(0, MAX_DIAGNOSTIC_LINE_LENGTH)}…` : line));
  if (lines.length === 0) lines.push("The project build command failed for the proposed state; no bounded diagnostic line was recognized.");
  return lines.map((message) => {
    const file = modules.find((candidate) => message.includes(candidate));
    return { ...(file !== undefined ? { file } : {}), message };
  });
}

interface BoundedRun { readonly code: number; readonly output: string; readonly durationMs: number; readonly timedOut: boolean; }

async function runBuild(executable: string, args: readonly string[], cwd: string, options: ProposedModuleValidationOptions): Promise<BoundedRun> {
  return await new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(executable, [...args], { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let timedOut: boolean = false;
    let settled = false;
    const limit = 100_000;
    const append = (chunk: Buffer): void => { if (output.length < limit) output += chunk.toString().slice(0, limit - output.length); };
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, options.timeoutMs ?? 120_000);
    const abort = (): void => { child.kill(); };
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted === true) child.kill();
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      resolve({ code: code ?? 1, output, durationMs: Date.now() - started, timedOut });
    });
  });
}

export async function validateProposedModules(root: string, rawProposal: unknown, options: ProposedModuleValidationOptions = {}): Promise<ProposedModuleValidationResult> {
  const proposal = proposedFileChangesSchema.parse(rawProposal);
  const proposalHash = hashProposal(proposal);
  const modules = changedExecutableFiles(proposal);
  if (modules.length === 0 && options.postBuild === undefined) return { status: "passed", validatedFiles: [], diagnostics: [], proposalHash };
  const command = options.buildCommand;
  if (command === undefined)
    return { status: "unavailable", validatedFiles: modules, diagnostics: [{ message: "The project declares no safe build command, so proposed modules could not be compile-validated." }], proposalHash };
  const workspace = mkdtempSync(join(tmpdir(), "designflow-proposed-state-"));
  try {
    copyProjectInto(root, workspace);
    const nodeModules = join(root, "node_modules");
    if (lstatSync(nodeModules, { throwIfNoEntry: false })?.isDirectory() === true) symlinkSync(nodeModules, join(workspace, "node_modules"));
    applyProposalInto(workspace, proposal);
    writeSyntheticEntry(workspace, modules);
    const throwIfCancelled = (): void => { if (options.signal?.aborted === true) throw new ImplementationError("ERR_VALIDATION_CANCELLED", "Proposed-state validation was cancelled."); };
    throwIfCancelled();
    const result = await runBuild(command.executable, command.args, workspace, options);
    throwIfCancelled();
    if (result.code === 0 && result.timedOut === false) {
      const postBuild = options.postBuild === undefined ? undefined : await options.postBuild(workspace);
      return { status: "passed", validatedFiles: modules, diagnostics: [], proposalHash, command: [command.executable, ...command.args], exitCode: result.code, durationMs: result.durationMs, ...(postBuild === undefined ? {} : { postBuild }) };
    }
    const diagnostics = result.timedOut
      ? [{ message: "The proposed-state build timed out." }]
      : boundedDiagnostics(result.output, workspace, modules);
    return { status: "failed", validatedFiles: modules, diagnostics, proposalHash, command: [command.executable, ...command.args], exitCode: result.code, durationMs: result.durationMs };
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}
