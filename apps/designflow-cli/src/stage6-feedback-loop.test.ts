import { afterEach, describe, expect, test } from "bun:test";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { deflateSync } from "node:zlib";
import { visualValidationReportV1Schema } from "@designflow/sdk";
import {
  inspectRegisteredProject,
  projectRootIdentity,
} from "@designflow/workflow-design-to-code";
import { dispatch } from "./cli";
import { createCliContext, type CliContext } from "./services/cli-runner";
import { ScriptedTerminal } from "./ui/terminal";

const hash = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");
const objectHash = (value: unknown): string => hash(JSON.stringify(value));

function projectHash(root: string): string {
  const entries: string[] = [];
  const walk = (directory: string): void => {
    for (const name of readdirSync(directory).sort()) {
      if (
        name === ".git" ||
        name === "node_modules" ||
        name === "dist" ||
        name === "build" ||
        name === ".designflow"
      )
        continue;
      const path = join(directory, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile())
        entries.push(
          `${path.slice(root.length + 1)}:${hash(readFileSync(path).toString("base64"))}`,
        );
    }
  };
  walk(root);
  return hash(entries.join("\n"));
}
const contexts: CliContext[] = [];
const homes: string[] = [];
const roots: string[] = [];

function installedCli(): string {
  const packdir = mkdtempSync(join(tmpdir(), "designflow-stage6-pack-"));
  const prefix = mkdtempSync(join(tmpdir(), "designflow-stage6-prefix-"));
  const packed = spawnSync(
    "npm",
    [
      "pack",
      "./apps/designflow-cli",
      "--pack-destination",
      packdir,
      "--silent",
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  if (packed.status !== 0) throw new Error(packed.stderr);
  const tarball = packed.stdout.trim().split("\n").at(-1);
  if (!tarball) throw new Error("npm pack did not produce a tarball");
  const installed = spawnSync(
    "npm",
    [
      "install",
      "--prefix",
      prefix,
      join(packdir, tarball),
      "--no-audit",
      "--no-fund",
    ],
    { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" },
  );
  if (installed.status !== 0) throw new Error(installed.stderr);
  return join(prefix, "node_modules", ".bin", "designflow");
}

function runInstalled(
  binary: string,
  home: string,
  inputPath: string,
  answers: readonly string[],
): { status: number | null; output: string } {
  const result = spawnSync(binary, ["feedback-loop", "--input", inputPath], {
    cwd: process.cwd(),
    env: { ...process.env, DESIGNFLOW_HOME: home },
    input: `${answers.join("\n")}\n`,
    encoding: "utf8",
    timeout: 120_000,
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

function runInstalledCommand(
  binary: string,
  home: string,
  args: readonly string[],
  answers: readonly string[],
  failpoint?: string,
): { status: number | null; output: string } {
  const result = spawnSync(binary, [...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DESIGNFLOW_HOME: home,
      NODE_ENV: "test",
      ...(failpoint !== undefined
        ? { DESIGNFLOW_STAGE6_FAILPOINT: failpoint }
        : {}),
    },
    input: `${answers.join("\n")}\n`,
    encoding: "utf8",
    timeout: 120_000,
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

function installedParentRecord(home: string, parentId: string): Record<string, unknown> {
  const document = JSON.parse(
    readFileSync(join(home, "history", "runs.json"), "utf8"),
  ) as { feedbackLoopParents?: Record<string, unknown> };
  const record = document.feedbackLoopParents?.[parentId];
  if (typeof record !== "object" || record === null || Array.isArray(record))
    throw new Error(`Missing installed parent record ${parentId}`);
  return record as Record<string, unknown>;
}

function installedSideEffectCounts(
  parent: Record<string, unknown>,
): Record<string, unknown> {
  const counts = parent.sideEffectCounts;
  if (typeof counts !== "object" || counts === null || Array.isArray(counts))
    throw new Error("Installed parent did not persist side-effect counters");
  return counts as Record<string, unknown>;
}

function png(width: number, height: number): Uint8Array {
  const raw = Buffer.alloc((width * 4 + 1) * height, 255);
  for (let y = 0; y < height; y += 1) raw[y * (width * 4 + 1)] = 0;
  const chunk = (type: string, data: Uint8Array): Buffer => {
    const result = Buffer.alloc(12 + data.byteLength);
    result.writeUInt32BE(data.byteLength, 0);
    result.write(type, 4, 4, "ascii");
    Buffer.from(data).copy(result, 8);
    return result;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", new Uint8Array(deflateSync(raw))),
      chunk("IEND", new Uint8Array()),
    ]),
  );
}

type ReportOptions = {
  variant?: string;
  metric?: number;
  findingId?: string;
  category?: "size" | "visibility";
  multiViewport?: boolean;
  additionalFindingId?: string;
};

function report(
  rootIdentity: string,
  finding: boolean,
  options: ReportOptions = {},
) {
  const findingId = options.findingId ?? "image-difference-desktop";
  const metric = options.metric ?? (finding ? 0.2 : 0);
  const category = options.category ?? "size";
  const viewports = options.multiViewport
    ? [
        { id: "desktop", width: 1440, height: 1024 },
        { id: "tablet", width: 768, height: 1024 },
        { id: "mobile", width: 390, height: 844 },
      ]
    : [{ id: "desktop", width: 1440, height: 1024 }];
  const referenceEvidence = viewports.map((viewport) => ({
    schemaVersion: "1" as const,
    evidenceId: `ref-${viewport.id}`,
    sourceType: "reference" as const,
    frame: { id: "frame" },
    viewport,
    image: {
      width: viewport.width,
      height: viewport.height,
      contentHash: hash(`ref:${viewport.id}`),
      artifactId: `ref-${viewport.id}-png`,
    },
    capturedAt: new Date(0).toISOString(),
    captureMethod: "fake-mcp" as const,
    warnings: [],
    authenticity: "fake-mcp" as const,
  }));
  const implementationEvidence = viewports.map((viewport) => ({
    schemaVersion: "1" as const,
    evidenceId: `impl-${viewport.id}`,
    sourceType: "implementation" as const,
    frame: { id: "frame" },
    viewport,
    image: {
      width: viewport.width,
      height: viewport.height,
      contentHash: hash(
        `${finding ? "bad" : "good"}:${options.variant ?? ""}:${viewport.id}`,
      ),
      artifactId: `impl-${viewport.id}-png`,
    },
    capturedAt: new Date(0).toISOString(),
    captureMethod: "browser" as const,
    warnings: [],
    authenticity: "browser-rendered" as const,
  }));
  return visualValidationReportV1Schema.parse({
    schemaVersion: "1",
    projectId: "placeholder",
    projectRootIdentity: rootIdentity,
    generatedImplementationArtifactId: "generated",
    designSpecificationArtifactId: "spec",
    figmaSourceSnapshotArtifactId: "figma",
    referenceEvidence,
    implementationEvidence,
    viewportResults: viewports.map((viewport, index) => ({
      viewport,
      status: finding && index === 0 ? ("fail" as const) : ("pass" as const),
      implementationEvidenceIds: [`impl-${viewport.id}`],
      referenceEvidenceIds: [`ref-${viewport.id}`],
      findingIds:
        finding && index === 0
          ? [findingId, ...(options.additionalFindingId !== undefined ? [options.additionalFindingId] : [])]
          : [],
      metrics: {
        pixelMismatchRatio: index === 0 ? metric : 0,
        dimensionCompatible: true,
      },
      warnings: [],
    })),
    findings: finding
      ? [
          {
            schemaVersion: "1",
            findingId,
            category,
            severity: "major",
            confidence: 1,
            status: "confirmed",
            affectedFrame: "frame",
            affectedComponent: "Header",
            expectedValue: "96px",
            actualValue: "64px",
            measurableDelta: 32,
            explanation:
              category === "visibility"
                ? "Navigation is clipped."
                : "Header height differs.",
            evidenceReferences: ["impl-desktop", "ref-desktop"],
            origin: "deterministic",
          },
          ...(options.additionalFindingId !== undefined
            ? [
                {
                  schemaVersion: "1" as const,
                  findingId: options.additionalFindingId,
                  category: "size" as const,
                  severity: "major" as const,
                  confidence: 1,
                  status: "confirmed" as const,
                  affectedFrame: "frame",
                  affectedComponent: "Theme",
                  expectedValue: "96px",
                  actualValue: "64px",
                  measurableDelta: 32,
                  explanation: "Theme height differs.",
                  evidenceReferences: ["impl-desktop", "ref-desktop"],
                  origin: "deterministic" as const,
                },
              ]
            : []),
        ]
      : [],
    summary: {
      byCategory: finding
        ? { [category]: options.additionalFindingId === undefined ? 1 : 2 }
        : {},
      bySeverity: finding
        ? { major: options.additionalFindingId === undefined ? 1 : 2 }
        : {},
    },
    coverage: {
      requestedViewports: viewports.length,
      capturedViewports: viewports.length,
      referenceViewports: viewports.length,
      requiredViewportCoverage: true,
    },
    confidence: 1,
    limitations: [],
    captureWarnings: [],
    comparisonMode: "synthetic-fixture",
    overallStatus: finding ? "fail" : "pass",
    passFailPolicy: {
      criticalFails: true,
      majorDeterministicFails: true,
      rendererFailureFails: true,
      missingRequiredViewportFails: true,
      unavailableReferenceIsInconclusive: true,
    },
    agent: { id: "visual-validation-agent", version: "0.1.0" },
    traceIds: [],
  });
}

async function fixture(
  reject: boolean,
  directStage5 = false,
  options: {
    mode?: "pass" | "no-improvement" | "remaining" | "regression";
    buildFails?: boolean;
    maxIterations?: number;
    multiFile?: boolean;
  } = {},
): Promise<{ inputPath: string; root: string }> {
  const home = mkdtempSync(join(tmpdir(), "designflow-stage6-home-"));
  const root = mkdtempSync(join(tmpdir(), "designflow-stage6-project-"));
  homes.push(home);
  roots.push(root);
  mkdirSync(join(root, "src"));
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      name: "stage6-fixture",
      scripts: {
        typecheck: "bun --version",
        lint: "bun --version",
        build: options.buildFails ? "false" : "bun --version",
        ...(directStage5 ? { preview: "node preview.mjs" } : {}),
      },
    }),
  );
  if (directStage5)
    writeFileSync(
      join(root, "preview.mjs"),
      "import http from 'node:http'; const port = Number(process.argv.at(-1)); http.createServer((_, res) => { res.writeHead(200, {'content-type':'text/html'}); res.end('<!doctype html><style>body{margin:0;background:#fff}header{height:64px;background:#111827;color:#fff;display:flex;align-items:center;padding:0 24px}nav{margin-left:auto}</style><header data-designflow-element=\"Header\">Header<nav>Navigation</nav></header>'); }).listen(port, '127.0.0.1');\n",
    );
  const source =
    "export const Header = () => <header style={{ height: '64px' }}>Header</header>; export const HeaderFallback = '64px';\n";
  writeFileSync(join(root, "src", "Header.tsx"), source);
  if (options.multiFile)
    writeFileSync(
      join(root, "src", "Theme.tsx"),
      "export const Theme = '64px';\n",
    );
  writeFileSync(
    join(home, "config.json"),
    JSON.stringify({
      firstRunCompleted: true,
      settings: {
        experimental: {
          designEngineerImplementation: true,
          designEngineerFigmaMcp: true,
        },
        figmaMcp: { command: "bun", args: ["--version"] },
      },
    }),
  );
  process.env.DESIGNFLOW_HOME = home;
  const context = createCliContext({
    databasePath: join(home, "runs.json"),
    requireApproval: true,
  });
  contexts.push(context);
  const project = await context.projects.createProject({
    name: "stage6-fixture",
    rootPath: root,
  });
  const inspected = inspectRegisteredProject({
    id: project.id,
    name: project.name,
    rootPath: root,
  });
  const initial = report(inspected.project.rootIdentity, true, {
    multiViewport: directStage5,
    ...(options.multiFile ? { additionalFindingId: "image-difference-theme" } : {}),
  });
  const fresh =
    options.mode === "no-improvement"
      ? report(inspected.project.rootIdentity, true, {
          variant: "no-improvement",
          metric: 0.2,
        })
      : options.mode === "remaining"
        ? report(inspected.project.rootIdentity, true, {
            variant: "remaining",
            metric: 0.1,
          })
        : options.mode === "regression"
          ? report(inspected.project.rootIdentity, true, {
              variant: "regression",
              findingId: "visibility-regression",
              category: "visibility",
              metric: 0.1,
            })
      : report(inspected.project.rootIdentity, false, {
          ...(options.multiFile ? { additionalFindingId: "image-difference-theme" } : {}),
        });
  const input = {
    schemaVersion: "1" as const,
    workflowId: "design-to-code-feedback-loop" as const,
    executionId: directStage5 ? "stage6-direct-stage5-exec" : "stage6-cli-exec",
    stateDirectory: join(home, "snapshots"),
    project: {
      id: project.id,
      name: project.name,
      rootPath: root,
      canonicalRootIdentity: projectRootIdentity(root),
    },
    projectFingerprint: inspected.project.contextFingerprint,
    currentImplementationHash: hash(source),
    generatedImplementation: {
      artifactId: "generated",
      artifactHash: hash("generated"),
      version: "1",
    },
    latestVisualValidationReport: {
      artifactId: "visual-validation-report",
      artifactHash: objectHash(initial),
      version: "1",
    },
    designSpecification: {
      artifactId: "spec",
      artifactHash: hash("spec"),
      version: "1",
    },
    designSystemMapping: {
      artifactId: "mapping",
      artifactHash: hash("mapping"),
      version: "1",
    },
    actionableFindingIds: [
      "image-difference-desktop",
      ...(options.multiFile ? ["image-difference-theme"] : []),
    ],
    iterationPolicy: {
      maxIterations: options.maxIterations ?? (directStage5 ? 1 : 3),
      maxFilesPerIteration: 5,
      maxChangedBytesPerIteration: 200_000,
      maxDependenciesPerIteration: 0,
      maxFindingsPerIteration: 5,
      modelInterpretedAllowed: false,
      modelConfidenceThreshold: 0.9,
      requireApprovalEveryIteration: true,
      continueAfterImprovement: true,
    },
    validationConfiguration: {
      commands: [],
      timeoutMs: 60_000,
      outputLimitBytes: 100_000,
    },
    viewportConfiguration: {
      viewports: directStage5
        ? [
            { id: "desktop", width: 1440, height: 1024 },
            { id: "tablet", width: 768, height: 1024 },
            { id: "mobile", width: 390, height: 844 },
          ]
        : [{ id: "desktop", width: 1440, height: 1024 }],
      referenceEvidenceIds: directStage5
        ? ["ref-desktop", "ref-tablet", "ref-mobile"]
        : ["ref-desktop"],
      rendererVersion: "playwright-1",
      comparisonAlgorithmVersion: "png-rgba-pixel-diff-v1",
    },
    agentVersion: "0.1.0",
    modelProfileId: "visual-correction-default",
    timeouts: { agentMs: 60_000, approvalMs: 60_000 },
    limits: { maxContextBytes: 200_000, maxPatchBytes: 200_000 },
    affectedFileMap: {
      "image-difference-desktop": ["src/Header.tsx"],
      ...(options.multiFile
        ? { "image-difference-theme": ["src/Theme.tsx"] }
        : {}),
    },
    initialVisualValidationReport: initial,
    ...(directStage5
      ? {
          referenceImagePayloads: {
            "ref-desktop-png": Buffer.from(png(1440, 1024)).toString("base64"),
            "ref-tablet-png": Buffer.from(png(768, 1024)).toString("base64"),
            "ref-mobile-png": Buffer.from(png(390, 844)).toString("base64"),
          },
        }
      : { revalidatedVisualValidationReport: fresh }),
  };
  const inputPath = join(
    home,
    reject ? "reject-input.json" : "success-input.json",
  );
  writeFileSync(inputPath, JSON.stringify(input));
  return { inputPath, root };
}

afterEach(() => {
  for (const context of contexts.splice(0)) context.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
  for (const home of homes.splice(0))
    rmSync(home, { recursive: true, force: true });
  delete process.env.DESIGNFLOW_HOME;
});

describe("installed CLI Stage 6 boundary", () => {
  test("durable parent resumes pending approval in a new runtime and is stable after completion", async () => {
    const fixtureData = await fixture(false);
    const input = JSON.parse(await Bun.file(fixtureData.inputPath).text()) as {
      executionId: string;
    };
    const parentId = `feedback-loop-parent-${input.executionId}`;
    const crashingTerminal = {
      print: () => {},
      ask: async () => {
        throw new Error("simulated process exit before approval");
      },
    };
    await expect(
      dispatch(
        ["feedback-loop", "--input", fixtureData.inputPath],
        contexts.at(-1)!,
        crashingTerminal,
      ),
    ).rejects.toThrow("simulated process exit before approval");
    const firstContext = contexts.at(-1)!;
    const pendingParent = await firstContext.feedbackLoopParents.get(parentId);
    expect(pendingParent?.state).toBe("waiting_approval");
    expect(pendingParent?.childExecutionIds).toHaveLength(1);
    firstContext.close();

    const home = homes.at(-1)!;
    process.env.DESIGNFLOW_HOME = home;
    const resumedContext = createCliContext({
      databasePath: join(home, "runs.json"),
      requireApproval: true,
    });
    contexts.push(resumedContext);
    const code = await dispatch(
      ["feedback-loop", "resume", parentId],
      resumedContext,
      new ScriptedTerminal(["approve"]),
    );
    expect(code).toBe(0);
    const completed = await resumedContext.feedbackLoopParents.get(parentId);
    expect(completed?.state).toBe("completed");
    expect(completed?.finalReportArtifactId).toContain(
      "feedback-loop-parent-report:",
    );
    const finalHash = completed?.finalReportHash;
    expect(completed?.childExecutionIds).toHaveLength(1);
    expect(
      await resumedContext.artifactInspection.getPayloadByArtifactId(
        completed?.finalReportArtifactId ?? "",
      ),
    ).toBeDefined();

    resumedContext.close();
    process.env.DESIGNFLOW_HOME = home;
    const repeatedContext = createCliContext({
      databasePath: join(home, "runs.json"),
      requireApproval: true,
    });
    contexts.push(repeatedContext);
    expect(
      await dispatch(
        ["feedback-loop", "resume", parentId],
        repeatedContext,
        new ScriptedTerminal(),
      ),
    ).toBe(0);
    const repeated = await repeatedContext.feedbackLoopParents.get(parentId);
    expect(repeated?.finalReportHash).toBe(finalHash);
    expect(repeated?.childExecutionIds).toHaveLength(1);
  });

  test("waiting_next_iteration survives process restart and creates one next child", async () => {
    const fixtureData = await fixture(false, false, {
      mode: "remaining",
      maxIterations: 2,
    });
    const input = JSON.parse(await Bun.file(fixtureData.inputPath).text()) as {
      executionId: string;
    };
    const parentId = `feedback-loop-parent-${input.executionId}`;
    let prompts = 0;
    const crashBeforeContinue = {
      print: () => {},
      ask: async () => {
        prompts += 1;
        if (prompts === 1) return "approve";
        throw new Error("simulated process exit before next iteration");
      },
    };
    await expect(
      dispatch(
        ["feedback-loop", "--input", fixtureData.inputPath],
        contexts.at(-1)!,
        crashBeforeContinue,
      ),
    ).rejects.toThrow("simulated process exit before next iteration");
    const firstParent = await contexts
      .at(-1)!
      .feedbackLoopParents.get(parentId);
    expect(firstParent?.state).toBe("waiting_next_iteration");
    expect(firstParent?.iterations).toHaveLength(1);

    const home = homes.at(-1)!;
    process.env.DESIGNFLOW_HOME = home;
    const resumedContext = createCliContext({
      databasePath: join(home, "runs.json"),
      requireApproval: true,
    });
    contexts.push(resumedContext);
    await dispatch(
      ["feedback-loop", "resume", parentId],
      resumedContext,
      new ScriptedTerminal(["yes", "approve"]),
    );
    const resumedParent =
      await resumedContext.feedbackLoopParents.get(parentId);
    expect(resumedParent?.childExecutionIds).toHaveLength(2);
    expect(resumedParent?.iterations).toHaveLength(2);
    expect(resumedParent?.iterations[1]?.iterationNumber).toBe(2);
  });

  test("Scenario A: approval applies the bounded correction and reaches pass", async () => {
    const fixtureData = await fixture(false);
    const baseline = projectHash(fixtureData.root);
    const terminal = new ScriptedTerminal(["approve"]);
    const code = await dispatch(
      ["feedback-loop", "--input", fixtureData.inputPath],
      contexts[0]!,
      terminal,
    );
    expect(code).toBe(0);
    expect(projectHash(fixtureData.root)).not.toBe(baseline);
    expect(
      await Bun.file(join(fixtureData.root, "src", "Header.tsx")).text(),
    ).toContain("96px");
    expect(terminal.transcript).toContain("No files have been changed yet.");
    expect(terminal.transcript).toContain("Status: pass");
    const history = await contexts[0]!.runner.history(
      "design-to-code-feedback-loop",
    );
    expect(history).toHaveLength(1);
  });

  test("Scenario B: rejection writes no snapshot and leaves the project unchanged", async () => {
    const fixtureData = await fixture(true);
    const baseline = projectHash(fixtureData.root);
    const before = await Bun.file(
      join(fixtureData.root, "src", "Header.tsx"),
    ).text();
    const terminal = new ScriptedTerminal(["reject"]);
    const code = await dispatch(
      ["feedback-loop", "--input", fixtureData.inputPath],
      contexts[0]!,
      terminal,
    );
    expect(code).toBe(1);
    expect(projectHash(fixtureData.root)).toBe(baseline);
    expect(
      await Bun.file(join(fixtureData.root, "src", "Header.tsx")).text(),
    ).toBe(before);
    expect(terminal.transcript).toContain("Status: rejected");
    expect(
      await contexts[0]!.runner.history("design-to-code-feedback-loop"),
    ).toHaveLength(1);
  });

  test("production path directly reruns Stage 5 and persists fresh evidence", async () => {
    const fixtureData = await fixture(false, true);
    const baseline = projectHash(fixtureData.root);
    const terminal = new ScriptedTerminal(["approve"]);
    await dispatch(
      ["feedback-loop", "--input", fixtureData.inputPath],
      contexts[0]!,
      terminal,
    );
    expect(projectHash(fixtureData.root)).not.toBe(baseline);
    const history = await contexts[0]!.runner.history(
      "design-to-code-feedback-loop",
    );
    const run = await contexts[0]!.runner.explain(history[0]!.executionId);
    const reportArtifact = run.artifacts.find(
      (artifact) =>
        artifact.artifactId === "revalidated-visual-validation-report",
    );
    expect(reportArtifact).toBeDefined();
    const payload = await contexts[0]!.artifactInspection.getPayload(
      reportArtifact!,
    );
    expect(
      (payload.payload as { implementationEvidence?: unknown[] })
        .implementationEvidence?.length,
    ).toBe(3);
    expect(
      (payload.payload as { viewportResults?: unknown[] }).viewportResults
        ?.length,
    ).toBe(3);
    expect(terminal.transcript).toContain("Status:");
  });

  test("Scenario C: required build failure rolls back and does not revalidate", async () => {
    const fixtureData = await fixture(false, false, { buildFails: true });
    const baseline = projectHash(fixtureData.root);
    const terminal = new ScriptedTerminal(["approve"]);
    const code = await dispatch(
      ["feedback-loop", "--input", fixtureData.inputPath],
      contexts[0]!,
      terminal,
    );
    expect(code).toBe(1);
    expect(projectHash(fixtureData.root)).toBe(baseline);
    expect(
      await Bun.file(join(fixtureData.root, "src", "Header.tsx")).text(),
    ).toContain("64px");
    expect(terminal.transcript).toContain("Status: stopped");
    const history = await contexts[0]!.runner.history(
      "design-to-code-feedback-loop",
    );
    const run = await contexts[0]!.runner.explain(history[0]!.executionId);
    expect(
      run.artifacts.some(
        (artifact) =>
          artifact.artifactId === "revalidated-visual-validation-report",
      ),
    ).toBe(false);
    const reportArtifact = run.artifacts.find(
      (artifact) => artifact.artifactId === "feedback-loop-report",
    );
    expect(reportArtifact).toBeDefined();
    const payload = await contexts[0]!.artifactInspection.getPayload(
      reportArtifact!,
    );
    expect((payload.payload as { stopReason?: string }).stopReason).toBe(
      "project_validation_failed",
    );
  });

  test("Scenario D: unchanged deterministic metrics stop with no_improvement", async () => {
    const fixtureData = await fixture(false, false, { mode: "no-improvement" });
    const baseline = projectHash(fixtureData.root);
    const terminal = new ScriptedTerminal(["approve"]);
    const code = await dispatch(
      ["feedback-loop", "--input", fixtureData.inputPath],
      contexts[0]!,
      terminal,
    );
    expect(code).toBe(1);
    expect(projectHash(fixtureData.root)).not.toBe(baseline);
    expect(terminal.transcript).toContain("Status: fail");
    const history = await contexts[0]!.runner.history(
      "design-to-code-feedback-loop",
    );
    const run = await contexts[0]!.runner.explain(history[0]!.executionId);
    const artifact = run.artifacts.find(
      (entry) => entry.artifactId === "feedback-loop-report",
    );
    const payload = await contexts[0]!.artifactInspection.getPayload(artifact!);
    expect((payload.payload as { stopReason?: string }).stopReason).toBe(
      "no_improvement",
    );
  });

  test("Scenario E: iteration limit one preserves the remaining finding", async () => {
    const fixtureData = await fixture(false, false, {
      mode: "remaining",
      maxIterations: 1,
    });
    const terminal = new ScriptedTerminal(["approve"]);
    const code = await dispatch(
      ["feedback-loop", "--input", fixtureData.inputPath],
      contexts[0]!,
      terminal,
    );
    expect(code).toBe(1);
    expect(terminal.transcript).toContain("Status: fail");
    expect(terminal.transcript).not.toContain("Prepare correction iteration 2");
    const history = await contexts[0]!.runner.history(
      "design-to-code-feedback-loop",
    );
    expect(history).toHaveLength(1);
    const run = await contexts[0]!.runner.explain(history[0]!.executionId);
    const artifact = run.artifacts.find(
      (entry) => entry.artifactId === "feedback-loop-report",
    );
    const payload = await contexts[0]!.artifactInspection.getPayload(artifact!);
    expect((payload.payload as { stopReason?: string }).stopReason).toBe(
      "iteration_limit_reached",
    );
    expect(
      (payload.payload as { unresolvedFindings?: string[] }).unresolvedFindings,
    ).toContain("image-difference-desktop");
  });

  test("Scenario F: resolved finding plus new major finding stops as regression_detected", async () => {
    const fixtureData = await fixture(false, false, { mode: "regression" });
    const baseline = projectHash(fixtureData.root);
    const terminal = new ScriptedTerminal(["approve"]);
    const code = await dispatch(
      ["feedback-loop", "--input", fixtureData.inputPath],
      contexts[0]!,
      terminal,
    );
    expect(code).toBe(1);
    expect(projectHash(fixtureData.root)).not.toBe(baseline);
    expect(terminal.transcript).toContain("Status: fail");
    const history = await contexts[0]!.runner.history(
      "design-to-code-feedback-loop",
    );
    const run = await contexts[0]!.runner.explain(history[0]!.executionId);
    const artifact = run.artifacts.find(
      (entry) => entry.artifactId === "feedback-loop-report",
    );
    const payload = await contexts[0]!.artifactInspection.getPayload(artifact!);
    expect((payload.payload as { stopReason?: string }).stopReason).toBe(
      "regression_detected",
    );
    expect(
      (payload.payload as { resolvedFindings?: string[] }).resolvedFindings,
    ).toContain("image-difference-desktop");
    expect(
      (payload.payload as { introducedFindings?: string[] }).introducedFindings,
    ).toContain("visibility-regression");
    expect(terminal.transcript).not.toContain("Prepare correction iteration 2");
  });

  test("iteration limits two and three create at most one next approved child", async () => {
    for (const maxIterations of [2, 3]) {
      const fixtureData = await fixture(false, false, {
        mode: "remaining",
        maxIterations,
      });
      const currentContext = contexts.at(-1)!;
      const terminal = new ScriptedTerminal(["approve", "yes", "approve"]);
      const priorHistory = (
        await currentContext.runner.history("design-to-code-feedback-loop")
      ).length;
      await dispatch(
        ["feedback-loop", "--input", fixtureData.inputPath],
        currentContext,
        terminal,
      );
      expect(terminal.transcript).toContain(
        `Preparing correction iteration 2 of ${maxIterations}`,
      );
      expect(
        await currentContext.runner.history("design-to-code-feedback-loop"),
      ).toHaveLength(priorHistory + 2);
    }
  });

  test(
    "installed executable proves scenarios A-F with isolated homes",
    { timeout: 120_000 },
    async () => {
      const binary = installedCli();
      const cases = [
        { name: "A", options: {}, answers: ["approve"], expected: 0 },
        {
          name: "B",
          options: {},
          answers: ["reject"],
          expected: 1,
          reject: true,
        },
        {
          name: "C",
          options: { buildFails: true },
          answers: ["approve"],
          expected: 1,
        },
        {
          name: "D",
          options: { mode: "no-improvement" as const },
          answers: ["approve"],
          expected: 1,
        },
        {
          name: "E",
          options: { mode: "remaining" as const, maxIterations: 1 },
          answers: ["approve"],
          expected: 1,
        },
        {
          name: "F",
          options: { mode: "regression" as const },
          answers: ["approve"],
          expected: 1,
        },
      ];

      for (const scenario of cases) {
        const fixtureData = await fixture(
          scenario.reject === true,
          false,
          scenario.options,
        );
        const baseline = projectHash(fixtureData.root);
        const result = runInstalled(
          binary,
          homes[homes.length - 1]!,
          fixtureData.inputPath,
          scenario.answers,
        );
        expect(result.status, scenario.name).toBe(scenario.expected);
        expect(result.output, scenario.name).toContain(
          scenario.name === "B"
            ? "Status: rejected"
            : "Correction iteration finished.",
        );
        if (scenario.name === "B" || scenario.name === "C")
          expect(projectHash(fixtureData.root), scenario.name).toBe(baseline);
        else
          expect(projectHash(fixtureData.root), scenario.name).not.toBe(
            baseline,
          );
      }
    },
  );

  test(
    "installed executable resumes every durable Stage 6 failpoint without duplicate side effects",
    { timeout: 600_000 },
    async () => {
      const rebuilt = spawnSync("bun", ["run", "build", "--force"], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: "pipe",
      });
      if (rebuilt.status !== 0) throw new Error(rebuilt.stderr);
      const cliRebuilt = spawnSync("bun", ["run", "build"], {
        cwd: join(process.cwd(), "apps", "designflow-cli"),
        encoding: "utf8",
        stdio: "pipe",
      });
      if (cliRebuilt.status !== 0) throw new Error(cliRebuilt.stderr);
      const binary = installedCli();
      const prefix = dirname(dirname(dirname(binary)));
      const playwrightInstall = spawnSync(
        "npm",
        [
          "install",
          "--prefix",
          prefix,
          "playwright@1.62.1",
          "--no-audit",
          "--no-fund",
        ],
        { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" },
      );
      if (playwrightInstall.status !== 0)
        throw new Error(playwrightInstall.stderr);
      const browserInstall = spawnSync(
        join(prefix, "node_modules", ".bin", "playwright"),
        ["install", "chromium"],
        { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" },
      );
      if (browserInstall.status !== 0) throw new Error(browserInstall.stderr);

      const cases: readonly {
        readonly name: string;
        readonly failpoint: string;
        readonly directStage5?: boolean;
        readonly mode?: "remaining";
        readonly maxIterations?: number;
        readonly firstAnswers: readonly string[];
        readonly resumeAnswers: readonly string[];
        readonly expectedResumeStatus: number;
      }[] = [
        {
          name: "B-after-approval-consumed",
          failpoint: "after_approval_consumed",
          firstAnswers: ["approve"],
          resumeAnswers: [],
          expectedResumeStatus: 0,
        },
        {
          name: "C1-after-snapshot",
          failpoint: "after_snapshot_created",
          firstAnswers: ["approve"],
          resumeAnswers: [],
          expectedResumeStatus: 0,
        },
        {
          name: "C2-after-application",
          failpoint: "after_correction_applied",
          firstAnswers: ["approve"],
          resumeAnswers: [],
          expectedResumeStatus: 0,
        },
        {
          name: "D1-after-validation",
          failpoint: "after_project_validation",
          firstAnswers: ["approve"],
          resumeAnswers: [],
          expectedResumeStatus: 0,
        },
        {
          name: "D2-after-preview",
          failpoint: "after_preview_ready",
          directStage5: true,
          firstAnswers: ["approve"],
          resumeAnswers: [],
          expectedResumeStatus: 1,
        },
        {
          name: "D3-after-desktop",
          failpoint: "after_desktop_capture",
          directStage5: true,
          firstAnswers: ["approve"],
          resumeAnswers: [],
          expectedResumeStatus: 1,
        },
        {
          name: "D4-after-tablet",
          failpoint: "after_tablet_capture",
          directStage5: true,
          firstAnswers: ["approve"],
          resumeAnswers: [],
          expectedResumeStatus: 1,
        },
        {
          name: "D5-after-mobile",
          failpoint: "after_mobile_capture",
          directStage5: true,
          firstAnswers: ["approve"],
          resumeAnswers: [],
          expectedResumeStatus: 1,
        },
        {
          name: "E-after-visual-report",
          failpoint: "after_visual_report_persisted",
          directStage5: true,
          firstAnswers: ["approve"],
          resumeAnswers: [],
          expectedResumeStatus: 1,
        },
        {
          name: "F-after-evaluation",
          failpoint: "after_iteration_evaluated",
          mode: "remaining",
          maxIterations: 2,
          firstAnswers: ["approve"],
          resumeAnswers: ["yes", "approve"],
          expectedResumeStatus: 1,
        },
        {
          name: "G1-after-parent-stop",
          failpoint: "after_parent_stop_persisted",
          firstAnswers: ["reject"],
          resumeAnswers: [],
          expectedResumeStatus: 1,
        },
      ];

      let completedParentId: string | undefined;
      for (const scenario of cases) {
        const fixtureData = await fixture(
          scenario.name === "G1-after-parent-stop",
          scenario.directStage5 === true,
          {
            ...(scenario.mode !== undefined ? { mode: scenario.mode } : {}),
            ...(scenario.maxIterations !== undefined
              ? { maxIterations: scenario.maxIterations }
              : {}),
          },
        );
        const input = JSON.parse(
          readFileSync(fixtureData.inputPath, "utf8"),
        ) as { executionId: string };
        const parentId = `feedback-loop-parent-${input.executionId}`;
        const before = runInstalledCommand(
          binary,
          homes.at(-1)!,
          ["feedback-loop", "--input", fixtureData.inputPath],
          scenario.firstAnswers,
          scenario.failpoint,
        );
        expect(before.status, scenario.name).toBe(75);
        expect(before.output, scenario.name).toContain(
          `DESIGNFLOW_STAGE6_FAILPOINT:${scenario.failpoint}`,
        );
        const crashedParent = installedParentRecord(homes.at(-1)!, parentId);
        const approvalsBefore = Object.keys(
          (JSON.parse(
            readFileSync(join(homes.at(-1)!, "history", "runs.json"), "utf8"),
          ) as { approvals?: Record<string, unknown> }).approvals ?? {},
        );
        const after = runInstalledCommand(
          binary,
          homes.at(-1)!,
          ["feedback-loop", "resume", parentId],
          scenario.resumeAnswers,
        );
        expect(after.status, `${scenario.name}\n${after.output}`).toBe(
          scenario.expectedResumeStatus,
        );
        const finalParent = installedParentRecord(homes.at(-1)!, parentId);
        const counts = installedSideEffectCounts(finalParent);
        expect(counts.finalReportCreation, scenario.name).toBe(1);
        expect(
          Object.keys(
            (JSON.parse(
              readFileSync(join(homes.at(-1)!, "history", "runs.json"), "utf8"),
            ) as { approvals?: Record<string, unknown> }).approvals ?? {},
          ).length,
          scenario.name,
        ).toBe(
          approvalsBefore.length +
            (scenario.name === "F-after-evaluation" ? 1 : 0),
        );
        expect(finalParent.finalReportArtifactId, scenario.name).toBeDefined();
        expect(finalParent.childExecutionIds, scenario.name).toBeDefined();
        if (scenario.directStage5 === true) {
          const screenshots = counts.screenshotCaptureByViewport as Record<
            string,
            number
          >;
          expect(screenshots.desktop, scenario.name).toBe(1);
          expect(screenshots.tablet, scenario.name).toBe(1);
          expect(screenshots.mobile, scenario.name).toBe(1);
        }
        if (scenario.name === "F-after-evaluation") {
          expect((finalParent.childExecutionIds as string[]).length).toBe(2);
          expect((finalParent.iterations as unknown[]).length).toBe(2);
        }
        if (completedParentId === undefined && scenario.name === "B-after-approval-consumed") {
          completedParentId = parentId;
          const show = runInstalledCommand(
            binary,
            homes.at(-1)!,
            ["feedback-loop", "show", parentId],
            [],
          );
          expect(show.status).toBe(0);
          expect(show.output).toContain("Completed side effects:");
          const artifacts = runInstalledCommand(
            binary,
            homes.at(-1)!,
            ["artifacts", parentId],
            [],
          );
          expect(artifacts.status).toBe(0);
          expect(artifacts.output).toContain("Feedback Loop Parent Artifacts");
        }
        void crashedParent;
      }

      if (completedParentId !== undefined) {
        const home = homes.find((candidate) => {
          try {
            return installedParentRecord(candidate, completedParentId!).parentExecutionId === completedParentId;
          } catch {
            return false;
          }
        });
        if (home !== undefined) {
          const baseline = projectHash(roots[0]!);
          for (let index = 0; index < 3; index += 1) {
            const repeated = runInstalledCommand(
              binary,
              home,
              ["feedback-loop", "resume", completedParentId],
              [],
            );
            expect(repeated.status).toBe(0);
            expect(repeated.output).toContain("already completed");
          }
          expect(projectHash(roots[0]!)).toBe(baseline);
        }
      }
    },
  );

  test(
    "installed executable recovers a partial multi-file application from its persisted transaction",
    { timeout: 180_000 },
    async () => {
      const rebuilt = spawnSync("bun", ["run", "build", "--force"], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: "pipe",
      });
      if (rebuilt.status !== 0) throw new Error(rebuilt.stderr);
      const cliRebuilt = spawnSync("bun", ["run", "build"], {
        cwd: join(process.cwd(), "apps", "designflow-cli"),
        encoding: "utf8",
        stdio: "pipe",
      });
      if (cliRebuilt.status !== 0) throw new Error(cliRebuilt.stderr);
      const binary = installedCli();
      const fixtureData = await fixture(false, false, { multiFile: true });
      const home = homes.at(-1)!;
      const baseline = projectHash(fixtureData.root);
      const first = runInstalledCommand(
        binary,
        home,
        ["feedback-loop", "--input", fixtureData.inputPath],
        ["approve"],
        "after_first_correction_write",
      );
      expect(first.status).toBe(75);
      expect(first.output).toContain(
        "DESIGNFLOW_STAGE6_FAILPOINT:after_first_correction_write",
      );
      expect(projectHash(fixtureData.root)).not.toBe(baseline);
      expect(
        await Bun.file(join(fixtureData.root, "src", "Header.tsx")).text(),
      ).toContain("96px");
      expect(
        await Bun.file(join(fixtureData.root, "src", "Theme.tsx")).text(),
      ).toContain("64px");
      const snapshotDirectory = join(home, "snapshots");
      const snapshotFiles = readdirSync(snapshotDirectory).filter((name) =>
        name.endsWith(".json"),
      );
      expect(snapshotFiles).toHaveLength(1);
      const partialSnapshot = JSON.parse(
        readFileSync(join(snapshotDirectory, snapshotFiles[0]!), "utf8"),
      ) as { entries?: { path: string; postWriteHash?: string }[] };
      expect(partialSnapshot.entries?.find((entry) => entry.path === "src/Header.tsx")?.postWriteHash).toBeDefined();
      expect(partialSnapshot.entries?.find((entry) => entry.path === "src/Theme.tsx")?.postWriteHash).toBeUndefined();

      const resumed = runInstalledCommand(
        binary,
        home,
        ["feedback-loop", "resume", `feedback-loop-parent-stage6-cli-exec`],
        [],
      );
      expect(resumed.status, resumed.output).toBe(0);
      expect(resumed.output).toContain("Status: pass");
      expect(
        await Bun.file(join(fixtureData.root, "src", "Header.tsx")).text(),
      ).toContain("96px");
      expect(
        await Bun.file(join(fixtureData.root, "src", "Theme.tsx")).text(),
      ).toContain("96px");
      expect(projectHash(fixtureData.root)).not.toBe(baseline);
      expect(
        readdirSync(snapshotDirectory).filter((name) => name.endsWith(".json")),
      ).toHaveLength(1);
      const parent = installedParentRecord(
        home,
        "feedback-loop-parent-stage6-cli-exec",
      );
      const counts = installedSideEffectCounts(parent);
      expect(counts.snapshotCreation).toBe(1);
      expect(counts.correctionApplication).toBe(1);
      expect(counts.projectValidation).toBe(1);
      expect(counts.finalReportCreation).toBe(1);
      const repeated = runInstalledCommand(
        binary,
        home,
        ["feedback-loop", "resume", "feedback-loop-parent-stage6-cli-exec"],
        [],
      );
      expect(repeated.status).toBe(0);
      expect(repeated.output).toContain("already completed");
      expect(installedSideEffectCounts(installedParentRecord(home, "feedback-loop-parent-stage6-cli-exec")).correctionApplication).toBe(1);
    },
  );
});
