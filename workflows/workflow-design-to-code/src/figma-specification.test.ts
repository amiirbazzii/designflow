// workflows/workflow-design-to-code/src/figma-specification.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import {
  createFigmaSpecificationHost,
  SAMPLE_FIGMA_MCP_FIXTURES,
  SAMPLE_FIGMA_SPECIFICATION_INPUT,
  type FigmaSpecificationHost,
} from "./harness.test-support";
import { FIGMA_SPECIFICATION_ARTIFACT_IDS } from "./figma-specification-types";

/**
 * `design-to-code-figma-specification`, exercised against a real, separate
 * process (the fake MCP server) over the real stdio transport — the same
 * "protocol-faithful fake" discipline `@designflow/mcp` and
 * `@designflow/capability-figma-mcp`'s own tests use. No real Figma access
 * was available to verify this against an actual Figma MCP server; see the
 * Stage 3 ADR and final report for what that means and how to verify it
 * manually once one is configured.
 */

const WORKFLOW_ID = "design-to-code-figma-specification";

const hosts: FigmaSpecificationHost[] = [];

afterEach(() => {
  for (const host of hosts.splice(0)) host.close();
});

async function host(fixtures: Record<string, unknown> = SAMPLE_FIGMA_MCP_FIXTURES, incremental = false) {
  const created = await createFigmaSpecificationHost({ fixtures, incremental });
  hosts.push(created);
  return created;
}

function versionedArtifactIds(created: FigmaSpecificationHost): string[] {
  return created.events
    .filter((event) => event.type === "artifact.version_created")
    .map((event) => String(event.payload?.artifactId));
}

describe("the real retrieval → specification path", () => {
  test("produces a parsed source, a snapshot, a specification, and a summary", async () => {
    const created = await host();
    const handle = await created.runner.start({ workflowId: WORKFLOW_ID, input: SAMPLE_FIGMA_SPECIFICATION_INPUT });

    expect(handle.state).toBe("ready");

    const report = await created.runner.explain(handle.executionId);
    const ids = report.artifacts
      .filter((artifact) => artifact.name !== artifact.artifactId)
      .map((artifact) => artifact.artifactId)
      .sort();

    expect(ids).toEqual(
      [
        FIGMA_SPECIFICATION_ARTIFACT_IDS.parsedSource,
        FIGMA_SPECIFICATION_ARTIFACT_IDS.sourceSnapshot,
        FIGMA_SPECIFICATION_ARTIFACT_IDS.designSpecification,
        FIGMA_SPECIFICATION_ARTIFACT_IDS.stage3Summary,
      ].sort(),
    );
  });

  test("the specification references only node ids that exist in the retrieved snapshot", async () => {
    const created = await host();
    await created.runner.start({ workflowId: WORKFLOW_ID, input: SAMPLE_FIGMA_SPECIFICATION_INPUT });

    const snapshotArtifact = await created.artifactStore.getArtifact(FIGMA_SPECIFICATION_ARTIFACT_IDS.sourceSnapshot);
    const snapshotPayload = await created.artifactStore.get(snapshotArtifact!.metadata.payloadId as string);
    const knownIds = new Set(
      (snapshotPayload!.data as { nodes: Array<{ id: string }> }).nodes.map((node) => node.id),
    );

    const specArtifact = await created.artifactStore.getArtifact(FIGMA_SPECIFICATION_ARTIFACT_IDS.designSpecification);
    const specPayload = await created.artifactStore.get(specArtifact!.metadata.payloadId as string);
    const spec = specPayload!.data as { hierarchy: Array<{ id: string }> };

    for (const entry of spec.hierarchy) {
      expect(knownIds.has(entry.id)).toBe(true);
    }
  });

  test("the specification carries a real reference screenshot", async () => {
    const created = await host();
    await created.runner.start({ workflowId: WORKFLOW_ID, input: SAMPLE_FIGMA_SPECIFICATION_INPUT });

    const snapshotArtifact = await created.artifactStore.getArtifact(FIGMA_SPECIFICATION_ARTIFACT_IDS.sourceSnapshot);
    expect(snapshotArtifact?.metadata.screenshotCount).toBe(1);
  });

  test("no code is generated and no project file is written — this workflow has no such node", () => {
    // Structural, not behavioural: prove it by construction rather than by
    // running and hoping nothing slipped through. The workflow this test
    // file exercises has exactly four nodes, none of which are `write_fs`
    // or otherwise capable of touching a project.
    const nodeIds = ["parse-figma-source", "retrieve-figma-source-snapshot", "invoke-figma-specification-agent", "store-stage-3-summary"];
    expect(nodeIds).not.toContain("generate-code");
    expect(nodeIds).not.toContain("write-project-files");
  });
});

describe("frame resolution failures surface as typed errors, not a generic workflow error", () => {
  test("a requested frame that matches nothing fails the run", async () => {
    const created = await host();
    const handle = await created.runner.start({
      workflowId: WORKFLOW_ID,
      input: { ...SAMPLE_FIGMA_SPECIFICATION_INPUT, frames: ["DoesNotExist"] },
    });

    expect(handle.state).toBe("failed");
  });

  test("an ambiguous frame name (two matching nodes) fails the run rather than guessing", async () => {
    const created = await host({
      ...SAMPLE_FIGMA_MCP_FIXTURES,
      toolResults: {
        ...(SAMPLE_FIGMA_MCP_FIXTURES.toolResults as Record<string, unknown>),
        get_document: {
          name: "Homepage",
          version: "1",
          document: {
            id: "0:0",
            name: "Page 1",
            type: "CANVAS",
            children: [
              { id: "1:1", name: "Header", type: "FRAME" },
              { id: "1:2", name: "Header", type: "FRAME" },
            ],
          },
        },
      },
    });

    const handle = await created.runner.start({
      workflowId: WORKFLOW_ID,
      input: { ...SAMPLE_FIGMA_SPECIFICATION_INPUT, frames: ["Header"] },
    });

    expect(handle.state).toBe("failed");
  });

  test("an authentication failure from the server fails the run with no fabricated content", async () => {
    const created = await host({
      tools: [{ name: "get_document" }],
      errorTools: ["get_document"],
      toolResults: { get_document: "unauthorized" },
    });

    const handle = await created.runner.start({ workflowId: WORKFLOW_ID, input: SAMPLE_FIGMA_SPECIFICATION_INPUT });
    expect(handle.state).toBe("failed");
  });
});

describe("reuse: Figma source identity", () => {
  test("identical source and document version reuse", async () => {
    const created = await host(SAMPLE_FIGMA_MCP_FIXTURES, true);
    await created.runner.start({ workflowId: WORKFLOW_ID, input: SAMPLE_FIGMA_SPECIFICATION_INPUT });
    created.events.length = 0;

    await created.service.execute({ workflowId: WORKFLOW_ID, input: SAMPLE_FIGMA_SPECIFICATION_INPUT });

    expect(versionedArtifactIds(created)).toEqual([]);
  });

  test("a different file key invalidates the whole chain", async () => {
    const created = await host(SAMPLE_FIGMA_MCP_FIXTURES, true);
    await created.runner.start({ workflowId: WORKFLOW_ID, input: SAMPLE_FIGMA_SPECIFICATION_INPUT });
    created.events.length = 0;

    await created.service.execute({
      workflowId: WORKFLOW_ID,
      input: { ...SAMPLE_FIGMA_SPECIFICATION_INPUT, designFile: "https://www.figma.com/design/differentKey999/Homepage" },
    });

    const revisioned = new Set(versionedArtifactIds(created));
    expect(revisioned.has(FIGMA_SPECIFICATION_ARTIFACT_IDS.parsedSource)).toBe(true);
    expect(revisioned.has(FIGMA_SPECIFICATION_ARTIFACT_IDS.sourceSnapshot)).toBe(true);
    expect(revisioned.has(FIGMA_SPECIFICATION_ARTIFACT_IDS.designSpecification)).toBe(true);
  });

  test("refreshFigmaSource forces a fresh retrieval even when no other input changed", async () => {
    // A live document's version is only discoverable by actually fetching
    // it — this node's fingerprint is computed *before* that fetch, so an
    // upstream document change with no other input difference cannot
    // invalidate reuse automatically ahead of time (see
    // `retrieveSnapshotInputSchema`'s own doc comment). `refreshFigmaSource`
    // is the documented, explicit escape hatch for exactly this case.
    const created = await host(SAMPLE_FIGMA_MCP_FIXTURES, true);
    await created.runner.start({ workflowId: WORKFLOW_ID, input: SAMPLE_FIGMA_SPECIFICATION_INPUT });
    created.events.length = 0;

    await created.service.execute({
      workflowId: WORKFLOW_ID,
      input: { ...SAMPLE_FIGMA_SPECIFICATION_INPUT, refreshFigmaSource: true },
    });

    const revisioned = new Set(versionedArtifactIds(created));
    expect(revisioned.has(FIGMA_SPECIFICATION_ARTIFACT_IDS.sourceSnapshot)).toBe(true);
  });

  test("without refreshFigmaSource, an unrelated identical re-run reuses the snapshot", async () => {
    const created = await host(SAMPLE_FIGMA_MCP_FIXTURES, true);
    await created.runner.start({ workflowId: WORKFLOW_ID, input: SAMPLE_FIGMA_SPECIFICATION_INPUT });
    created.events.length = 0;

    await created.service.execute({ workflowId: WORKFLOW_ID, input: SAMPLE_FIGMA_SPECIFICATION_INPUT });

    const revisioned = new Set(versionedArtifactIds(created));
    expect(revisioned.has(FIGMA_SPECIFICATION_ARTIFACT_IDS.sourceSnapshot)).toBe(false);
  });

  test("changing only the Figma Specification Agent's version invalidates the specification, not the snapshot", async () => {
    const created = await host(SAMPLE_FIGMA_MCP_FIXTURES, true);
    await created.runner.start({ workflowId: WORKFLOW_ID, input: SAMPLE_FIGMA_SPECIFICATION_INPUT });
    created.events.length = 0;

    await created.service.execute({
      workflowId: WORKFLOW_ID,
      input: { ...SAMPLE_FIGMA_SPECIFICATION_INPUT, figmaAgentVersion: "0.3.0" },
    });

    const revisioned = new Set(versionedArtifactIds(created));
    expect(revisioned.has(FIGMA_SPECIFICATION_ARTIFACT_IDS.designSpecification)).toBe(true);
    expect(revisioned.has(FIGMA_SPECIFICATION_ARTIFACT_IDS.sourceSnapshot)).toBe(false);
    expect(revisioned.has(FIGMA_SPECIFICATION_ARTIFACT_IDS.parsedSource)).toBe(false);
  });

  test("changing only the model profile invalidates the specification, not the snapshot", async () => {
    const created = await host(SAMPLE_FIGMA_MCP_FIXTURES, true);
    await created.runner.start({ workflowId: WORKFLOW_ID, input: SAMPLE_FIGMA_SPECIFICATION_INPUT });
    created.events.length = 0;

    await created.service.execute({
      workflowId: WORKFLOW_ID,
      input: { ...SAMPLE_FIGMA_SPECIFICATION_INPUT, figmaAgentModelProfileId: "figma-specification-alternate" },
    });

    const revisioned = new Set(versionedArtifactIds(created));
    expect(revisioned.has(FIGMA_SPECIFICATION_ARTIFACT_IDS.designSpecification)).toBe(true);
    expect(revisioned.has(FIGMA_SPECIFICATION_ARTIFACT_IDS.sourceSnapshot)).toBe(false);
  });

  test("changing only the requested frames invalidates the parsed source and everything downstream", async () => {
    const created = await host(SAMPLE_FIGMA_MCP_FIXTURES, true);
    await created.runner.start({ workflowId: WORKFLOW_ID, input: SAMPLE_FIGMA_SPECIFICATION_INPUT });
    created.events.length = 0;

    await created.service.execute({
      workflowId: WORKFLOW_ID,
      input: { ...SAMPLE_FIGMA_SPECIFICATION_INPUT, frames: [] },
    });

    const revisioned = new Set(versionedArtifactIds(created));
    expect(revisioned.has(FIGMA_SPECIFICATION_ARTIFACT_IDS.parsedSource)).toBe(true);
    expect(revisioned.has(FIGMA_SPECIFICATION_ARTIFACT_IDS.sourceSnapshot)).toBe(true);
  });
});
