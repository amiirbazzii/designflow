// workflows/workflow-design-to-code/src/finalization/test/visual-finalization.test.ts
//
// V2-7: displayed = approved = applied, proven through a real engine, a real
// approval gate, real snapshots and real filesystem writes to a throwaway
// fixture project. Zero model calls — the host wires no model seam at all.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonicalProposalHash,
  v2FinalizationResultSchema,
  finalImplementationReviewSchema,
  type ProposedFileChanges,
  type VisualConvergenceArtifact,
} from "@designflow/sdk";

import { unappliedFinalizationResult } from "../finalization-capabilities";
import { renderFinalizationReport } from "../finalization-report";
import { createFinalizationHost, type FinalizationHost } from "./support/finalization-host";
import { fixtureProject, proposalFor } from "../../v2-visual/test/support/spendly-v2-fixture";

const WORKFLOW_ID = "design-to-code-v2-finalize";

const P0_PAGE = `export default function App() { return <main><h1 style={{ height: 40 }}>Add Transaction</h1></main>; }\n`;
const P1_PAGE = `export default function App() { return <main><h1 style={{ height: 72 }}>Add Transaction</h1></main>; }\n`;
const P2_PAGE = `export default function App() { return <main>{/* regressed */}</main>; }\n`;

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

interface Fixture {
  readonly host: FinalizationHost;
  readonly root: string;
  readonly stateDirectory: string;
  readonly convergence: VisualConvergenceArtifact;
  readonly proposals: readonly ProposedFileChanges[];
  readonly refs: readonly string[];
}

/** Byte-level image of the project, for zero-write assertions. */
async function projectImage(root: string): Promise<Map<string, string>> {
  const image = new Map<string, string>();
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else image.set(path, await readFile(path, "utf8"));
    }
  };
  await walk(root);
  return image;
}

async function fixture(options: {
  readonly selected?: number;
  readonly pages?: readonly string[];
  readonly build?: string;
  readonly mutateConvergence?: (convergence: VisualConvergenceArtifact) => VisualConvergenceArtifact;
} = {}): Promise<Fixture> {
  const root = await fixtureProject(options.build ?? "bun --version");
  const stateDirectory = await mkdtemp(join(tmpdir(), "designflow-finalize-state-"));
  roots.push(root, stateDirectory);

  const host = createFinalizationHost();

  const pages = options.pages ?? [P0_PAGE, P1_PAGE, P2_PAGE];
  const proposals: ProposedFileChanges[] = [];
  const refs: string[] = [];
  for (const page of pages) {
    const { proposal } = proposalFor(root, [{ path: "src/App.jsx", content: page }]);
    proposals.push(proposal);
    const stored = await host.artifactStore.save(proposal, { type: "implementation.builder-proposal" });
    refs.push(stored.id);
  }

  const selected = options.selected ?? 1;
  const base = proposals[0]!.baseProjectFingerprint;

  let convergence: VisualConvergenceArtifact = {
    schemaVersion: "1",
    status: "exhausted",
    stopReason: "regression_detected",
    iterationLimit: 3,
    iterationsPerformed: proposals.length,
    iterations: proposals.map((proposal, iteration) => ({
      iteration,
      proposalHash: canonicalProposalHash(proposal),
      ...(iteration > 0 ? { repairsProposalHash: canonicalProposalHash(proposals[iteration - 1]!) } : {}),
      proposalRef: refs[iteration]!,
      renderedStateRef: `rendered-${iteration}`,
      reportRef: `report-${iteration}`,
      outcome: iteration === selected ? "pass_with_findings" : "needs_refinement",
      quality: {
        renderable: true,
        missingRequiredCount: iteration === selected ? 0 : 1,
        criticalCount: 0,
        majorCount: iteration === selected ? 1 : 3,
        unresolvedExpectationCount: 0,
        actionableCount: iteration === selected ? 1 : 4,
      },
      builderAttempts: 1,
    })),
    selectedIteration: selected,
    selectedProposalRef: refs[selected]!,
    selectedProposalHash: canonicalProposalHash(proposals[selected]!),
    selectedRenderedStateRef: `rendered-${selected}`,
    selectedVisualDeltaReportRef: `report-${selected}`,
    selectionPolicyVersion: "1",
    baseProjectFingerprint: base,
    metrics: {
      visualConvergenceIterationCount: proposals.length,
      visualConvergenceRepairCount: proposals.length - 1,
      visualConvergenceInitialFindingCount: 4,
      visualConvergenceFinalFindingCount: 1,
      visualConvergenceResolvedCount: 3,
      visualConvergenceImprovedCount: 0,
      visualConvergenceRegressedCount: 1,
      visualConvergenceSelectedIteration: selected,
      visualConvergenceStopReason: "regression_detected",
    },
    notes: [],
  };
  if (options.mutateConvergence !== undefined) convergence = options.mutateConvergence(convergence);

  return { host, root, stateDirectory, convergence, proposals, refs };
}

function inputOf(f: Fixture, overrides: Record<string, unknown> = {}) {
  return {
    project: { id: "v2-visual-project", name: "Fixture", rootPath: f.root },
    stateDirectory: f.stateDirectory,
    convergence: f.convergence,
    ...overrides,
  };
}

async function payloadOf(host: FinalizationHost, artifactId: string): Promise<Record<string, unknown>> {
  const artifact = await host.artifactStore.getArtifact(artifactId);
  expect(artifact).not.toBeNull();
  const stored = await host.artifactStore.get(String(artifact!.metadata!.payloadId));
  expect(stored).not.toBeNull();
  return stored!.data as Record<string, unknown>;
}

describe("selected-earlier-iteration acceptance (§41, §13)", () => {
  test("P1 is displayed, approved and applied; P2 never reaches the project", async () => {
    const f = await fixture({ selected: 1 });
    const before = await projectImage(f.root);

    const handle = await f.host.runner.start({ workflowId: WORKFLOW_ID, input: inputOf(f) });
    expect(handle.state).toBe("needs_approval");
    // Nothing is written while waiting for the human.
    expect(await projectImage(f.root)).toEqual(before);

    // The review is derived from the exact selected proposal — P1.
    const review = finalImplementationReviewSchema.parse(await payloadOf(f.host, "v2-final-review"));
    expect(review.proposalHash).toBe(canonicalProposalHash(f.proposals[1]!));
    expect(review.convergence.selectedIteration).toBe(1);
    expect(review.files[0]!.bytes).toBe(new TextEncoder().encode(P1_PAGE).length);

    const approved = await f.host.runner.approve(handle.executionId, "Apply the selected implementation.");
    expect(approved.state).toBe("ready");

    // Applied content is P1's, byte for byte; P2's content appears nowhere.
    const applied = await readFile(join(f.root, "src", "App.jsx"), "utf8");
    expect(applied).toBe(P1_PAGE);
    expect(applied).not.toContain("regressed");

    const result = v2FinalizationResultSchema.parse(await payloadOf(f.host, "v2-finalization-result"));
    expect(result.status).toBe("applied_validated");
    expect(result.binding.proposalHash).toBe(canonicalProposalHash(f.proposals[1]!));
    expect(result.appliedProposalHash).toBe(result.binding.proposalHash);
    expect(result.metrics.finalizationBindingChecks).toBeGreaterThanOrEqual(3);
    expect(result.metrics.finalizationSelectedIteration).toBe(1);

    const text = renderFinalizationReport(result, review);
    expect(text).toContain("Implementation applied");
    expect(text).toContain("2 of 3");
    expect(text).toContain("✓ Applied exact approved proposal");
  }, 30_000);
});

describe("binding failures fail closed with zero writes", () => {
  test("a tampered proposal payload is refused (§21, §40E)", async () => {
    const f = await fixture({
      mutateConvergence: (convergence) => ({ ...convergence, selectedProposalHash: "0".repeat(64), iterations: convergence.iterations.map((entry) => entry.iteration === 1 ? { ...entry, proposalHash: "0".repeat(64) } : entry) }),
    });
    const before = await projectImage(f.root);

    const handle = await f.host.runner.start({ workflowId: WORKFLOW_ID, input: inputOf(f) });
    expect(handle.state).not.toBe("needs_approval");
    expect(handle.state).not.toBe("ready");
    expect(await projectImage(f.root)).toEqual(before);
  }, 30_000);

  test("substituting P2's payload under P1's hash is refused (§22, §40F)", async () => {
    const f = await fixture({
      mutateConvergence: (convergence) => ({ ...convergence, selectedProposalRef: convergence.iterations[2]!.proposalRef, iterations: convergence.iterations.map((entry) => entry.iteration === 1 ? { ...entry, proposalRef: convergence.iterations[2]!.proposalRef } : entry) }),
    });
    const before = await projectImage(f.root);

    const handle = await f.host.runner.start({ workflowId: WORKFLOW_ID, input: inputOf(f) });
    expect(handle.state).not.toBe("ready");
    expect(await projectImage(f.root)).toEqual(before);
  }, 30_000);

  test("project drift before review fails closed (§40B, §40J)", async () => {
    const f = await fixture();
    await writeFile(join(f.root, "src", "App.jsx"), "// user edited this after convergence\n");
    const before = await projectImage(f.root);

    const handle = await f.host.runner.start({ workflowId: WORKFLOW_ID, input: inputOf(f) });
    expect(handle.state).not.toBe("needs_approval");
    expect(await projectImage(f.root)).toEqual(before);
  }, 30_000);

  test("project drift after approval, before apply, fails closed (§20, §40D)", async () => {
    const f = await fixture();
    const handle = await f.host.runner.start({ workflowId: WORKFLOW_ID, input: inputOf(f) });
    expect(handle.state).toBe("needs_approval");

    // External edit while the approval sits open.
    await writeFile(join(f.root, "src", "extra.js"), "// external edit\n");
    const before = await projectImage(f.root);

    let failed: boolean;
    try {
      const resumed = await f.host.runner.approve(handle.executionId, "approve after drift");
      failed = resumed.state !== "ready";
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
    // The approved proposal was never written.
    expect(await projectImage(f.root)).toEqual(before);
    expect(await readFile(join(f.root, "src", "App.jsx"), "utf8")).toContain("return null");
  }, 30_000);

  test("a wrong project id is refused (§40I)", async () => {
    const f = await fixture();
    const before = await projectImage(f.root);
    const handle = await f.host.runner.start({
      workflowId: WORKFLOW_ID,
      input: inputOf(f, { project: { id: "someone-elses-project", name: "Other", rootPath: f.root } }),
    });
    expect(handle.state).not.toBe("ready");
    expect(handle.state).not.toBe("needs_approval");
    expect(await projectImage(f.root)).toEqual(before);
  }, 30_000);

  test("an unselectable convergence record finalizes nothing", async () => {
    const f = await fixture({
      mutateConvergence: (convergence) => {
        const { selectedIteration, selectedProposalRef, selectedProposalHash, ...rest } = convergence;
        void selectedIteration;
        void selectedProposalRef;
        void selectedProposalHash;
        return { ...rest } as VisualConvergenceArtifact;
      },
    });
    const before = await projectImage(f.root);
    const handle = await f.host.runner.start({ workflowId: WORKFLOW_ID, input: inputOf(f) });
    expect(handle.state).not.toBe("ready");
    expect(await projectImage(f.root)).toEqual(before);
  }, 30_000);
});

describe("human authority (§17, §36)", () => {
  test("declining applies nothing, and the typed outcome says so", async () => {
    const f = await fixture();
    const before = await projectImage(f.root);
    const handle = await f.host.runner.start({ workflowId: WORKFLOW_ID, input: inputOf(f) });
    expect(handle.state).toBe("needs_approval");

    await f.host.runner.reject(handle.executionId, "Not this one.");
    expect(await projectImage(f.root)).toEqual(before);

    const result = unappliedFinalizationResult("approval_declined", f.convergence, {
      projectId: "v2-visual-project",
    });
    expect(result.status).toBe("approval_declined");
    expect(result.metrics.finalizationFilesApplied).toBe(0);
    expect(result.metrics.finalizationApprovalOutcome).toBe("declined");
    expect(renderFinalizationReport(result)).toContain("no files were changed");
  }, 30_000);

  test("no agent output can grant approval: without the human gate the run waits forever", async () => {
    const f = await fixture();
    const before = await projectImage(f.root);
    const handle = await f.host.runner.start({ workflowId: WORKFLOW_ID, input: inputOf(f) });

    // The host wires no model, no builder, no critic — and the run still sits
    // at the human gate with zero writes. Only `runner.approve` (the
    // ApprovalManager, i.e. the human) can move it.
    expect(handle.state).toBe("needs_approval");
    expect(await projectImage(f.root)).toEqual(before);
  }, 30_000);

  test("an expired approval is a typed zero-write outcome (§37, §40G)", async () => {
    const f = await fixture();
    const result = unappliedFinalizationResult("approval_expired", f.convergence, {
      projectId: "v2-visual-project",
      approvalId: "approval-1",
    });
    expect(result.status).toBe("approval_expired");
    expect(result.metrics.finalizationApprovalOutcome).toBe("expired");
    expect(result.metrics.finalizationFilesApplied).toBe(0);
    expect(renderFinalizationReport(result)).toContain("Approve again to apply the same exact proposal");
  });
});

describe("rollback acceptance (§42, §27, §28)", () => {
  test("apply succeeds, required validation fails, the project is restored", async () => {
    // The fixture's build fails exactly when the proposal's marker file exists.
    const breakingPage = P1_PAGE;
    const f = await fixture({
      build: "node -e \"process.exit(require('fs').existsSync('src/BREAK.js') ? 1 : 0)\"",
      pages: [P0_PAGE, breakingPage],
      selected: 1,
    });
    // Give the selected proposal a second file that breaks the build.
    const { proposal } = proposalFor(f.root, [
      { path: "src/App.jsx", content: breakingPage },
      { path: "src/BREAK.js", content: "// breaks the build\n" },
    ]);
    const stored = await f.host.artifactStore.save(proposal, { type: "implementation.builder-proposal" });
    const convergence: VisualConvergenceArtifact = {
      ...f.convergence,
      selectedProposalRef: stored.id,
      selectedProposalHash: canonicalProposalHash(proposal),
      iterations: f.convergence.iterations.map((entry) =>
        entry.iteration === 1
          ? { ...entry, proposalRef: stored.id, proposalHash: canonicalProposalHash(proposal) }
          : entry,
      ),
    };
    const before = await projectImage(f.root);

    const handle = await f.host.runner.start({
      workflowId: WORKFLOW_ID,
      input: { ...inputOf(f), convergence },
    });
    expect(handle.state).toBe("needs_approval");
    const resumed = await f.host.runner.approve(handle.executionId, "Approve controlled validation failure.");
    expect(resumed.state).toBe("ready");

    // Snapshot existed, rollback executed, project byte-identical again.
    expect(await projectImage(f.root)).toEqual(before);

    const result = v2FinalizationResultSchema.parse(await payloadOf(f.host, "v2-finalization-result"));
    expect(result.status).toBe("validation_failed_rolled_back");
    expect(result.rollbackPerformed).toBe(true);
    expect(result.metrics.finalizationRollbackPerformed).toBe(true);
    expect(result.metrics.finalizationFilesApplied).toBe(0);
    expect(renderFinalizationReport(result)).toContain("restored from the pre-write snapshot");
  }, 30_000);
});
