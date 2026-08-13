// packages/capabilities/figma-mcp/src/index.ts
export {
  parseFigmaSource,
  parsedFigmaSourceSchema,
  FigmaSourceInvalidError,
} from "./source/parse-figma-source";
export type { ParsedFigmaSource } from "./source/parse-figma-source";

export { resolveFigmaFrames } from "./normalization/resolve-frames";
export type { ResolvedFrame, FrameAmbiguity, FrameResolutionResult } from "./normalization/resolve-frames";

export { discoverFigmaMcpCapabilities } from "./transport/discover-capabilities";
export type { FigmaMcpCapabilities } from "./transport/discover-capabilities";

export { normalizeFigmaNodeTree } from "./normalization/normalize-nodes";
export type { NormalizedNodes } from "./normalization/normalize-nodes";

export {
  figmaMcpGetDocument,
  figmaMcpGetNodes,
  figmaMcpGetVariables,
  figmaMcpGetStyles,
  figmaMcpGetComponents,
  figmaMcpGetAssets,
  figmaMcpCaptureScreenshot,
} from "./transport/figma-mcp-tools";
export type { DocumentRetrieval, CapturedScreenshot } from "./transport/figma-mcp-tools";

export { storeFigmaScreenshotArtifact, FigmaScreenshotInvalidError } from "./screenshot/screenshot-artifact";
export type { ScreenshotArtifactLimits, StoredScreenshot } from "./screenshot/screenshot-artifact";

export { buildFigmaSourceSnapshot } from "./snapshot/build-snapshot";
export type { BuildSnapshotOptions } from "./snapshot/build-snapshot";
export {
  buildFigmaDesktopSourceSnapshot,
  figmaDesktopSelectionSource,
  readFigmaDesktopSelection,
} from "./desktop/figma-desktop-adapter";
export type { FigmaDesktopSelection } from "./desktop/figma-desktop-adapter";

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
} from "./transport/capabilities";
export type { CapabilityOutput } from "./transport/capabilities";
