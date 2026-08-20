import type {
  FigmaScreenshotSnapshot,
  FigmaSourceSnapshot,
} from "@designflow/sdk";
import type { ParsedFigmaSource } from "@designflow/capability-figma-mcp";

export type FreshSnapshotSourceKind = "current-selection" | "figma-url";

export interface FreshEvidenceRequest {
  readonly source: ParsedFigmaSource;
  readonly nodeId: string;
  readonly sourceKind: FreshSnapshotSourceKind;
}

export type FreshEvidenceCompiler<TSpecificationEvidence = unknown> = (
  snapshot: FigmaSourceSnapshot,
) => TSpecificationEvidence;

export type FreshSnapshotRetriever = (
  source: ParsedFigmaSource,
  sourceKind: FreshSnapshotSourceKind,
) => Promise<FigmaSourceSnapshot>;

/**
 * One frame-bound result for the Fresh path.
 *
 * `snapshot` remains the authoritative source of all node, style, asset,
 * screenshot, warning, and provenance facts. The compact specification
 * projection is reused for later consumers; it is not a second evidence
 * compiler. `frame` is the only Fresh-specific validation/projection: it
 * makes the selected frame's trusted dimensions explicit.
 */
export interface FreshFrameEvidence<TSpecificationEvidence = unknown> {
  readonly schemaVersion: "1";
  readonly frame: {
    readonly id: string;
    readonly name: string;
    readonly path: readonly string[];
    readonly width: number;
    readonly height: number;
  };
  readonly snapshot: FigmaSourceSnapshot;
  readonly specificationEvidence: TSpecificationEvidence;
  readonly referenceScreenshot?: FigmaScreenshotSnapshot;
}

export class FreshEvidenceInvalidError extends Error {
  public readonly code = "ERR_FRESH_EVIDENCE_INCOMPLETE";

  public constructor(message: string, public readonly metadata: Record<string, unknown> = {}) {
    super(message);
    this.name = "FreshEvidenceInvalidError";
    Object.setPrototypeOf(this, FreshEvidenceInvalidError.prototype);
  }
}

/**
 * Validates and projects one already-retrieved canonical snapshot.
 * Retrieval stays in the composition root; this function is deterministic and
 * has no filesystem, MCP, project, session, or workflow access.
 */
export function normalizeFreshFrameEvidence(
  snapshot: FigmaSourceSnapshot,
  requestedNodeId: string,
  compileEvidence: FreshEvidenceCompiler,
): FreshFrameEvidence {
  if (snapshot.source.resolvedFrames.length !== 1) {
    throw new FreshEvidenceInvalidError(
      "Fresh UI evidence must resolve exactly one Figma frame.",
      { resolvedFrameCount: snapshot.source.resolvedFrames.length, requestedNodeId },
    );
  }

  const frame = snapshot.source.resolvedFrames[0];
  if (frame === undefined || frame.id !== requestedNodeId) {
    throw new FreshEvidenceInvalidError(
      "Fresh UI evidence did not resolve the requested Figma frame.",
      { requestedNodeId, resolvedNodeId: frame?.id },
    );
  }

  const node = snapshot.nodes.find((candidate) => candidate.id === frame.id);
  const bounds = node?.absoluteBoundingBox;
  if (
    node === undefined
    || bounds === undefined
    || !Number.isFinite(bounds.width)
    || !Number.isFinite(bounds.height)
    || bounds.width <= 0
    || bounds.height <= 0
  ) {
    throw new FreshEvidenceInvalidError(
      "Figma evidence is incomplete: the selected frame has no authoritative width and height.",
      { requestedNodeId, hasNode: node !== undefined, hasBounds: bounds !== undefined },
    );
  }

  // `retrievedAt` is transport provenance, intentionally volatile. Keep it
  // on the authoritative snapshot while excluding it from the deterministic
  // compact projection and its byte metrics.
  const { retrievedAt: _retrievedAt, ...stableProvenance } = snapshot.provenance;
  const specificationEvidence = compileEvidence({
    ...snapshot,
    provenance: stableProvenance,
  });
  const referenceScreenshot = snapshot.screenshots.find((screenshot) => screenshot.nodeId === frame.id);

  return {
    schemaVersion: "1",
    frame: {
      id: frame.id,
      name: frame.name,
      path: frame.path,
      width: bounds.width,
      height: bounds.height,
    },
    snapshot,
    specificationEvidence,
    ...(referenceScreenshot === undefined ? {} : { referenceScreenshot }),
  };
}

/** Retrieve through the host seam, then apply the Fresh-only frame contract. */
export async function retrieveFreshFrameEvidence(
  request: FreshEvidenceRequest,
  retrieveSnapshot: FreshSnapshotRetriever,
  compileEvidence: FreshEvidenceCompiler,
): Promise<FreshFrameEvidence> {
  const snapshot = await retrieveSnapshot(request.source, request.sourceKind);
  return normalizeFreshFrameEvidence(snapshot, request.nodeId, compileEvidence);
}

export function freshEvidenceErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Figma evidence could not be retrieved.";
}
