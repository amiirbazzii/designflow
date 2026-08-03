// workflows/workflow-design-to-code/src/agent-foundation-capabilities.ts
import { z } from "zod";
import {
  DesignFlowError,
  designSpecificationSchema,
  figmaSourceSnapshotSchema,
  generatedImplementationSchema,
  visualValidationReportSchema,
  type Capability,
  type CapabilityContext,
  type FigmaSourceSnapshot,
} from "@designflow/sdk";

import { readArtifact, writeArtifact } from "./artifact-io";
import { capabilityOutputSchema } from "./types";
import {
  AGENT_FOUNDATION_ARTIFACT_IDS,
  AGENT_FOUNDATION_ARTIFACT_TYPES,
  agentFoundationInputSchema,
  agentInvocationInputSchema,
  figmaSnapshotSeedSchema,
  implementationInvocationInputSchema,
  stage2SummarySchema,
  visualValidationInvocationInputSchema,
  type CapabilityOutput,
} from "./agent-foundation-types";

/**
 * `design-to-code-agent-foundation`'s five capabilities.
 *
 * The first and last are pure functions of their artifacts, exactly like
 * every capability in `capabilities/index.ts`. The middle three are the new
 * shape Stage 2 introduces: each reads one upstream artifact, calls
 * `context.agents.invoke` for exactly one specialized agent, validates what
 * comes back against that artifact's own contract (imported from the SDK,
 * never invented here), and stores it. `context.agents` is a port this
 * workflow package only ever calls through, never constructs; see the test
 * harness for the one place a real invocation runtime is actually wired up.
 */

function requireAgentInvoker(context: CapabilityContext): NonNullable<CapabilityContext["agents"]> {
  if (context.agents === undefined) {
    throw new DesignFlowError(
      "ERR_AGENT_INVOCATION_UNAVAILABLE",
      `Capability ${context.capabilityId} requires an agent invocation service, which this host did not configure`,
      { capabilityId: context.capabilityId },
    );
  }

  return context.agents;
}

// ── 1. Prepare Figma Source Fixture ──────────────────────────────

export const prepareFigmaSourceFixtureCapability: Capability<unknown, CapabilityOutput> = {
  id: "prepare-figma-source-fixture",
  name: "Prepare Figma source fixture",
  description: "Builds a deterministic Figma source snapshot fixture from workflow input",
  type: "pure",
  version: "1",
  inputSchema: figmaSnapshotSeedSchema,
  outputSchema: capabilityOutputSchema,

  async execute(context: CapabilityContext, input: unknown): Promise<CapabilityOutput> {
    const seed = figmaSnapshotSeedSchema.parse(input);

    const nodes = seed.frames.map((frame, index) => ({
      id: `node-${index}`,
      name: frame.split("/").slice(-1)[0] ?? frame,
      type: "FRAME",
      properties: {},
    }));

    const snapshot: FigmaSourceSnapshot = figmaSourceSnapshotSchema.parse({
      source: {
        designFile: seed.designFile,
        nodeIds: nodes.map((node) => node.id),
        frames: seed.frames,
      },
      nodes,
      variables: [{ name: "color.brand", value: "#111827" }],
      assets: [],
    });

    return writeArtifact(context, {
      artifactId: AGENT_FOUNDATION_ARTIFACT_IDS.figmaSourceSnapshot,
      artifactType: AGENT_FOUNDATION_ARTIFACT_TYPES.figmaSourceSnapshot,
      name: "Figma source snapshot (fixture)",
      payload: snapshot,
      summary: {
        designFile: snapshot.source.designFile,
        frameCount: snapshot.source.frames.length,
      },
    });
  },
};

// ── 2. Invoke Figma Specification Agent ──────────────────────────

export const invokeFigmaSpecificationAgentCapability: Capability<unknown, CapabilityOutput> = {
  id: "invoke-figma-specification-agent",
  name: "Invoke Figma Specification Agent",
  description: "Turns the Figma source snapshot into a design specification",
  type: "pure",
  version: "1",
  inputSchema: agentInvocationInputSchema,
  outputSchema: capabilityOutputSchema,

  async execute(context: CapabilityContext, input: unknown): Promise<CapabilityOutput> {
    const requested = agentInvocationInputSchema.parse(input);
    const agents = requireAgentInvoker(context);

    const snapshot = await readArtifact(
      context,
      AGENT_FOUNDATION_ARTIFACT_IDS.figmaSourceSnapshot,
      figmaSourceSnapshotSchema,
    );

    const outcome = await agents.invoke(
      {
        agentId: "figma-specification-agent",
        objective: "Produce a design specification from the Figma source snapshot",
        input: { figmaSnapshot: snapshot },
        attempt: 1,
      },
      context.signal,
    );

    if (outcome.type === "failure") {
      throw new DesignFlowError(outcome.code, "The Figma Specification Agent could not produce a specification", {
        capabilityId: context.capabilityId,
      });
    }

    const spec = designSpecificationSchema.parse(outcome.output);

    return writeArtifact(context, {
      artifactId: AGENT_FOUNDATION_ARTIFACT_IDS.designSpecification,
      artifactType: AGENT_FOUNDATION_ARTIFACT_TYPES.designSpecification,
      name: "Design specification",
      payload: spec,
      summary: {
        requestedAgentVersion: requested.agentVersion,
        producedByAgentVersion: outcome.agentVersion,
        frameCount: spec.frames.length,
        ambiguityCount: spec.ambiguities.length,
      },
    });
  },
};

// ── 3. Invoke Implementation Agent ───────────────────────────────

export const invokeImplementationAgentCapability: Capability<unknown, CapabilityOutput> = {
  id: "invoke-implementation-agent",
  name: "Invoke Implementation Agent",
  description: "Turns the design specification and project context into a proposed implementation",
  type: "pure",
  version: "1",
  inputSchema: implementationInvocationInputSchema,
  outputSchema: capabilityOutputSchema,

  async execute(context: CapabilityContext, input: unknown): Promise<CapabilityOutput> {
    const requested = implementationInvocationInputSchema.parse(input);
    const agents = requireAgentInvoker(context);

    const spec = await readArtifact(
      context,
      AGENT_FOUNDATION_ARTIFACT_IDS.designSpecification,
      designSpecificationSchema,
    );

    const outcome = await agents.invoke(
      {
        agentId: "implementation-agent",
        objective: "Propose an implementation for the design specification within the given project",
        input: { designSpecification: spec, projectContext: requested.projectContext },
        attempt: 1,
      },
      context.signal,
    );

    if (outcome.type === "failure") {
      throw new DesignFlowError(outcome.code, "The Implementation Agent could not produce an implementation", {
        capabilityId: context.capabilityId,
      });
    }

    const implementation = generatedImplementationSchema.parse(outcome.output);

    return writeArtifact(context, {
      artifactId: AGENT_FOUNDATION_ARTIFACT_IDS.generatedImplementation,
      artifactType: AGENT_FOUNDATION_ARTIFACT_TYPES.generatedImplementation,
      name: "Generated implementation",
      payload: implementation,
      summary: {
        requestedAgentVersion: requested.agentVersion,
        producedByAgentVersion: outcome.agentVersion,
        fileCount: implementation.files.length,
      },
    });
  },
};

// ── 4. Invoke Visual Validation Agent ────────────────────────────

export const invokeVisualValidationAgentCapability: Capability<unknown, CapabilityOutput> = {
  id: "invoke-visual-validation-agent",
  name: "Invoke Visual Validation Agent",
  description: "Evaluates the generated implementation against the design specification",
  type: "pure",
  version: "1",
  inputSchema: visualValidationInvocationInputSchema,
  outputSchema: capabilityOutputSchema,

  async execute(context: CapabilityContext, input: unknown): Promise<CapabilityOutput> {
    const requested = visualValidationInvocationInputSchema.parse(input);
    const agents = requireAgentInvoker(context);

    const implementation = await readArtifact(
      context,
      AGENT_FOUNDATION_ARTIFACT_IDS.generatedImplementation,
      generatedImplementationSchema,
    );

    const outcome = await agents.invoke(
      {
        agentId: "visual-validation-agent",
        objective: "Evaluate the generated implementation for structural completeness",
        input: { generatedImplementation: implementation, threshold: requested.threshold },
        attempt: 1,
      },
      context.signal,
    );

    if (outcome.type === "failure") {
      throw new DesignFlowError(outcome.code, "The Visual Validation Agent could not produce a report", {
        capabilityId: context.capabilityId,
      });
    }

    const report = visualValidationReportSchema.parse(outcome.output);

    return writeArtifact(context, {
      artifactId: AGENT_FOUNDATION_ARTIFACT_IDS.visualValidationReport,
      artifactType: AGENT_FOUNDATION_ARTIFACT_TYPES.visualValidationReport,
      name: "Visual validation report",
      payload: report,
      summary: {
        requestedAgentVersion: requested.agentVersion,
        producedByAgentVersion: outcome.agentVersion,
        passed: report.passed,
        overallScore: report.overallScore,
      },
    });
  },
};

// ── 5. Store Stage 2 Summary ─────────────────────────────────────

export const storeStage2SummaryCapability: Capability<unknown, CapabilityOutput> = {
  id: "store-stage-2-summary",
  name: "Store Stage 2 summary",
  description: "Summarizes the specification, implementation and validation produced by this run",
  type: "pure",
  version: "1",
  inputSchema: z.unknown(),
  outputSchema: capabilityOutputSchema,

  async execute(context: CapabilityContext): Promise<CapabilityOutput> {
    const snapshot = await readArtifact(
      context,
      AGENT_FOUNDATION_ARTIFACT_IDS.figmaSourceSnapshot,
      figmaSourceSnapshotSchema,
    );
    const spec = await readArtifact(
      context,
      AGENT_FOUNDATION_ARTIFACT_IDS.designSpecification,
      designSpecificationSchema,
    );
    const implementation = await readArtifact(
      context,
      AGENT_FOUNDATION_ARTIFACT_IDS.generatedImplementation,
      generatedImplementationSchema,
    );
    const report = await readArtifact(
      context,
      AGENT_FOUNDATION_ARTIFACT_IDS.visualValidationReport,
      visualValidationReportSchema,
    );

    const summary = stage2SummarySchema.parse({
      designFile: snapshot.source.designFile,
      frameCount: spec.frames.length,
      ambiguityCount: spec.ambiguities.length,
      proposedFileCount: implementation.files.length,
      validationPassed: report.passed,
      validationScore: report.overallScore,
    });

    return writeArtifact(context, {
      artifactId: AGENT_FOUNDATION_ARTIFACT_IDS.stage2Summary,
      artifactType: AGENT_FOUNDATION_ARTIFACT_TYPES.stage2Summary,
      name: "Stage 2 summary",
      payload: summary,
      summary: { ...summary },
    });
  },
};

export const agentFoundationCapabilities: readonly Capability<unknown, CapabilityOutput>[] = [
  prepareFigmaSourceFixtureCapability,
  invokeFigmaSpecificationAgentCapability,
  invokeImplementationAgentCapability,
  invokeVisualValidationAgentCapability,
  storeStage2SummaryCapability,
];

export { agentFoundationInputSchema };
