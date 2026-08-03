// packages/capabilities/figma-mcp/src/screenshot-artifact.ts
import { DesignFlowError, type CapabilityContext } from "@designflow/sdk";
import type { CapturedScreenshot } from "./figma-mcp-tools";

/**
 * Validates and stores one captured Figma screenshot as its own artifact.
 *
 * The base64 image bytes live *only* in the artifact store's payload — never
 * in the small metadata object this function also builds, which is what
 * becomes the artifact reference's `metadata` and therefore what a history
 * or trace record actually carries. `designflow artifacts <run-id>` shows the
 * metadata (node, frame, format, dimensions, content hash) without ever
 * needing to show — or store twice — the image itself.
 *
 * Deduplication is not implemented here as a separate step: `ArtifactStore.save`
 * already content-addresses its payload (an unchanged payload maps to the
 * same stored id — see Stage 1's `artifact-io.ts`), so capturing the same
 * bytes again for the same node is already cheap by construction.
 */

export interface ScreenshotArtifactLimits {
  readonly maxWidth?: number;
  readonly maxHeight?: number;
  readonly maxBytes?: number;
}

const DEFAULT_MAX_WIDTH = 4096;
const DEFAULT_MAX_HEIGHT = 4096;
const DEFAULT_MAX_BYTES = 8_000_000;

const SIGNATURES: Record<"png" | "jpeg" | "webp", readonly number[]> = {
  png: [0x89, 0x50, 0x4e, 0x47],
  jpeg: [0xff, 0xd8, 0xff],
  webp: [0x52, 0x49, 0x46, 0x46], // "RIFF" — WEBP's marker follows at byte 8, checked separately below
};

export class FigmaScreenshotInvalidError extends DesignFlowError {
  public constructor(reason: string) {
    super("ERR_FIGMA_SCREENSHOT_INVALID", `Rejected Figma screenshot: ${reason}`, {});
    this.name = "FigmaScreenshotInvalidError";
    Object.setPrototypeOf(this, FigmaScreenshotInvalidError.prototype);
  }
}

function matchesSignature(bytes: Uint8Array, format: "png" | "jpeg" | "webp"): boolean {
  const signature = SIGNATURES[format];
  if (bytes.length < signature.length) return false;
  if (!signature.every((byte, index) => bytes[index] === byte)) return false;
  if (format === "webp") {
    // RIFF....WEBP — the format marker starts at byte 8, not immediately after "RIFF".
    const marker = String.fromCharCode(...bytes.slice(8, 12));
    return marker === "WEBP";
  }
  return true;
}

export interface StoredScreenshot {
  readonly artifactId: string;
  readonly payloadId: string;
  readonly width: number | undefined;
  readonly height: number | undefined;
  readonly format: "png" | "jpeg" | "webp";
}

/**
 * Decodes, validates and stores one screenshot. Throws
 * `FigmaScreenshotInvalidError` rather than returning `undefined` for a
 * genuinely malformed capture (wrong signature, oversized) — a workflow
 * capability decides whether that should fail the run or degrade to a
 * warning; this function only ever tells the truth about what it received.
 */
export async function storeFigmaScreenshotArtifact(
  context: CapabilityContext,
  options: {
    readonly artifactId: string;
    readonly nodeId: string;
    readonly fileKey: string;
    readonly frameName?: string;
    readonly captured: CapturedScreenshot;
    readonly sourceSnapshotArtifactId?: string;
    readonly toolIdentity?: string;
    readonly limits?: ScreenshotArtifactLimits;
  },
): Promise<StoredScreenshot> {
  const maxWidth = options.limits?.maxWidth ?? DEFAULT_MAX_WIDTH;
  const maxHeight = options.limits?.maxHeight ?? DEFAULT_MAX_HEIGHT;
  const maxBytes = options.limits?.maxBytes ?? DEFAULT_MAX_BYTES;

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(Buffer.from(options.captured.base64Data, "base64"));
  } catch {
    throw new FigmaScreenshotInvalidError("the captured data was not valid base64");
  }

  if (bytes.length === 0) {
    throw new FigmaScreenshotInvalidError("the captured data decoded to zero bytes");
  }

  if (bytes.length > maxBytes) {
    throw new FigmaScreenshotInvalidError(`exceeds the maximum allowed size of ${maxBytes} bytes`);
  }

  if (!matchesSignature(bytes, options.captured.format)) {
    throw new FigmaScreenshotInvalidError(
      `the decoded bytes do not match a ${options.captured.format.toUpperCase()} file signature`,
    );
  }

  if (options.captured.width !== undefined && options.captured.width > maxWidth) {
    throw new FigmaScreenshotInvalidError(`width ${options.captured.width} exceeds the maximum of ${maxWidth}`);
  }
  if (options.captured.height !== undefined && options.captured.height > maxHeight) {
    throw new FigmaScreenshotInvalidError(`height ${options.captured.height} exceeds the maximum of ${maxHeight}`);
  }

  const stored = await context.artifactStore.save(options.captured.base64Data, {
    type: "figma.screenshot",
    artifactId: options.artifactId,
  });

  return {
    artifactId: options.artifactId,
    payloadId: stored.id,
    width: options.captured.width,
    height: options.captured.height,
    format: options.captured.format,
  };
}
