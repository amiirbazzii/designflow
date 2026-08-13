// workflows/workflow-design-to-code/src/v2-visual/test/v2-visual-stage.test.ts
//
// V2-5.1: the internal V2 visual stage, executed.
//
// Not function composition in a unit test — a real engine, a real artifact
// store, real persistence and a real lineage that is resolved back out of
// storage. No model is invoked and no user project is touched.
import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";

import { V2_VISUAL_ARTIFACT_IDS, V2_VISUAL_ARTIFACT_TYPES } from "../v2-visual-types";
import { createV2VisualHost } from "./support/v2-visual-host";
import {
  BLUEPRINT,
  DESIGN_IDENTITY,
  FAITHFUL_DOM,
  FAITHFUL_PAGE,
  IMPERFECT_DOM,
  IMPERFECT_PAGE,
  MAP,
  NAV_COMPONENT,
  fakeRenderer,
  fixtureProject,
  png,
  proposalFor,
} from "./support/spendly-v2-fixture";

const WORKFLOW_ID = "design-to-code-v2-visual";
const VIEWPORTS = [{ id: "desktop", width: 390, height: 844 }];

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function run(options: {
  readonly page?: string;
  readonly dom?: typeof IMPERFECT_DOM;
  readonly critic?: (evidence: unknown) => Promise<unknown>;
  readonly evaluator?: unknown;
  readonly reference?: { bytes: Uint8Array; nodeId?: string };
  readonly renderedBytes?: Uint8Array;
} = {}) {
  const root = await fixtureProject();
  roots.push(root);

  const files = [{ path: "src/App.jsx", content: options.page ?? IMPERFECT_PAGE }];
  if ((options.page ?? IMPERFECT_PAGE) === FAITHFUL_PAGE)
    files.push({ path: "src/BottomNavigation.jsx", content: NAV_COMPONENT });

  const { proposal } = proposalFor(root, files);
  const host = createV2VisualHost({
    renderer: fakeRenderer(options.dom ?? IMPERFECT_DOM, options.renderedBytes),
    ...(options.critic !== undefined ? { critic: options.critic } : {}),
    ...("evaluator" in options ? { evaluator: options.evaluator } : {}),
  });

  // The canonical design screenshot is already an artifact; the stage resolves
  // it by id rather than being handed pixels.
  let referenceScreenshots;
  if (options.reference !== undefined) {
    const stored = await host.artifactStore.save(Buffer.from(options.reference.bytes).toString("base64"), {
      type: "visual-validation.screenshot",
      sourceType: "reference",
    });
    referenceScreenshots = [
      {
        viewportId: "desktop",
        artifactId: stored.id,
        evidenceId: "reference-1:1-desktop",
        fileKey: DESIGN_IDENTITY.fileKey,
        nodeId: options.reference.nodeId ?? DESIGN_IDENTITY.nodeId,
        captureMethod: "figma-mcp",
      },
    ];
  }

  const handle = await host.runner.start({
    workflowId: WORKFLOW_ID,
    input: {
      project: { id: "v2-visual-project", name: "Fixture", rootPath: root },
      blueprint: BLUEPRINT,
      projectContext: { schemaVersion: "1", projectId: "v2-visual-project" },
      implementationMap: MAP,
      proposal,
      viewports: VIEWPORTS,
      designIdentity: DESIGN_IDENTITY,
      ...(referenceScreenshots !== undefined ? { referenceScreenshots } : {}),
    },
  });

  return { host, handle, root };
}

/** Resolves an artifact's payload back out of storage, as a reader would. */
async function payloadOf(
  host: Awaited<ReturnType<typeof run>>["host"],
  artifactId: string,
): Promise<Record<string, never> & { [key: string]: unknown }> {
  const artifact = await host.artifactStore.getArtifact(artifactId);
  const payloadId = artifact?.metadata?.payloadId;
  expect(typeof payloadId).toBe("string");
  const stored = await host.artifactStore.get(String(payloadId));
  expect(stored).not.toBeNull();
  return stored!.data as Record<string, never> & { [key: string]: unknown };
}

describe("internal V2 visual stage", () => {
  test("runs end to end and persists both new artifacts", async () => {
    const { host, handle } = await run();
    expect(handle.state).toBe("ready");

    const rendered = await host.artifactStore.getArtifact(V2_VISUAL_ARTIFACT_IDS.renderedState);
    const report = await host.artifactStore.getArtifact(V2_VISUAL_ARTIFACT_IDS.report);

    expect(rendered?.type).toBe(V2_VISUAL_ARTIFACT_TYPES.renderedState);
    expect(report?.type).toBe(V2_VISUAL_ARTIFACT_TYPES.report);
  }, 30_000);

  test("the lineage from Blueprint to report is inspectable in storage", async () => {
    const { host } = await run();

    const lineage = await host.artifactStore.getLineage(V2_VISUAL_ARTIFACT_IDS.report);
    for (const ancestor of [
      V2_VISUAL_ARTIFACT_IDS.blueprint,
      V2_VISUAL_ARTIFACT_IDS.projectContext,
      V2_VISUAL_ARTIFACT_IDS.implementationMap,
      V2_VISUAL_ARTIFACT_IDS.proposal,
      V2_VISUAL_ARTIFACT_IDS.renderedState,
    ])
      expect(lineage.ancestors).toContain(ancestor);
  }, 30_000);

  test("no stage loses the exact source identities", async () => {
    const { host } = await run();
    const rendered = await payloadOf(host, V2_VISUAL_ARTIFACT_IDS.renderedState);
    const report = await payloadOf(host, V2_VISUAL_ARTIFACT_IDS.report);

    expect(rendered.binding.blueprintArtifactId).toBe(V2_VISUAL_ARTIFACT_IDS.blueprint);
    expect(rendered.binding.implementationMapArtifactId).toBe(V2_VISUAL_ARTIFACT_IDS.implementationMap);
    expect(rendered.binding.proposalArtifactId).toBe(V2_VISUAL_ARTIFACT_IDS.proposal);
    expect(rendered.binding.proposalHash).toMatch(/^[a-f0-9]{64}$/);
    // The report is bound to the same proposal that was rendered.
    expect(report.binding.proposalHash).toBe(rendered.binding.proposalHash);
  }, 30_000);

  test("screenshots are stored as their own payloads, never inlined", async () => {
    const { host } = await run();
    const rendered = await payloadOf(host, V2_VISUAL_ARTIFACT_IDS.renderedState);

    expect(rendered.viewports[0].screenshotArtifactId).toBeDefined();
    expect(rendered.viewports[0].screenshotContentHash).toMatch(/^[a-f0-9]{64}$/);
    // The stored payload is a real image, and it is not in the RenderedState.
    const image = await host.artifactStore.get(String(rendered.viewports[0].screenshotArtifactId));
    expect(typeof image?.data).toBe("string");
    expect(JSON.stringify(rendered).length).toBeLessThan(200_000);
  }, 30_000);

  test("a Spendly-shaped imperfect implementation is caught before approval", async () => {
    const { host } = await run();
    const report = await payloadOf(host, V2_VISUAL_ARTIFACT_IDS.report);
    const explanations = report.findings.map((finding: { explanation: string }) => finding.explanation).join("\n");

    expect(report.outcome).not.toBe("pass");
    // Header, amount field and primary button all render at the wrong height.
    expect(explanations).toContain("Header renders at 40px");
    expect(explanations).toContain("Amount field renders at 32px");
    expect(explanations).toContain("Primary button renders at 30px");
    // And the bottom navigation, which carries no copy at all, is missing.
    expect(explanations).toContain("BottomNavigation");
    expect(
      report.findings.some(
        (finding: { category: string; explanation: string }) =>
          finding.category === "missing-element" && finding.explanation.includes("BottomNavigation"),
      ),
    ).toBe(true);
  }, 30_000);

  test("a non-textual element is identified by a host marker, not by copy", async () => {
    const { host } = await run({ page: FAITHFUL_PAGE, dom: FAITHFUL_DOM });
    const report = await payloadOf(host, V2_VISUAL_ARTIFACT_IDS.report);

    expect(report.correspondence.signalsUsed).toContain("instrumentation");
    expect(
      report.findings.some((finding: { explanation: string }) => finding.explanation.includes("BottomNavigation")),
    ).toBe(false);
  }, 30_000);

  test("pixel comparison is populated from the canonical design screenshot", async () => {
    const white = png(390, 844, () => [255, 255, 255, 255]);
    const black = png(390, 844, () => [0, 0, 0, 255]);
    const { host } = await run({ reference: { bytes: black }, renderedBytes: white });

    const rendered = await payloadOf(host, V2_VISUAL_ARTIFACT_IDS.renderedState);
    const comparison = rendered.pixelComparisons[0];

    expect(comparison.status).toBe("compared");
    expect(comparison.mismatchRatio).toBeGreaterThan(0.9);
    expect(comparison.referenceEvidenceId).toBe("reference-1:1-desktop");
    expect(comparison.expectedViewport).toEqual({ width: 390, height: 844 });

    const report = await payloadOf(host, V2_VISUAL_ARTIFACT_IDS.report);
    expect(
      report.findings.some((finding: { findingId: string }) => finding.findingId.startsWith("finding:pixel:")),
    ).toBe(true);
  }, 30_000);

  test("no reference screenshot is reported as unavailable, never as a match", async () => {
    const { host } = await run();
    const rendered = await payloadOf(host, V2_VISUAL_ARTIFACT_IDS.renderedState);

    expect(rendered.pixelComparisons[0].status).toBe("unavailable");
    expect(rendered.pixelComparisons[0].mismatchRatio).toBeUndefined();
    const report = await payloadOf(host, V2_VISUAL_ARTIFACT_IDS.report);
    expect(
      report.findings.some((finding: { findingId: string }) => finding.findingId.startsWith("finding:pixel:")),
    ).toBe(false);
  }, 30_000);

  test("a reference from a different design node is refused, not compared", async () => {
    const { host } = await run({
      reference: { bytes: png(390, 844, () => [0, 0, 0, 255]), nodeId: "9:9" },
      renderedBytes: png(390, 844, () => [255, 255, 255, 255]),
    });
    const rendered = await payloadOf(host, V2_VISUAL_ARTIFACT_IDS.renderedState);

    expect(rendered.pixelComparisons[0].status).toBe("identity_mismatch");
    expect(rendered.pixelComparisons[0].mismatchRatio).toBeUndefined();
  }, 30_000);

  test("the render is instrumented, and says so rather than implying byte-identity", async () => {
    const { host } = await run();
    const rendered = await payloadOf(host, V2_VISUAL_ARTIFACT_IDS.renderedState);

    expect(rendered.provenance.renderInstrumentationApplied).toBe(true);
    expect(rendered.provenance.instrumentedProposalHash).toMatch(/^[a-f0-9]{64}$/);
    // What was built is named separately from what will be approved.
    expect(rendered.provenance.instrumentedProposalHash).not.toBe(rendered.binding.proposalHash);
    expect(rendered.provenance.workspaceIsolated).toBe(true);
  }, 30_000);

  test("the approval candidate is the uninstrumented proposal", async () => {
    const { host } = await run();
    const proposal = await payloadOf(host, V2_VISUAL_ARTIFACT_IDS.proposal);
    const page = proposal.files.find((file: { path: string }) => file.path.endsWith("App.jsx"));

    expect(page.content).toBe(IMPERFECT_PAGE);
    expect(page.content).not.toContain("data-designflow-ref");
  }, 30_000);

  test("the stage never writes to the registered project", async () => {
    const { host, root } = await run();
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");

    expect(await readFile(join(root, "src", "App.jsx"), "utf8")).toContain("return null");
    const rendered = await host.artifactStore.getArtifact(V2_VISUAL_ARTIFACT_IDS.renderedState);
    expect(rendered?.metadata?.projectFilesChanged).toBe(false);
  }, 30_000);

  test("no model is reached when no critic is configured", async () => {
    const { host } = await run();
    const report = await payloadOf(host, V2_VISUAL_ARTIFACT_IDS.report);

    expect(host.criticCalls).toHaveLength(0);
    expect(report.critic.status).toBe("not_requested");
    expect(report.findings.every((finding: { origin: string }) => finding.origin === "deterministic")).toBe(true);
  }, 30_000);

  test("a critic annotates the persisted report without changing its verdict", async () => {
    const withoutCritic = await run();
    const baseline = await payloadOf(withoutCritic.host, V2_VISUAL_ARTIFACT_IDS.report);

    const withCritic = await run({
      critic: async (evidence) => ({
        schemaVersion: "1",
        partitionId: (evidence as { partitionId: string }).partitionId,
        annotations: (evidence as { findings: { findingId: string }[] }).findings.map((finding) => ({
          findingId: finding.findingId,
          userVisibleImpact: "The screen looks compressed.",
        })),
        inconclusive: [],
      }),
    });
    const annotated = await payloadOf(withCritic.host, V2_VISUAL_ARTIFACT_IDS.report);

    expect(withCritic.host.criticCalls.length).toBeGreaterThan(0);
    expect(annotated.outcome).toBe(baseline.outcome);
    expect(annotated.annotations.length).toBeGreaterThan(0);
    expect(annotated.findings.map((finding: { actualValue?: string }) => finding.actualValue)).toEqual(
      baseline.findings.map((finding: { actualValue?: string }) => finding.actualValue),
    );
  }, 60_000);

  test("without an evaluator the render is still persisted, and the stage stops there", async () => {
    const { host, handle } = await run({ evaluator: undefined });

    expect(handle.state).not.toBe("ready");
    const rendered = await host.artifactStore.getArtifact(V2_VISUAL_ARTIFACT_IDS.renderedState);
    expect(rendered).not.toBeNull();
    const report = await host.artifactStore.getArtifact(V2_VISUAL_ARTIFACT_IDS.report);
    expect(report).toBeNull();
  }, 30_000);
});
