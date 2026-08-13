// workflows/workflow-design-to-code/src/visual-validation/test/pixel-comparison.test.ts
//
// V2-5.1: the design's own screenshot versus the rendered implementation.
//
// V2-5 wired the comparison contract but never populated it, so every report
// carried an empty `pixelComparisons` that read exactly like "no differences
// found". Every branch here exists to keep the absence of a comparison
// distinguishable from a clean one.
import { describe, expect, test } from "bun:test";
import { deflateSync } from "node:zlib";

import { comparePixels, type ReferenceScreenshot, type RenderedCapture } from "../render-proposed-state";

function png(width: number, height: number, color: (x: number, y: number) => [number, number, number, number]): Uint8Array {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    for (let x = 0; x < width; x += 1) raw.set(color(x, y), y * (width * 4 + 1) + 1 + x * 4);
  }
  const chunk = (type: string, data: Uint8Array): Buffer => {
    const result = Buffer.alloc(12 + data.byteLength);
    result.writeUInt32BE(data.byteLength, 0);
    result.write(type, 4, 4, "ascii");
    Buffer.from(data).copy(result, 8);
    return result;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", new Uint8Array(deflateSync(raw))),
      chunk("IEND", new Uint8Array()),
    ]),
  );
}

const WHITE: [number, number, number, number] = [255, 255, 255, 255];
const BLACK: [number, number, number, number] = [0, 0, 0, 255];

function capture(bytes: Uint8Array, width = 40, height = 40): RenderedCapture {
  return {
    viewport: { id: "desktop", width, height },
    capture: {
      bytes,
      width,
      height,
      consoleErrors: [],
      runtimeErrors: [],
      failedResources: [],
      warnings: [],
    },
  };
}

function reference(bytes: Uint8Array, overrides: Partial<ReferenceScreenshot> = {}): ReferenceScreenshot {
  return {
    viewportId: "desktop",
    bytes,
    evidenceId: "reference-1:1-desktop",
    artifactId: "artifact-reference-1",
    identity: { fileKey: "file-1", nodeId: "1:1", captureMethod: "figma-mcp" },
    ...overrides,
  };
}

describe("pixel comparison", () => {
  test("an exact match compares to near zero", () => {
    const image = png(40, 40, () => WHITE);
    const result = comparePixels(capture(image), [reference(png(40, 40, () => WHITE))]);

    expect(result.status).toBe("compared");
    expect(result.mismatchRatio).toBe(0);
    expect(result.dimensionCompatible).toBe(true);
    expect(result.alignmentStatus).toBe("aligned");
    expect(result.algorithmVersion).toBe("png-rgba-pixel-diff-v1");
  });

  test("a deliberately different render compares to a real mismatch", () => {
    const result = comparePixels(capture(png(40, 40, () => BLACK)), [reference(png(40, 40, () => WHITE))]);

    expect(result.status).toBe("compared");
    expect(result.mismatchRatio).toBeGreaterThan(0.9);
    expect(result.changedPixelCount).toBeGreaterThan(0);
  });

  test("a viewport mismatch is compared over the region both images cover", () => {
    const result = comparePixels(
      capture(png(40, 44, () => WHITE), 40, 44),
      [reference(png(41, 50, () => WHITE))],
    );

    expect(result.status).toBe("compared");
    expect(result.dimensionCompatible).toBe(false);
    expect(result.alignmentStatus).toBe("overlap-compared");
    expect(result.expectedViewport).toEqual({ width: 41, height: 50 });
    expect(result.actualViewport).toEqual({ width: 40, height: 44 });
    expect(result.overlapCoverage).toBeGreaterThan(0);
    // The comparable content matched, even though the frames differ in size.
    expect(result.overlapMismatchRatio).toBe(0);
  });

  test("a missing reference is unavailable, never a clean comparison", () => {
    const result = comparePixels(capture(png(40, 40, () => WHITE)), []);

    expect(result.status).toBe("unavailable");
    expect(result.mismatchRatio).toBeUndefined();
    expect(result.reason).toContain("no reference screenshot");
  });

  test("a reference for another viewport does not stand in for this one", () => {
    const result = comparePixels(
      capture(png(40, 40, () => WHITE)),
      [reference(png(40, 40, () => WHITE), { viewportId: "mobile" })],
    );
    expect(result.status).toBe("unavailable");
  });

  test("a reference from a different design node is refused, not compared", () => {
    const result = comparePixels(
      capture(png(40, 40, () => WHITE)),
      [reference(png(40, 40, () => BLACK))],
      { fileKey: "file-1", nodeId: "9:9" },
    );

    expect(result.status).toBe("identity_mismatch");
    expect(result.mismatchRatio).toBeUndefined();
    expect(result.reason).toContain("different design node");
  });

  test("a reference from the same design node is compared", () => {
    const result = comparePixels(
      capture(png(40, 40, () => WHITE)),
      [reference(png(40, 40, () => WHITE))],
      { fileKey: "file-1", nodeId: "1:1" },
    );
    expect(result.status).toBe("compared");
    expect(result.referenceIdentity?.nodeId).toBe("1:1");
  });

  test("an undecodable reference is incompatible rather than a mismatch of one", () => {
    const result = comparePixels(
      capture(png(40, 40, () => WHITE)),
      [reference(new Uint8Array([1, 2, 3, 4]))],
    );

    expect(result.status).toBe("incompatible");
    expect(result.mismatchRatio).toBeUndefined();
  });

  test("the comparison carries the reference's identity into the report", () => {
    const result = comparePixels(capture(png(40, 40, () => WHITE)), [reference(png(40, 40, () => WHITE))]);
    expect(result.referenceEvidenceId).toBe("reference-1:1-desktop");
    expect(result.referenceArtifactId).toBe("artifact-reference-1");
    expect(result.referenceIdentity?.captureMethod).toBe("figma-mcp");
  });
});
