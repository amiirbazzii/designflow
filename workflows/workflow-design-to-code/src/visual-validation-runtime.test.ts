import { afterEach, describe, expect, test } from "bun:test";
import { deflateSync } from "node:zlib";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { inspectRegisteredProject } from "@designflow/capability-implementation";
import { previewRuntimeRecordSchema } from "./visual-validation-types";
import { comparePngImages, compareScreenshotBytes, discoverPreviewCommand, makePreviewTarget, PreviewRuntime } from "./visual-validation-runtime";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture(script = "node -e \"setTimeout(() => {}, 10000)\""): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "designflow-stage5-preview-"));
  roots.push(root);
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "preview-fixture", scripts: { dev: script } }));
  await writeFile(join(root, "package-lock.json"), "{}\n");
  return root;
}

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
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", new Uint8Array(deflateSync(raw))), chunk("IEND", new Uint8Array())]));
}

describe("Stage 5 preview runtime", () => {
  test("the tracked React acceptance fixture exposes a safe declared preview script", async () => {
    const root = resolve(import.meta.dir, "../../../test-fixtures/designflow-stage7-preview");
    const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { scripts?: Record<string, unknown> };
    const context = inspectRegisteredProject({ id: "stage7-preview", name: "Stage 7 preview", rootPath: root });
    expect(packageJson.scripts?.preview).toBe("vite --host 127.0.0.1");
    expect(discoverPreviewCommand(context)).toMatchObject({ executable: "npm", scriptName: "preview", args: ["run", "preview", "--", "--host", "127.0.0.1", "--port", "0"] });
  });

  test("discovers only the declared npm preview script and constructs safe argv", async () => {
    const root = await fixture();
    const context = inspectRegisteredProject({ id: "preview", name: "Preview", rootPath: root });
    expect(discoverPreviewCommand(context)).toMatchObject({ executable: "npm", args: ["run", "dev", "--", "--host", "127.0.0.1", "--port", "0"], scriptName: "dev" });
    const target = await makePreviewTarget(context, "/", 500);
    expect(target?.expectedHost).toBe("127.0.0.1");
    expect(target?.command.args).toContain("127.0.0.1");
    expect(target?.command.args).toContain(String(target.assignedPort));
  });

  test("times out and cleans up a preview process", async () => {
    const root = await fixture();
    const context = inspectRegisteredProject({ id: "preview", name: "Preview", rootPath: root });
    const target = await makePreviewTarget(context, "/", 300);
    expect(target).not.toBeUndefined();
    const result = await new PreviewRuntime().start(target!, root, new AbortController().signal);
    expect(["failed", "unavailable"]).toContain(result.status);
    expect(result.warnings.join(" ")).toMatch(/timeout|exited|readiness/i);
  });

  test("serializes the complete canonical preview target", async () => {
    const root = await fixture();
    const context = inspectRegisteredProject({ id: "preview", name: "Preview", rootPath: root });
    const target = await makePreviewTarget(context, "/", 300);
    const record = previewRuntimeRecordSchema.parse({
      schemaVersion: "1",
      status: "unavailable",
      target,
      startedAt: new Date(0).toISOString(),
      endedAt: new Date(0).toISOString(),
      stdout: "",
      stderr: "",
      warnings: [],
    });
    expect(record.target?.expectedHost).toBe("127.0.0.1");
    expect(record.target?.shutdownPolicy).toBe("always");
  });

  test("compares bounded image bytes deterministically", () => {
    const image = png(4, 4, () => [10, 20, 30, 255]);
    expect(compareScreenshotBytes(image, image)).toEqual({ mismatchRatio: 0, identical: true });
    expect(compareScreenshotBytes(image, png(4, 4, (x, y) => x === 0 && y === 0 ? [220, 20, 30, 255] : [10, 20, 30, 255]))).toMatchObject({ identical: false });
  });

  test("uses bounded spatial PNG comparison for noise, shifts, colors, and dimensions", () => {
    const base = png(12, 8, () => [240, 240, 240, 255]);
    const noise = png(12, 8, (x, y) => x === 2 && y === 2 ? [245, 245, 245, 255] : [240, 240, 240, 255]);
    const shift = png(12, 8, (x, y) => x < 2 || y < 2 ? [20, 20, 20, 255] : [240, 240, 240, 255]);
    const background = png(12, 8, () => [20, 20, 20, 255]);
    const smaller = png(10, 8, () => [240, 240, 240, 255]);
    expect(comparePngImages(base, noise).mismatchRatio).toBe(0);
    expect(comparePngImages(base, shift).mismatchRatio).toBeGreaterThan(0.05);
    expect(comparePngImages(base, background).mismatchRatio).toBe(1);
    expect(comparePngImages(base, smaller).dimensionCompatible).toBe(false);
  });
});

describe("overlap comparison on dimension mismatch (MVP-4H)", () => {
  const white: [number, number, number, number] = [255, 255, 255, 255];
  const black: [number, number, number, number] = [0, 0, 0, 255];

  test("same-size identical images produce zero diff and full overlap", () => {
    const image = png(40, 40, () => white);
    const result = comparePngImages(image, png(40, 40, () => white));
    expect(result.dimensionCompatible).toBe(true);
    expect(result.overlapWidth).toBe(40);
    expect(result.overlapCoverage).toBe(1);
    expect(result.overlapChangedPixelCount).toBe(0);
    expect(result.pixelDiffExecuted).toBe(true);
  });

  test("different dimensions with identical overlapping content report mismatch without content divergence", () => {
    const reference = png(41, 50, () => white);
    const implementation = png(40, 44, () => white);
    const result = comparePngImages(reference, implementation);
    expect(result.dimensionCompatible).toBe(false);
    expect(result.overlapWidth).toBe(40);
    expect(result.overlapHeight).toBe(44);
    expect(result.overlapChangedPixelCount).toBe(0);
    expect(result.overlapMismatchRatio).toBe(0);
    expect(result.overlapCoverage).toBeCloseTo((40 * 44) / (41 * 50), 5);
    // The whole-canvas ratio still counts the size delta truthfully.
    expect(result.changedPixelCount).toBe(41 * 50 - 40 * 44);
  });

  test("different dimensions with very different content report substantial overlap divergence", () => {
    const reference = png(41, 50, () => white);
    const implementation = png(40, 44, () => black);
    const result = comparePngImages(reference, implementation);
    expect(result.dimensionCompatible).toBe(false);
    expect(result.overlapChangedPixelCount).toBe(40 * 44);
    expect(result.overlapMismatchRatio).toBe(1);
    expect(result.pixelDiffExecuted).toBe(true);
  });

  test("tiny overlap coverage is measured so callers can classify it inconclusive", () => {
    const reference = png(100, 100, () => white);
    const implementation = png(10, 10, () => black);
    const result = comparePngImages(reference, implementation);
    expect(result.overlapCoverage).toBeCloseTo(0.01, 5);
  });

  test("identical inputs produce byte-for-byte identical measurements (determinism)", () => {
    const reference = png(41, 50, (x, y) => (x + y) % 3 === 0 ? black : white);
    const implementation = png(40, 44, (x, y) => (x * y) % 5 === 0 ? black : white);
    const first = comparePngImages(reference, implementation);
    const second = comparePngImages(reference, implementation);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
