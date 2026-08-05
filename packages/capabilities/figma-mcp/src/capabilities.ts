// packages/capabilities/figma-mcp/src/capabilities.ts
import { z } from "zod";
import {
  DesignFlowError,
  figmaSourceSnapshotSchema,
  hashContent,
  type Capability,
  type CapabilityContext,
} from "@designflow/sdk";

import { parseFigmaSource, parsedFigmaSourceSchema } from "./parse-figma-source";
import { buildFigmaSourceSnapshot } from "./build-snapshot";

/**
 * The two real, MCP-backed workflow capabilities Stage 3 adds:
 * `parse-figma-source` (pure — no MCP, no network) and
 * `retrieve-figma-source-snapshot` (the one capability in this package that
 * reads `context.mcp`).
 *
 * Both return the same `{artifactRef}` shape every capability in this
 * codebase returns, so they slot into a `WorkflowDefinition`'s nodes exactly
 * like any Stage 1 or Stage 2 capability.
 */

const capabilityOutputSchema = z.object({
  artifactRef: z.object({
    id: z.string().min(1),
    type: z.string().min(1),
    metadata: z.record(z.string(), z.unknown()),
  }),
});

export type CapabilityOutput = z.infer<typeof capabilityOutputSchema>;

export const FIGMA_MCP_ARTIFACT_IDS = {
  parsedSource: "parsed-figma-source",
  sourceSnapshot: "figma-source-snapshot",
} as const;

const parseFigmaSourceInputSchema = z
  .object({
    designFile: z.string().min(1),
    frames: z.array(z.string().min(1)).default([]),
    allowFixtureNames: z.boolean().default(false),
  })
  .strict();

export const parseFigmaSourceCapability: Capability<unknown, CapabilityOutput> = {
  id: "parse-figma-source",
  name: "Parse Figma source",
  description: "Deterministically interprets a Figma URL or file key from worker input",
  type: "pure",
  version: "1",
  inputSchema: parseFigmaSourceInputSchema,
  outputSchema: capabilityOutputSchema,

  async execute(context: CapabilityContext, input: unknown): Promise<CapabilityOutput> {
    const parsedInput = parseFigmaSourceInputSchema.parse(input);
    const parsedSource = parseFigmaSource(parsedInput.designFile, {
      frames: parsedInput.frames,
      allowFixtureNames: parsedInput.allowFixtureNames,
    });

    const stored = await context.artifactStore.save(parsedSource, {
      type: "figma.parsed-source",
      artifactId: FIGMA_MCP_ARTIFACT_IDS.parsedSource,
    });

    return {
      artifactRef: {
        id: FIGMA_MCP_ARTIFACT_IDS.parsedSource,
        type: "figma.parsed-source",
        metadata: {
          name: "Parsed Figma source",
          sourceType: parsedSource.sourceType,
          fileKey: parsedSource.fileKey,
          nodeCount: parsedSource.nodeIds.length,
          frameCount: parsedSource.requestedFrames.length,
          payloadId: stored.id,
        },
      },
    };
  },
};

/**
 * Deliberately just `captureScreenshots` — the actual source identity
 * (`fileKey`, `nodeIds`, requested frames) is not repeated here. It lives
 * upstream, on `parsed-figma-source`, and reaches this node's reuse
 * fingerprint through the ordinary dependency-version mechanism
 * (`execution.dependsOn` in the workflow definition) every capability in
 * this codebase already uses — a changed parsed source produces a new
 * `parsed-figma-source` version, which changes this node's `dependencies`
 * hash, which invalidates it. Repeating the identity in this node's own
 * input as well would only create a second place it could drift out of
 * sync with what was actually parsed.
 */
const retrieveSnapshotInputSchema = z
  .object({
    captureScreenshots: z.boolean().default(true),
    /**
     * A pure cache-buster, read by nothing in `execute()` below.
     *
     * A live document's *version* is only discoverable by actually calling
     * the MCP server — this node's reuse fingerprint is computed from its
     * resolved input *before* that call happens, so an upstream document
     * change with no other input change (same file key, same nodes, same
     * frames) cannot be detected ahead of time and cannot, by itself,
     * invalidate this node automatically. Flipping this value is the
     * explicit escape hatch Stage 3 documents for that case: it changes
     * this node's own input, which forces a fresh retrieval.
     */
    refreshFigmaSource: z.boolean().default(false),
    sourceMode: z.enum(["placeholder", "rest", "mcp-stdio", "mcp-desktop"]).default("placeholder"),
    serverIdentity: z.string().min(1).optional(),
    requestedNodeId: z.string().min(1).optional(),
  })
  .strict();

/** Metadata key under which a logical artifact points at its stored payload — shared with `artifact-io.ts` elsewhere. */
const PAYLOAD_ID_KEY = "payloadId";

function findParsedSourceRef(context: CapabilityContext) {
  for (let index = context.parentArtifacts.length - 1; index >= 0; index--) {
    const ref = context.parentArtifacts[index];
    if (ref?.id === FIGMA_MCP_ARTIFACT_IDS.parsedSource) return ref;
  }
  return undefined;
}

export const retrieveFigmaSourceSnapshotCapability: Capability<unknown, CapabilityOutput> = {
  id: "retrieve-figma-source-snapshot",
  name: "Retrieve Figma source snapshot",
  description: "Connects to the configured Figma MCP server and builds a normalized source snapshot",
  type: "pure",
  version: "1",
  inputSchema: retrieveSnapshotInputSchema,
  outputSchema: capabilityOutputSchema,

  async execute(context: CapabilityContext, input: unknown): Promise<CapabilityOutput> {
    const parsedNodeInput = retrieveSnapshotInputSchema.parse(input);

    if (parsedNodeInput.sourceMode !== "placeholder" && context.mcp === undefined) {
      throw new DesignFlowError(
        "ERR_FIGMA_MCP_REQUIRED",
        "Real Figma mode requires a configured MCP connection; placeholder fallback is disabled",
        { sourceMode: parsedNodeInput.sourceMode },
      );
    }

    const ref = findParsedSourceRef(context);
    if (ref === undefined) {
      throw new DesignFlowError(
        "ERR_MISSING_UPSTREAM_ARTIFACT",
        "retrieve-figma-source-snapshot requires parsed-figma-source, which is not available",
        { artifactId: FIGMA_MCP_ARTIFACT_IDS.parsedSource },
      );
    }

    const payloadId = ref.metadata[PAYLOAD_ID_KEY];
    if (typeof payloadId !== "string") {
      throw new DesignFlowError("ERR_ARTIFACT_PAYLOAD_MISSING", "parsed-figma-source carries no payload reference", {});
    }

    const stored = await context.artifactStore.get(payloadId);
    if (stored === null) {
      throw new DesignFlowError("ERR_ARTIFACT_PAYLOAD_MISSING", "The stored parsed-figma-source payload is no longer available", {});
    }

    const parsedSource = parsedFigmaSourceSchema.parse(stored.data);

    const snapshot = await buildFigmaSourceSnapshot(context, {
      parsedSource,
      captureScreenshots: parsedNodeInput.captureScreenshots,
      screenshotArtifactIdPrefix: "figma-screenshot",
      now: () => new Date().toISOString(),
    });

    const validated = figmaSourceSnapshotSchema.parse(snapshot);
    const sourceProvenanceDigest = await hashContent(validated.sourceProvenance ?? { mode: "placeholder" });
    const savedPayload = await context.artifactStore.save(validated, {
      type: "figma.source-snapshot",
      artifactId: FIGMA_MCP_ARTIFACT_IDS.sourceSnapshot,
    });

    return {
      artifactRef: {
        id: FIGMA_MCP_ARTIFACT_IDS.sourceSnapshot,
        type: "figma.source-snapshot",
        metadata: {
          name: "Figma source snapshot",
          fileKey: validated.source.fileKey ?? parsedSource.fileKey,
          documentVersion: validated.source.documentVersion,
          resolvedFrameCount: validated.source.resolvedFrames.length,
          nodeCount: validated.nodes.length,
          screenshotCount: validated.screenshots.length,
          warningCount: validated.warnings.length,
          sourceMode: validated.sourceProvenance?.mode ?? "placeholder",
          ...(validated.sourceProvenance !== undefined ? { sourceProvenance: validated.sourceProvenance } : {}),
          sourceProvenanceDigest,
          [PAYLOAD_ID_KEY]: savedPayload.id,
        },
      },
    };
  },
};

export const figmaMcpCapabilities: readonly Capability<unknown, CapabilityOutput>[] = [
  parseFigmaSourceCapability,
  retrieveFigmaSourceSnapshotCapability,
];
