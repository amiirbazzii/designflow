// workflows/workflow-design-to-code/src/figma-specification-capabilities.ts
import { z } from "zod";
import { designSpecificationSchema, figmaSourceSnapshotSchema, type Capability, type CapabilityContext } from "@designflow/sdk";
import {
  parseFigmaSourceCapability,
  retrieveFigmaSourceSnapshotCapability,
} from "@designflow/capability-figma-mcp";

import { readArtifact, writeArtifact } from "./artifact-io";
import { capabilityOutputSchema, type CapabilityOutput } from "./types";
import { invokeFigmaSpecificationAgentCapability } from "./agent-foundation-capabilities";
import {
  FIGMA_SPECIFICATION_ARTIFACT_IDS,
  FIGMA_SPECIFICATION_ARTIFACT_TYPES,
  stage3SummarySchema,
} from "./figma-specification-types";

/**
 * `design-to-code-figma-specification`'s capabilities.
 *
 * The first two (`parse-figma-source`, `retrieve-figma-source-snapshot`)
 * are imported directly from `@designflow/capability-figma-mcp` — this
 * workflow adds no Figma-specific logic of its own, only wiring. The third
 * (`invoke-figma-specification-agent`) is Stage 2's own capability, reused
 * unchanged: it already reads the shared `figma-source-snapshot` logical
 * artifact id and writes `design-specification`, and neither id nor its
 * behaviour needed to change for a real snapshot to flow through it — that
 * is the whole point of Stage 2's typed contract boundary. Only the last
 * capability, the Stage 3 summary, is new.
 */

export const storeStage3SummaryCapability: Capability<unknown, CapabilityOutput> = {
  id: "store-stage-3-summary",
  name: "Store Stage 3 summary",
  description: "Summarizes the retrieved snapshot and the specification produced from it",
  type: "pure",
  version: "1",
  inputSchema: z.unknown(),
  outputSchema: capabilityOutputSchema,

  async execute(context: CapabilityContext): Promise<CapabilityOutput> {
    const snapshot = await readArtifact(
      context,
      FIGMA_SPECIFICATION_ARTIFACT_IDS.sourceSnapshot,
      figmaSourceSnapshotSchema,
    );
    const spec = await readArtifact(
      context,
      FIGMA_SPECIFICATION_ARTIFACT_IDS.designSpecification,
      designSpecificationSchema,
    );

    const summary = stage3SummarySchema.parse({
      fileKey: snapshot.source.fileKey ?? "",
      ...(snapshot.source.documentVersion !== undefined
        ? { documentVersion: snapshot.source.documentVersion }
        : {}),
      resolvedFrameCount: (snapshot.source.resolvedFrames ?? []).length,
      componentCount: spec.components.length,
      ambiguityCount: spec.ambiguities.length,
      screenshotCount: (snapshot.screenshots ?? []).length,
    });

    return writeArtifact(context, {
      artifactId: FIGMA_SPECIFICATION_ARTIFACT_IDS.stage3Summary,
      artifactType: FIGMA_SPECIFICATION_ARTIFACT_TYPES.stage3Summary,
      name: "Stage 3 summary",
      payload: summary,
      summary: { ...summary },
    });
  },
};

export const figmaSpecificationCapabilities: readonly Capability<unknown, CapabilityOutput>[] = [
  parseFigmaSourceCapability,
  retrieveFigmaSourceSnapshotCapability,
  invokeFigmaSpecificationAgentCapability,
  storeStage3SummaryCapability,
];
