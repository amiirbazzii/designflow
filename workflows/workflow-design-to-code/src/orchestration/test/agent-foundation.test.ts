// workflows/workflow-design-to-code/src/agent-foundation.test.ts
import { describe, expect, test } from "bun:test";
import {
  createAgentFoundationHost,
  SAMPLE_AGENT_FOUNDATION_INPUT,
  type AgentFoundationHost,
} from "../../../test/support/harness";
import { figmaSpecificationAgentManifest, implementationAgentManifest } from "@designflow/agents";
import { AGENT_FOUNDATION_ARTIFACT_IDS } from "../agent-foundation-types";

/**
 * Proves the Stage 2 "proof flow":
 *
 *   Figma Specification Agent  → Design Specification Artifact
 *   Implementation Agent       → Generated Implementation Artifact
 *   Visual Validation Agent    → Visual Validation Report Artifact
 *
 * with real artifact lineage recorded between every step (via
 * `runner.explain`'s dependency graph) and the reuse-fingerprint behaviour
 * Part 11 of the Stage 2 spec requires: an agent-version or model-profile
 * change invalidates exactly the subtree that depends on it, never more,
 * never less. The coordinator itself is not exercised here — this workflow
 * is run directly by workflow id, exactly as it is intended to be reached in
 * this stage.
 */

const WORKFLOW_ID = "design-to-code-agent-foundation";

function versionedArtifactIds(host: AgentFoundationHost): string[] {
  return host.events
    .filter((event) => event.type === "artifact.version_created")
    .map((event) => String(event.payload?.artifactId));
}

function reusedArtifactIds(host: AgentFoundationHost): string[] {
  return host.events
    .filter((event) => event.type === "artifact.reused")
    .map((event) => String(event.payload?.artifactId));
}

describe("typed artifact handoff", () => {
  test("produces all five artifacts with recorded lineage between them", async () => {
    const host = createAgentFoundationHost();
    const handle = await host.runner.start({
      workflowId: WORKFLOW_ID,
      input: SAMPLE_AGENT_FOUNDATION_INPUT,
    });

    expect(handle.state).toBe("ready");

    const report = await host.runner.explain(handle.executionId);
    const ids = report.artifacts
      .filter((artifact) => artifact.name !== artifact.artifactId)
      .map((artifact) => artifact.artifactId)
      .sort();

    expect(ids).toEqual(
      [
        AGENT_FOUNDATION_ARTIFACT_IDS.figmaSourceSnapshot,
        AGENT_FOUNDATION_ARTIFACT_IDS.designSpecification,
        AGENT_FOUNDATION_ARTIFACT_IDS.generatedImplementation,
        AGENT_FOUNDATION_ARTIFACT_IDS.visualValidationReport,
        AGENT_FOUNDATION_ARTIFACT_IDS.stage2Summary,
      ].sort(),
    );

    const lineage = await host.artifactStore.getLineage(
      AGENT_FOUNDATION_ARTIFACT_IDS.stage2Summary,
    );
    expect(lineage.ancestors).toContain(AGENT_FOUNDATION_ARTIFACT_IDS.designSpecification);
    expect(lineage.ancestors).toContain(AGENT_FOUNDATION_ARTIFACT_IDS.generatedImplementation);
    expect(lineage.ancestors).toContain(AGENT_FOUNDATION_ARTIFACT_IDS.visualValidationReport);
  });

  test("each agent's output carries its own manifest version as provenance", async () => {
    const host = createAgentFoundationHost();
    await host.runner.start({ workflowId: WORKFLOW_ID, input: SAMPLE_AGENT_FOUNDATION_INPUT });

    const spec = await host.artifactStore.getArtifact(
      AGENT_FOUNDATION_ARTIFACT_IDS.designSpecification,
    );
    // Read from the manifest rather than a literal: the assertion is that an
    // artifact carries its producing agent's OWN version, and hardcoding the
    // value made this fail the moment Specification V2 bumped it to 0.3.0.
    expect(spec?.metadata.producedByAgentVersion).toBe(figmaSpecificationAgentManifest.version);

    const implementation = await host.artifactStore.getArtifact(
      AGENT_FOUNDATION_ARTIFACT_IDS.generatedImplementation,
    );
    expect(implementation?.metadata.producedByAgentVersion).toBe(implementationAgentManifest.version);
  });

  test("summary reflects the actual specification, implementation and validation produced", async () => {
    const host = createAgentFoundationHost();
    await host.runner.start({ workflowId: WORKFLOW_ID, input: SAMPLE_AGENT_FOUNDATION_INPUT });

    const summaryArtifact = await host.artifactStore.getArtifact(
      AGENT_FOUNDATION_ARTIFACT_IDS.stage2Summary,
    );
    const payloadId = summaryArtifact?.metadata.payloadId as string | undefined;
    expect(payloadId).toBeDefined();

    const stored = await host.artifactStore.get(payloadId!);
    expect(stored?.data).toMatchObject({ designFile: "homepage.fig", frameCount: 3 });
  });

  test("a malformed intermediate artifact fails the run rather than being silently accepted", async () => {
    // `implementationInvocationInputSchema` requires a complete
    // `projectImplementationContextSchema` — an incomplete one fails the
    // node's own input validation before the Implementation Agent is ever
    // invoked, which is the boundary this test proves is actually enforced.
    const host = createAgentFoundationHost();
    const handle = await host.runner.start({
      workflowId: WORKFLOW_ID,
      input: { ...SAMPLE_AGENT_FOUNDATION_INPUT, projectContext: { framework: "react" } },
    });

    expect(handle.state).toBe("failed");
  });
});

describe("reuse: agent-version and model-profile isolation", () => {
  test("identical input and identical agent/model versions reuse every artifact", async () => {
    const host = createAgentFoundationHost({ incremental: true });

    await host.runner.start({ workflowId: WORKFLOW_ID, input: SAMPLE_AGENT_FOUNDATION_INPUT });
    host.events.length = 0;

    await host.service.execute({ workflowId: WORKFLOW_ID, input: SAMPLE_AGENT_FOUNDATION_INPUT });

    expect(versionedArtifactIds(host)).toEqual([]);
    expect(reusedArtifactIds(host).sort()).toEqual(
      [
        AGENT_FOUNDATION_ARTIFACT_IDS.figmaSourceSnapshot,
        AGENT_FOUNDATION_ARTIFACT_IDS.designSpecification,
        AGENT_FOUNDATION_ARTIFACT_IDS.generatedImplementation,
        AGENT_FOUNDATION_ARTIFACT_IDS.visualValidationReport,
        AGENT_FOUNDATION_ARTIFACT_IDS.stage2Summary,
      ].sort(),
    );
  });

  test("changing the Figma Specification Agent's version invalidates it and everything downstream", async () => {
    const host = createAgentFoundationHost({ incremental: true });

    await host.runner.start({ workflowId: WORKFLOW_ID, input: SAMPLE_AGENT_FOUNDATION_INPUT });
    host.events.length = 0;

    await host.service.execute({
      workflowId: WORKFLOW_ID,
      input: { ...SAMPLE_AGENT_FOUNDATION_INPUT, figmaAgentVersion: "0.2.0" },
    });

    const revisioned = new Set(versionedArtifactIds(host));

    expect(revisioned.has(AGENT_FOUNDATION_ARTIFACT_IDS.designSpecification)).toBe(true);
    expect(revisioned.has(AGENT_FOUNDATION_ARTIFACT_IDS.generatedImplementation)).toBe(true);
    expect(revisioned.has(AGENT_FOUNDATION_ARTIFACT_IDS.visualValidationReport)).toBe(true);
    // The fixture itself never depended on the Figma agent's version.
    expect(revisioned.has(AGENT_FOUNDATION_ARTIFACT_IDS.figmaSourceSnapshot)).toBe(false);
  });

  test("changing only the Visual Validation Agent's version invalidates only the validation report", async () => {
    const host = createAgentFoundationHost({ incremental: true });

    await host.runner.start({ workflowId: WORKFLOW_ID, input: SAMPLE_AGENT_FOUNDATION_INPUT });
    host.events.length = 0;

    await host.service.execute({
      workflowId: WORKFLOW_ID,
      input: { ...SAMPLE_AGENT_FOUNDATION_INPUT, visualValidationAgentVersion: "0.2.0" },
    });

    const revisioned = new Set(versionedArtifactIds(host));

    expect(revisioned.has(AGENT_FOUNDATION_ARTIFACT_IDS.visualValidationReport)).toBe(true);
    expect(revisioned.has(AGENT_FOUNDATION_ARTIFACT_IDS.designSpecification)).toBe(false);
    expect(revisioned.has(AGENT_FOUNDATION_ARTIFACT_IDS.generatedImplementation)).toBe(false);
  });

  test("changing the Implementation Agent's model profile invalidates implementation and validation, but not the specification", async () => {
    const host = createAgentFoundationHost({ incremental: true });

    await host.runner.start({ workflowId: WORKFLOW_ID, input: SAMPLE_AGENT_FOUNDATION_INPUT });
    host.events.length = 0;

    await host.service.execute({
      workflowId: WORKFLOW_ID,
      input: {
        ...SAMPLE_AGENT_FOUNDATION_INPUT,
        implementationAgentModelProfileId: "implementation-alternate",
      },
    });

    const revisioned = new Set(versionedArtifactIds(host));

    expect(revisioned.has(AGENT_FOUNDATION_ARTIFACT_IDS.generatedImplementation)).toBe(true);
    expect(revisioned.has(AGENT_FOUNDATION_ARTIFACT_IDS.visualValidationReport)).toBe(true);
    expect(revisioned.has(AGENT_FOUNDATION_ARTIFACT_IDS.designSpecification)).toBe(false);
  });

  test("changing the coordinator's own configuration is not representable here — this workflow carries no coordinator input", async () => {
    // Part 11.5 of the Stage 2 spec: coordinator configuration must not
    // invalidate artifacts produced wholly downstream unless it actually
    // changes their workflow input. This workflow's input carries nothing
    // about the coordinator at all — it is invoked directly, never through
    // the coordinator's own decision — so there is structurally no field
    // whose change could reach any node here. Asserted by exhaustively
    // confirming the workflow input schema's own keys.
    const { agentFoundationInputSchema } = await import("../agent-foundation-types");
    const keys = Object.keys(agentFoundationInputSchema.shape);

    for (const key of keys) {
      expect(key.toLowerCase()).not.toContain("coordinator");
    }
  });
});
