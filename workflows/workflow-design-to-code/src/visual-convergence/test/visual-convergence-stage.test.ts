// workflows/workflow-design-to-code/src/visual-convergence/test/visual-convergence-stage.test.ts
//
// V2-6: the bounded convergence loop, executed through a real engine, a real
// artifact store and the real deterministic evaluator. No model is invoked,
// the legacy Visual Correction agent is never registered, and the user's
// project is never written to.
import { afterEach, describe, expect, test } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { visualConvergenceArtifactSchema, type ProposedFileChanges } from "@designflow/sdk";

import { V2_CONVERGENCE_ARTIFACT_IDS, type VisualRepairBuilder } from "../visual-convergence-types";
import { createConvergenceHost, queuedRenderer } from "./support/convergence-host";
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

const WORKFLOW_ID = "design-to-code-v2-convergence";
const VIEWPORTS = [{ id: "desktop", width: 390, height: 844 }];

/**
 * The screen's own wrapper, as the fixture pages actually render it: a `main`
 * holding every piece of copy. Without it the screen-frame expectation has no
 * element to correspond to.
 */
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

/** Repair 1: header and field fixed, button still wrong, nav still missing. */
const PARTIAL_DOM: readonly FakeElement[] = [
  { selector: "h1", tagName: "h1", text: "Add Transaction", height: 72, instrumentationRef: SCREEN_REQUIREMENT },
  { selector: "div", tagName: "div", text: "Enter amount", height: 56 },
  { selector: "button", tagName: "button", text: "Fill the information", height: 30 },
];

/** A repair that fixes the button but loses the bottom navigation. */
const REGRESSED_DOM: readonly FakeElement[] = [
  { selector: "h1", tagName: "h1", text: "Add Transaction", height: 72, instrumentationRef: SCREEN_REQUIREMENT },
  { selector: "div", tagName: "div", text: "Enter amount", height: 56 },
  { selector: "button", tagName: "button", text: "Fill the information", height: 56 },
];

/** Repair 1 of the regression scenario: everything right except the button. */
const NEARLY_DOM: readonly FakeElement[] = [
  ...PARTIAL_DOM.slice(0, 2),
  { selector: "button", tagName: "button", text: "Fill the information", height: 30 },
  { selector: "nav", tagName: "nav", height: 68, width: 390, instrumentationRef: NAV_REQUIREMENT },
];

const PARTIAL_PAGE = IMPERFECT_PAGE.replace("height: 40", "height: 72").replace("height: 32", "height: 56");

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** A scripted Builder seam: each call hands back the next validated proposal. */
function scriptedRepairBuilder(
  root: string,
  pages: readonly (readonly { path: string; content: string }[])[],
): { builder: VisualRepairBuilder; calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    builder: async (input) => {
      calls.push(input);
      const files = pages[calls.length - 1];
      if (files === undefined) return { status: "exhausted", attempts: 3, reason: "script exhausted" };
      return { status: "valid", proposal: proposalFor(root, [...files]).proposal, attempts: 1 };
    },
  };
}

async function run(options: {
  readonly domQueue: readonly (readonly FakeElement[])[];
  readonly repairPages?: readonly (readonly { path: string; content: string }[])[];
  readonly repairBuilder?: VisualRepairBuilder;
  readonly maxEvaluatedStates?: number;
}) {
  const root = await fixtureProject();
  roots.push(root);

  const { proposal } = proposalFor(root, [{ path: "src/App.jsx", content: IMPERFECT_PAGE }]);
  const scripted =
    options.repairPages !== undefined ? scriptedRepairBuilder(root, options.repairPages) : undefined;
  const rendererHandle = queuedRenderer(options.domQueue);

  const host = createConvergenceHost({
    renderer: rendererHandle.renderer,
    captureCount: rendererHandle.calls,
    ...(scripted !== undefined
      ? { repairBuilder: scripted.builder }
      : options.repairBuilder !== undefined
        ? { repairBuilder: options.repairBuilder }
        : {}),
  });

  const handle = await host.runner.start({
    workflowId: WORKFLOW_ID,
    input: {
      project: { id: "v2-visual-project", name: "Fixture", rootPath: root },
      blueprint: BLUEPRINT,
      projectContext: { schemaVersion: "1", projectId: "v2-visual-project" },
      implementationMap: MAP,
      proposal,
      viewports: VIEWPORTS,
      ...(options.maxEvaluatedStates !== undefined ? { maxEvaluatedStates: options.maxEvaluatedStates } : {}),
    },
  });

  return { host, handle, root, scripted, initialProposal: proposal };
}

async function convergenceOf(host: Awaited<ReturnType<typeof run>>["host"]) {
  const artifact = await host.artifactStore.getArtifact(V2_CONVERGENCE_ARTIFACT_IDS.convergence);
  expect(artifact).not.toBeNull();
  const stored = await host.artifactStore.get(String(artifact!.metadata!.payloadId));
  return visualConvergenceArtifactSchema.parse(stored!.data);
}

async function payload(host: Awaited<ReturnType<typeof run>>["host"], ref: string): Promise<Record<string, unknown>> {
  const stored = await host.artifactStore.get(ref);
  expect(stored).not.toBeNull();
  return stored!.data as Record<string, unknown>;
}

const REPAIR_TO_PARTIAL = [{ path: "src/App.jsx", content: PARTIAL_PAGE }];
const REPAIR_TO_FAITHFUL = [
  { path: "src/App.jsx", content: FAITHFUL_PAGE },
  { path: "src/BottomNavigation.jsx", content: NAV_COMPONENT },
];

describe("Spendly-shaped convergence (§46)", () => {
  test("initial + two repairs converge, freshly rendered each time, with full lineage", async () => {
    const { host, handle, scripted } = await run({
      domQueue: [withWrapper(IMPERFECT_DOM), withWrapper(PARTIAL_DOM), withWrapper(FAITHFUL_DOM)],
      repairPages: [REPAIR_TO_PARTIAL, REPAIR_TO_FAITHFUL],
    });
    expect(handle.state).toBe("ready");

    const convergence = await convergenceOf(host);
    expect(convergence.iterationsPerformed).toBe(3);
    expect(["converged", "converged_with_findings"]).toContain(convergence.status);
    expect(convergence.selectedIteration).toBe(2);

    // Fresh render per iteration: the browser was driven once per state.
    expect(host.captureCount()).toBe(3);

    // Three distinct validated proposal identities, chained by lineage.
    const hashes = convergence.iterations.map((iteration) => iteration.proposalHash);
    expect(new Set(hashes).size).toBe(3);
    expect(convergence.iterations[1]!.repairsProposalHash).toBe(hashes[0]);
    expect(convergence.iterations[2]!.repairsProposalHash).toBe(hashes[1]);

    // binding.proposalHash is the identity — never the instrumented hash.
    for (const iteration of convergence.iterations) {
      const rendered = await payload(host, iteration.renderedStateRef);
      const binding = rendered.binding as { proposalHash: string };
      const provenance = rendered.provenance as { instrumentedProposalHash?: string };
      expect(binding.proposalHash).toBe(iteration.proposalHash);
      if (provenance.instrumentedProposalHash !== undefined)
        expect(provenance.instrumentedProposalHash).not.toBe(iteration.proposalHash);
      const report = await payload(host, iteration.reportRef);
      expect((report.binding as { proposalHash: string }).proposalHash).toBe(iteration.proposalHash);
    }

    // The Builder saw bounded evidence and an immutable plan, twice.
    expect(scripted!.calls).toHaveLength(2);
    const firstCall = scripted!.calls[0] as { repairEvidence: { planIsImmutable: boolean }; implementationMap: unknown };
    expect(firstCall.repairEvidence.planIsImmutable).toBe(true);
    expect(firstCall.implementationMap).toEqual(MAP);

    // Metrics tell the story of the run.
    expect(convergence.metrics.visualConvergenceRepairCount).toBe(2);
    expect(convergence.metrics.visualConvergenceStopReason).toBe(convergence.stopReason);
  }, 60_000);

  test("the whole loop never writes to the registered project (§55)", async () => {
    const { host, root } = await run({
      domQueue: [withWrapper(IMPERFECT_DOM), withWrapper(PARTIAL_DOM), withWrapper(FAITHFUL_DOM)],
      repairPages: [REPAIR_TO_PARTIAL, REPAIR_TO_FAITHFUL],
    });
    await convergenceOf(host);

    expect(await readFile(join(root, "src", "App.jsx"), "utf8")).toContain("return null");
    const artifact = await host.artifactStore.getArtifact(V2_CONVERGENCE_ARTIFACT_IDS.convergence);
    expect(artifact?.metadata?.projectFilesChanged).toBe(false);
  }, 60_000);
});

describe("regression protection (§47, §22, §23)", () => {
  test("a regressing last repair is recorded, and selection prefers the stronger prior state", async () => {
    const { host } = await run({
      domQueue: [withWrapper(IMPERFECT_DOM), withWrapper(NEARLY_DOM), withWrapper(REGRESSED_DOM)],
      repairPages: [REPAIR_TO_PARTIAL, REPAIR_TO_FAITHFUL],
    });
    const convergence = await convergenceOf(host);

    expect(convergence.iterationsPerformed).toBe(3);
    // Iteration 2 fixed the button but lost the required navigation.
    expect(convergence.iterations[2]!.quality.missingRequiredCount).toBe(1);
    expect(convergence.iterations[2]!.comparison?.introduced).toBeGreaterThan(0);
    // The final candidate is NOT automatically the last proposal.
    expect(convergence.selectedIteration).toBe(1);
    expect(convergence.selectedProposalHash).toBe(convergence.iterations[1]!.proposalHash);
  }, 60_000);
});

describe("no-progress protection (§48, §21)", () => {
  test("an unchanged report stops the loop instead of spending the budget", async () => {
    const { host } = await run({
      domQueue: [withWrapper(IMPERFECT_DOM), withWrapper(IMPERFECT_DOM), withWrapper(IMPERFECT_DOM)],
      repairPages: [REPAIR_TO_PARTIAL, REPAIR_TO_FAITHFUL],
    });
    const convergence = await convergenceOf(host);

    expect(convergence.iterationsPerformed).toBe(2);
    expect(convergence.stopReason).toBe("no_measurable_improvement");
    expect(convergence.notes.join(" ")).toContain("NO_MEASURABLE_IMPROVEMENT");
  }, 60_000);
});

describe("every proposal stays independently applicable (§30, §31)", () => {
  test("a repair bound to a different project base is refused, never rendered", async () => {
    const rogue: VisualRepairBuilder = async () => {
      const files: ProposedFileChanges["files"] = [
        { path: "src/App.jsx", action: "modify", content: PARTIAL_PAGE, reason: "r", relatedDesignNodeIds: [] },
      ];
      return {
        status: "valid",
        attempts: 1,
        proposal: {
          schemaVersion: "1",
          projectId: "v2-visual-project",
          baseProjectFingerprint: "f".repeat(64),
          files,
          packageChanges: [],
          commandsRequested: [],
          assumptions: [],
          unresolvedItems: [],
        },
      };
    };
    const { host } = await run({ domQueue: [withWrapper(IMPERFECT_DOM)], repairBuilder: rogue });
    const convergence = await convergenceOf(host);

    expect(convergence.status).toBe("builder_failed");
    expect(convergence.iterationsPerformed).toBe(1);
    expect(host.captureCount()).toBe(1);
    expect(convergence.notes.join(" ")).toContain("original project base");
    // The initial validated state is still selectable and selected.
    expect(convergence.selectedIteration).toBe(0);
  }, 60_000);
});

describe("bounds and honest stops", () => {
  test("without a repair Builder the loop stops honestly at repair_required", async () => {
    const { host } = await run({ domQueue: [withWrapper(IMPERFECT_DOM)] });
    const convergence = await convergenceOf(host);

    expect(convergence.status).toBe("repair_required");
    expect(convergence.iterationsPerformed).toBe(1);
    expect(convergence.selectedIteration).toBe(0);
  }, 60_000);

  test("a lower configured budget is honored; nothing can exceed the hard maximum", async () => {
    const { host, scripted } = await run({
      domQueue: [withWrapper(IMPERFECT_DOM), withWrapper(PARTIAL_DOM), withWrapper(FAITHFUL_DOM)],
      repairPages: [REPAIR_TO_PARTIAL, REPAIR_TO_FAITHFUL],
      maxEvaluatedStates: 2,
    });
    const convergence = await convergenceOf(host);

    expect(convergence.iterationLimit).toBe(2);
    expect(convergence.iterationsPerformed).toBe(2);
    expect(convergence.stopReason).toBe("iteration_limit_reached");
    expect(scripted!.calls).toHaveLength(1);
  }, 60_000);

  test("a byte-identical repair proposal is not re-rendered (§9)", async () => {
    const { host } = await run({
      domQueue: [withWrapper(IMPERFECT_DOM)],
      // A "repair" that hands back exactly the proposal it was asked to repair.
      repairBuilder: async ({ previousProposal }) => ({ status: "valid", attempts: 1, proposal: previousProposal }),
    });
    const convergence = await convergenceOf(host);

    expect(convergence.stopReason).toBe("no_measurable_improvement");
    expect(host.captureCount()).toBe(1);
    expect(convergence.notes.join(" ")).toContain("byte-identical");
  }, 60_000);
});
