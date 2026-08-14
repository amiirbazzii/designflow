// workflows/workflow-design-to-code/src/flagship/test/flagship-acceptance.test.ts
//
// V2-8 acceptance: the normal Design Engineer journey — session in, one
// logical execution, needs_approval, exact selected proposal, apply — runs
// the V2 architecture end to end with ZERO Coordinator and ZERO legacy
// specialist involvement. The host wires no agent runtime at all, so any
// attempt at either would throw rather than pass silently.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonicalProposalHash,
  finalImplementationReviewSchema,
  v2FinalizationResultSchema,
  visualConvergenceArtifactSchema,
  type ProposedFileChanges,
} from "@designflow/sdk";

import { DESIGN_TO_CODE_V2_WORKFLOW_ID } from "../flagship-types";
import { createFlagshipHost, type FlagshipHost } from "./support/flagship-host";
import { queuedRenderer } from "../../visual-convergence/test/support/convergence-host";
import {
  BLUEPRINT,
  FAITHFUL_DOM,
  FAITHFUL_PAGE,
  IMPERFECT_DOM,
  IMPERFECT_PAGE,
  MAP,
  NAV_COMPONENT,
  NAV_REQUIREMENT,
  SCREEN_REQUIREMENT,
  fixtureProject,
  proposalFor,
  type FakeElement,
} from "../../v2-visual/test/support/spendly-v2-fixture";

const P1_PAGE = IMPERFECT_PAGE.replace("height: 40", "height: 72").replace("height: 32", "height: 56");
const P2_PAGE = `export default function App() { return <main>{/* regressed */}</main>; }\n`;
type RepairFiles = readonly { path: string; content: string }[];
const REPAIR_TO_PARTIAL: RepairFiles = [{ path: "src/App.jsx", content: P1_PAGE }];
const REPAIR_TO_FAITHFUL: RepairFiles = [
  { path: "src/App.jsx", content: FAITHFUL_PAGE },
  { path: "src/BottomNavigation.jsx", content: NAV_COMPONENT },
];
/** Repair 1 of the partial-progress path: header/field fixed, button/nav still wrong. */
const PARTIAL_DOM: readonly FakeElement[] = [
  { selector: "h1", tagName: "h1", text: "Add Transaction", height: 72, instrumentationRef: SCREEN_REQUIREMENT },
  { selector: "div", tagName: "div", text: "Enter amount", height: 56 },
  { selector: "button", tagName: "button", text: "Fill the information", height: 30 },
];

function withWrapper(elements: readonly FakeElement[]): readonly FakeElement[] {
  return [
    {
      selector: "main",
      tagName: "main",
      text: elements.map((element) => element.text).filter(Boolean).join(" "),
      height: 844,
      width: 390,
    },
    ...elements,
  ];
}

/** P1's render: everything right except the button. Selected over a regressed P2. */
const NEARLY_DOM: readonly FakeElement[] = [
  { selector: "h1", tagName: "h1", text: "Add Transaction", height: 72, instrumentationRef: SCREEN_REQUIREMENT },
  { selector: "div", tagName: "div", text: "Enter amount", height: 56 },
  { selector: "button", tagName: "button", text: "Fill the information", height: 30 },
  { selector: "nav", tagName: "nav", height: 68, width: 390, instrumentationRef: NAV_REQUIREMENT },
];
/** P2's render: button fixed, navigation lost — a regression. */
const REGRESSED_DOM: readonly FakeElement[] = [
  { selector: "h1", tagName: "h1", text: "Add Transaction", height: 72, instrumentationRef: SCREEN_REQUIREMENT },
  { selector: "div", tagName: "div", text: "Enter amount", height: 56 },
  { selector: "button", tagName: "button", text: "Fill the information", height: 56 },
];

const roots: string[] = [];
const hosts: FlagshipHost[] = [];
afterEach(async () => {
  for (const host of hosts.splice(0)) host.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

interface Scenario {
  readonly host: FlagshipHost;
  readonly root: string;
  readonly builderCalls: number[];
  readonly repairCalls: number[];
  readonly mapperCalls: number[];
  readonly captureCount: () => number;
  readonly input: Record<string, unknown>;
}

async function scenario(options: {
  readonly destinationPath?: string;
  readonly mapperUnavailable?: boolean;
  readonly domQueue?: readonly (readonly FakeElement[])[];
  readonly noPreview?: boolean;
  readonly onBuild?: () => void;
  readonly config?: Record<string, unknown>;
  readonly repairFiles?: readonly RepairFiles[];
} = {}): Promise<Scenario> {
  const root = await fixtureProject();
  const stateDirectory = await mkdtemp(join(tmpdir(), "designflow-flagship-state-"));
  roots.push(root, stateDirectory);

  if (options.noPreview === true) {
    const manifestPath = join(root, "package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { scripts: Record<string, string> };
    delete manifest.scripts["preview"];
    writeFileSync(manifestPath, JSON.stringify(manifest));
  }

  const builderCalls: number[] = [];
  const repairCalls: number[] = [];
  const mapperCalls: number[] = [];
  const repairFiles = options.repairFiles ?? [REPAIR_TO_PARTIAL, REPAIR_TO_FAITHFUL];

  const rendererHandle = queuedRenderer(
    options.domQueue ?? [withWrapper(IMPERFECT_DOM), withWrapper(PARTIAL_DOM), withWrapper(FAITHFUL_DOM)],
  );

  const host = await createFlagshipHost({
    config: {
      visualRenderer: rendererHandle.renderer,
      v2BlueprintCompiler: async () => ({ blueprint: BLUEPRINT, semanticStatus: "not_requested" }),
      v2ProjectContextCompiler: async () => ({ context: { schemaVersion: "1", fixture: true } }),
      v2ProjectMapper: async () => {
        mapperCalls.push(1);
        if (options.mapperUnavailable === true)
          return { status: "unavailable", reason: "no model provider is configured for the Project Mapper" };
        return { status: "complete", map: MAP };
      },
      v2UiBuilder: async () => {
        builderCalls.push(1);
        options.onBuild?.();
        return { status: "valid", attempts: 1, proposal: proposalFor(root, [{ path: "src/App.jsx", content: IMPERFECT_PAGE }]).proposal };
      },
      visualRepairBuilder: async () => {
        const files = repairFiles[repairCalls.length];
        repairCalls.push(1);
        if (files === undefined) return { status: "exhausted", attempts: 3, reason: "script exhausted" };
        return { status: "valid", attempts: 1, proposal: proposalFor(root, [...files]).proposal };
      },
      ...(options.config ?? {}),
    },
  });

  hosts.push(host);

  const input: Record<string, unknown> = {
    project: { id: "v2-visual-project", name: "Fixture", rootPath: root },
    stateDirectory,
    // The fake MCP server's fixture design; the fake Blueprint compiler
    // substitutes the Spendly Blueprint regardless of snapshot content.
    designFile: "https://www.figma.com/design/abc123XYZ/Homepage",
    frames: ["Header"],
    destination: { label: "App page", kind: "page", path: options.destinationPath ?? "src/App.jsx" },
    viewports: [{ id: "desktop", width: 390, height: 844 }],
    allowFixtureNames: true,
    figmaSourceMode: "mcp-stdio",
    captureScreenshots: false,
  };

  return { host, root, builderCalls, repairCalls, mapperCalls, captureCount: rendererHandle.calls, input };
}

async function payloadOf(host: FlagshipHost, artifactId: string): Promise<Record<string, unknown>> {
  const artifact = await host.artifactStore.getArtifact(artifactId);
  expect(artifact).not.toBeNull();
  const stored = await host.artifactStore.get(String(artifact!.metadata!.payloadId));
  expect(stored).not.toBeNull();
  return stored!.data as Record<string, unknown>;
}

describe("the normal Design Engineer journey is V2, with no Coordinator (§52, §53, §54)", () => {
  test("session → one execution → needs_approval → approve P1 → applied and validated", async () => {
    const s = await scenario();

    // The worker has no agent and the router has no agent runtime: a
    // Coordinator decision is structurally impossible on this path.
    expect(s.host.worker.agentId).toBeUndefined();

    const result = await s.host.sessions.startDeterministicSession(
      s.host.worker,
      {
        workerId: s.host.worker.id,
        request: "designFile: spendly; destination: App page",
        input: s.input,
        projectId: "v2-visual-project",
      },
      DESIGN_TO_CODE_V2_WORKFLOW_ID,
    );

    // One logical run: the session completed into exactly one execution.
    expect(result.session.status).toBe("completed");
    expect(result.session.decisionType).toBe("run_workflow");
    expect(result.session.turnCount).toBe(0);
    const executionId = result.session.executionId!;
    expect(executionId).toBeDefined();

    // The run paused at the human gate with zero writes.
    const report = await s.host.runner.explain(executionId);
    expect(report.overview.state).toBe("needs_approval");
    expect(await readFile(join(s.root, "src", "App.jsx"), "utf8")).toContain("return null");

    // Convergence converged on the faithful third state.
    const convergence = visualConvergenceArtifactSchema.parse(await payloadOf(s.host, "visual-convergence"));
    expect(convergence.iterationsPerformed).toBe(3);
    expect(convergence.selectedIteration).toBe(2);
    expect(["converged", "converged_with_findings"]).toContain(convergence.status);

    // The review the user approves is derived from the exact selected
    // proposal — never the Builder's latest output or a prose file list (§31).
    const review = finalImplementationReviewSchema.parse(await payloadOf(s.host, "v2-final-review"));
    const selected = proposalFor(s.root, [...REPAIR_TO_FAITHFUL]).proposal;
    expect(review.proposalHash).toBe(canonicalProposalHash(selected));
    expect(review.proposalHash).toBe(convergence.selectedProposalHash);

    // Human approval resumes the same execution — no second run.
    const approved = await s.host.runner.approve(executionId, "Apply the reviewed implementation.");
    expect(approved.state).toBe("ready");
    expect(approved.executionId).toBe(executionId);

    // Applied content is the selected proposal's, byte for byte.
    const applied = await readFile(join(s.root, "src", "App.jsx"), "utf8");
    expect(applied).toBe(FAITHFUL_PAGE);

    const final = v2FinalizationResultSchema.parse(await payloadOf(s.host, "v2-finalization-result"));
    expect(final.status).toBe("applied_validated");
    expect(final.appliedProposalHash).toBe(canonicalProposalHash(selected));

    // Full lineage under the one execution (§63): every stage resolvable.
    for (const artifactId of [
      "parsed-figma-source",
      "figma-source-snapshot",
      "ui-blueprint",
      "project-context",
      "implementation-map",
      "builder-proposal",
      "visual-convergence",
      "proposed-file-changes",
      "v2-final-review",
      "implementation-approval",
      "project-snapshot",
      "file-application-result",
      "implementation-validation",
      "v2-finalization-result",
    ])
      expect(await s.host.artifactStore.getArtifact(artifactId)).not.toBeNull();

    // No agent invocation of any kind happened: the engine has no agent
    // invoker, so the four fakes above were the only "AI" — and none of them
    // is a Coordinator or a legacy specialist.
    expect(s.builderCalls.length).toBe(1);
    expect(s.repairCalls.length).toBe(2);
    expect(s.captureCount()).toBe(3);
  }, 60_000);
});

describe("a regressed last proposal is never auto-approved (§55)", () => {
  test("selection names P1; the flagship refuses approval rather than shipping either", async () => {
    const s = await scenario({
      domQueue: [withWrapper(IMPERFECT_DOM), withWrapper(NEARLY_DOM), withWrapper(REGRESSED_DOM)],
      repairFiles: [REPAIR_TO_PARTIAL, [{ path: "src/App.jsx", content: P2_PAGE }]],
    });
    const result = await s.host.sessions.startDeterministicSession(
      s.host.worker,
      { workerId: s.host.worker.id, request: "regressed", input: s.input },
      DESIGN_TO_CODE_V2_WORKFLOW_ID,
    );
    const report = await s.host.runner.explain(result.session.executionId!);

    // The deterministic selection prefers the earlier P1 over the regressed
    // P2 — and because P1 still carries actionable findings, the eligibility
    // policy fails closed instead of approving anything.
    const convergence = visualConvergenceArtifactSchema.parse(await payloadOf(s.host, "visual-convergence"));
    expect(convergence.selectedIteration).toBe(1);
    const p1 = proposalFor(s.root, [...REPAIR_TO_PARTIAL]).proposal;
    expect(convergence.selectedProposalHash).toBe(canonicalProposalHash(p1));
    expect(report.overview.state).not.toBe("needs_approval");
    expect(report.overview.state).not.toBe("ready");
    // Neither P1 nor the regressed P2 ever reaches the project.
    expect(await readFile(join(s.root, "src", "App.jsx"), "utf8")).toContain("return null");
  }, 60_000);
});

describe("the user's destination decision is binding (§57)", () => {
  test("a plan that contradicts the chosen destination fails before the Builder", async () => {
    const s = await scenario({ destinationPath: "src/Settings.jsx" });
    const before = await readFile(join(s.root, "src", "App.jsx"), "utf8");

    const result = await s.host.sessions.startDeterministicSession(
      s.host.worker,
      { workerId: s.host.worker.id, request: "wrong destination", input: s.input },
      DESIGN_TO_CODE_V2_WORKFLOW_ID,
    );
    const report = await s.host.runner.explain(result.session.executionId!);

    expect(report.overview.state).not.toBe("ready");
    expect(report.overview.state).not.toBe("needs_approval");
    expect(s.mapperCalls.length).toBe(1);
    expect(s.builderCalls.length).toBe(0);
    expect(await readFile(join(s.root, "src", "App.jsx"), "utf8")).toBe(before);
  }, 60_000);
});

describe("required roles fail honestly, with no legacy fallback (§60, §24)", () => {
  test("Mapper unavailable: typed failure, no Builder call, zero writes", async () => {
    const s = await scenario({ mapperUnavailable: true });
    const result = await s.host.sessions.startDeterministicSession(
      s.host.worker,
      { workerId: s.host.worker.id, request: "mapper down", input: s.input },
      DESIGN_TO_CODE_V2_WORKFLOW_ID,
    );
    const report = await s.host.runner.explain(result.session.executionId!);

    expect(report.overview.state).not.toBe("ready");
    expect(s.builderCalls.length).toBe(0);
    expect(s.captureCount()).toBe(0);
    expect(await readFile(join(s.root, "src", "App.jsx"), "utf8")).toContain("return null");
  }, 60_000);
});

describe("no silent visual bypass (§61, §18)", () => {
  test("an unrenderable project stops before approval with zero writes", async () => {
    const s = await scenario({ noPreview: true });
    const result = await s.host.sessions.startDeterministicSession(
      s.host.worker,
      { workerId: s.host.worker.id, request: "no preview", input: s.input },
      DESIGN_TO_CODE_V2_WORKFLOW_ID,
    );
    const report = await s.host.runner.explain(result.session.executionId!);

    // Inconclusive visual evidence is not finalizable: no approval was ever
    // requested and nothing was written.
    expect(report.overview.state).not.toBe("needs_approval");
    expect(report.overview.state).not.toBe("ready");
    const convergence = visualConvergenceArtifactSchema.parse(await payloadOf(s.host, "visual-convergence"));
    expect(convergence.status).toBe("inconclusive");
    expect(await readFile(join(s.root, "src", "App.jsx"), "utf8")).toContain("return null");
  }, 60_000);
});

describe("project drift while waiting for approval (§58, §33)", () => {
  test("approve after an external edit: fail closed, zero DesignFlow writes", async () => {
    const s = await scenario();
    const result = await s.host.sessions.startDeterministicSession(
      s.host.worker,
      { workerId: s.host.worker.id, request: "drift", input: s.input },
      DESIGN_TO_CODE_V2_WORKFLOW_ID,
    );
    const executionId = result.session.executionId!;
    expect((await s.host.runner.explain(executionId)).overview.state).toBe("needs_approval");

    await writeFile(join(s.root, "src", "external-edit.js"), "// user edited mid-approval\n");

    let failed: boolean;
    try {
      const resumed = await s.host.runner.approve(executionId, "approve after drift");
      failed = resumed.state !== "ready";
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
    expect(await readFile(join(s.root, "src", "App.jsx"), "utf8")).toContain("return null");
  }, 60_000);

  test("decline is a terminal non-error outcome with zero writes (§32)", async () => {
    const s = await scenario();
    const result = await s.host.sessions.startDeterministicSession(
      s.host.worker,
      { workerId: s.host.worker.id, request: "decline", input: s.input },
      DESIGN_TO_CODE_V2_WORKFLOW_ID,
    );
    await s.host.runner.reject(result.session.executionId!, "Not this one.");
    expect(await readFile(join(s.root, "src", "App.jsx"), "utf8")).toContain("return null");
  }, 60_000);
});

describe("cancellation during the flagship run (§34, §59)", () => {
  test("aborting during the build phase stops rendering and repairs with zero writes", async () => {
    const controller = new AbortController();
    const s = await scenario({ onBuild: () => controller.abort() });

    const outcome = await s.host.service
      .execute(
        { workflowId: DESIGN_TO_CODE_V2_WORKFLOW_ID, input: s.input },
        { signal: controller.signal },
      )
      .catch((error) => ({ success: false as const, error }));

    // Cancellation propagated: no repair Builder call, no further render, no
    // approval, no writes.
    expect((outcome as { success?: boolean }).success).not.toBe(true);
    expect(s.builderCalls.length).toBe(1);
    expect(s.repairCalls.length).toBe(0);
    expect(await readFile(join(s.root, "src", "App.jsx"), "utf8")).toContain("return null");
  }, 60_000);
});

describe("Critic unavailable keeps deterministic evaluation working (§62)", () => {
  test("the run converges on deterministic findings alone", async () => {
    const s = await scenario({
      domQueue: [withWrapper(IMPERFECT_DOM), withWrapper(FAITHFUL_DOM)],
      repairPages: [P1_PAGE],
    });
    // The evaluator in this host wires no critic at all.
    const result = await s.host.sessions.startDeterministicSession(
      s.host.worker,
      { workerId: s.host.worker.id, request: "no critic", input: s.input },
      DESIGN_TO_CODE_V2_WORKFLOW_ID,
    );
    const report = await s.host.runner.explain(result.session.executionId!);
    expect(report.overview.state).toBe("needs_approval");

    const convergence = visualConvergenceArtifactSchema.parse(await payloadOf(s.host, "visual-convergence"));
    expect(["converged", "converged_with_findings"]).toContain(convergence.status);
  }, 60_000);
});

void ((): ProposedFileChanges | undefined => undefined);
