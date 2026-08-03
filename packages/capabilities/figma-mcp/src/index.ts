// packages/capabilities/figma-mcp/src/index.ts
export {
  parseFigmaSource,
  parsedFigmaSourceSchema,
  FigmaSourceInvalidError,
} from "./parse-figma-source";
export type { ParsedFigmaSource } from "./parse-figma-source";

export { resolveFigmaFrames } from "./resolve-frames";
export type { ResolvedFrame, FrameAmbiguity, FrameResolutionResult } from "./resolve-frames";

export { discoverFigmaMcpCapabilities } from "./discover-capabilities";
export type { FigmaMcpCapabilities } from "./discover-capabilities";

export { normalizeFigmaNodeTree } from "./normalize-nodes";
export type { NormalizedNodes } from "./normalize-nodes";

export {
  figmaMcpGetDocument,
  figmaMcpGetNodes,
  figmaMcpGetVariables,
  figmaMcpGetStyles,
  figmaMcpGetComponents,
  figmaMcpGetAssets,
  figmaMcpCaptureScreenshot,
} from "./figma-mcp-tools";
export type { DocumentRetrieval, CapturedScreenshot } from "./figma-mcp-tools";

export { storeFigmaScreenshotArtifact, FigmaScreenshotInvalidError } from "./screenshot-artifact";
export type { ScreenshotArtifactLimits, StoredScreenshot } from "./screenshot-artifact";

export { buildFigmaSourceSnapshot } from "./build-snapshot";
export type { BuildSnapshotOptions } from "./build-snapshot";

export {
  FIGMA_MCP_ERROR_CODES,
  FigmaMcpUnsupportedOperationError,
  FigmaFrameAmbiguousError,
  FigmaFrameNotFoundError,
} from "./errors";
export type { FigmaMcpErrorCode } from "./errors";

export {
  FIGMA_MCP_ARTIFACT_IDS,
  parseFigmaSourceCapability,
  retrieveFigmaSourceSnapshotCapability,
  figmaMcpCapabilities,
} from "./capabilities";
export type { CapabilityOutput } from "./capabilities";
