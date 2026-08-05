// packages/capabilities/figma-mcp/src/build-snapshot.ts
import {
  figmaSourceSnapshotSchema,
  type CapabilityContext,
  type FigmaScreenshotSnapshot,
  type FigmaSnapshotWarning,
  type FigmaSourceSnapshot,
} from "@designflow/sdk";

import type { ParsedFigmaSource } from "./parse-figma-source";
import { discoverFigmaMcpCapabilities } from "./discover-capabilities";
import {
  figmaMcpCaptureScreenshot,
  figmaMcpGetAssets,
  figmaMcpGetComponents,
  figmaMcpGetDocument,
  figmaMcpGetStyles,
  figmaMcpGetVariables,
} from "./figma-mcp-tools";
import { resolveFigmaFrames } from "./resolve-frames";
import { FigmaFrameAmbiguousError, FigmaFrameNotFoundError } from "./errors";
import { storeFigmaScreenshotArtifact } from "./screenshot-artifact";
import { buildFigmaDesktopSourceSnapshot } from "./figma-desktop-adapter";

/**
 * The full, real retrieval path — capability discovery through to a
 * validated `FigmaSourceSnapshot`, orchestrating every deterministic
 * wrapper in `figma-mcp-tools.ts` and `resolve-frames.ts` in one place.
 *
 * This is not itself a workflow `Capability` — it is the plain function
 * `retrieve-figma-source-snapshot`'s capability calls, kept separate so it
 * can be unit-tested against a fake `McpClient` without any workflow
 * machinery at all.
 */

export interface BuildSnapshotOptions {
  readonly parsedSource: ParsedFigmaSource;
  readonly captureScreenshots: boolean;
  readonly screenshotArtifactIdPrefix: string;
  readonly now: () => string;
}

export async function buildFigmaSourceSnapshot(
  context: CapabilityContext,
  options: BuildSnapshotOptions,
): Promise<FigmaSourceSnapshot> {
  const client = context.mcp;
  if (client === undefined) {
    throw new Error("buildFigmaSourceSnapshot requires context.mcp to be configured");
  }

  if (client.serverIdentity === "figma-desktop-mcp") {
    return buildFigmaDesktopSourceSnapshot(context, options);
  }

  const { parsedSource } = options;
  const warnings: FigmaSnapshotWarning[] = [];

  const capabilities = await discoverFigmaMcpCapabilities(client, context.signal);

  const document = capabilities.inspectDocument
    ? await figmaMcpGetDocument(client, capabilities, { fileKey: parsedSource.fileKey }, context.signal)
    : { nodes: [], warnings: [{ code: "DOCUMENT_INSPECTION_UNAVAILABLE", message: "The configured server cannot inspect documents" }] };

  warnings.push(...document.warnings);

  const resolution = resolveFigmaFrames(document.nodes, parsedSource.nodeIds, parsedSource.requestedFrames);

  for (const ambiguity of resolution.ambiguities) {
    warnings.push({
      code: "FRAME_AMBIGUOUS",
      message: `"${ambiguity.requested}" matches more than one frame: ${ambiguity.candidates
        .map((candidate) => candidate.path.join("/"))
        .join(", ")}`,
    });
  }

  if (resolution.missing.length > 0 && parsedSource.nodeIds.length + parsedSource.requestedFrames.length > 0) {
    // A requested identifier that resolved to nothing is a hard failure —
    // continuing with "the whole document" instead would silently widen
    // what was asked for. An ambiguity, by contrast, is reported as a
    // warning above and left for the caller (or a future clarification
    // flow) to resolve, since at least one real candidate exists.
    if (resolution.resolved.length === 0 && resolution.ambiguities.length === 0) {
      throw new FigmaFrameNotFoundError(resolution.missing);
    }
    for (const missing of resolution.missing) {
      warnings.push({ code: "FRAME_NOT_FOUND", message: `Could not find: ${missing}` });
    }
  }

  if (resolution.resolved.length === 0 && resolution.ambiguities.length > 0) {
    const first = resolution.ambiguities[0]!;
    throw new FigmaFrameAmbiguousError(
      first.requested,
      first.candidates.map((candidate) => candidate.path.join("/")),
    );
  }

  const variables = capabilities.inspectVariables
    ? await figmaMcpGetVariables(client, capabilities, { fileKey: parsedSource.fileKey }, context.signal)
    : { variables: [], warnings: [{ code: "VARIABLES_UNAVAILABLE", message: "The configured server cannot inspect variables" } as const] };
  warnings.push(...variables.warnings);

  const styles = capabilities.inspectStyles
    ? await figmaMcpGetStyles(client, capabilities, { fileKey: parsedSource.fileKey }, context.signal)
    : { styles: [], warnings: [{ code: "STYLES_UNAVAILABLE", message: "The configured server cannot inspect styles" } as const] };
  warnings.push(...styles.warnings);

  const components = capabilities.inspectComponents
    ? await figmaMcpGetComponents(client, capabilities, { fileKey: parsedSource.fileKey }, context.signal)
    : { components: [], warnings: [{ code: "COMPONENTS_UNAVAILABLE", message: "The configured server cannot inspect components" } as const] };
  warnings.push(...components.warnings);

  const resolvedNodeIds = resolution.resolved.map((frame) => frame.id);
  const assets = capabilities.exportAssets && resolvedNodeIds.length > 0
    ? await figmaMcpGetAssets(client, capabilities, { fileKey: parsedSource.fileKey, nodeIds: resolvedNodeIds }, context.signal)
    : { assets: [], warnings: [] };
  warnings.push(...assets.warnings);

  const screenshots: FigmaScreenshotSnapshot[] = [];
  if (options.captureScreenshots && capabilities.captureScreenshot) {
    for (const frame of resolution.resolved) {
      const captured = await figmaMcpCaptureScreenshot(
        client,
        capabilities,
        { fileKey: parsedSource.fileKey, nodeId: frame.id },
        context.signal,
      );

      if (captured === undefined) {
        warnings.push({
          code: "SCREENSHOT_CAPTURE_FAILED",
          message: `Could not capture a screenshot for ${frame.name}`,
          nodeId: frame.id,
        });
        continue;
      }

      const toolIdentity = capabilities.resolvedToolNames.captureScreenshot;
      const stored = await storeFigmaScreenshotArtifact(context, {
        artifactId: `${options.screenshotArtifactIdPrefix}-${frame.id}`,
        nodeId: frame.id,
        fileKey: parsedSource.fileKey,
        frameName: frame.name,
        captured,
        ...(toolIdentity !== undefined ? { toolIdentity } : {}),
        limits: {},
      });

      screenshots.push({
        nodeId: frame.id,
        // The snapshot carries the payload address consumed by Stage 5.
        // `stored.artifactId` is the caller's logical label; `payloadId` is
        // the content-addressed id understood by ArtifactStore.get().
        artifactId: stored.payloadId,
        format: stored.format,
        ...(stored.width !== undefined ? { width: stored.width } : {}),
        ...(stored.height !== undefined ? { height: stored.height } : {}),
      });
    }
  } else if (options.captureScreenshots && !capabilities.captureScreenshot) {
    warnings.push({
      code: "SCREENSHOT_CAPTURE_UNAVAILABLE",
      message: "The configured server does not support screenshot capture",
    });
  }

  return figmaSourceSnapshotSchema.parse({
    source: {
      designFile: parsedSource.originalInput,
      originalInput: parsedSource.originalInput,
      ...(parsedSource.normalizedUrl !== undefined ? { normalizedUrl: parsedSource.normalizedUrl } : {}),
      fileKey: parsedSource.fileKey,
      nodeIds: parsedSource.nodeIds,
      frames: parsedSource.requestedFrames,
      resolvedFrames: resolution.resolved,
      ...(document.documentName !== undefined ? { documentName: document.documentName } : {}),
      ...(document.documentVersion !== undefined ? { documentVersion: document.documentVersion } : {}),
      ...(document.lastModified !== undefined ? { lastModified: document.lastModified } : {}),
    },
    capabilities: {
      variablesAvailable: capabilities.inspectVariables,
      stylesAvailable: capabilities.inspectStyles,
      componentsAvailable: capabilities.inspectComponents,
      assetsAvailable: capabilities.exportAssets,
      screenshotsAvailable: capabilities.captureScreenshot,
    },
    nodes: document.nodes,
    variables: variables.variables,
    styles: styles.styles,
    components: components.components,
    assets: assets.assets,
    screenshots,
    warnings,
    provenance: {
      ...(client.serverIdentity !== undefined ? { mcpServerIdentity: client.serverIdentity } : {}),
      retrievedAt: options.now(),
      toolVersions: capabilities.resolvedToolNames,
    },
  });
}
