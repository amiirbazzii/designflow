// packages/capabilities/figma-mcp/src/screenshot-artifact.test.ts
import { describe, expect, test } from "bun:test";
import type { ArtifactStore, CapabilityContext } from "@designflow/sdk";
import { FigmaScreenshotInvalidError, storeFigmaScreenshotArtifact } from "./screenshot-artifact";
import type { CapturedScreenshot } from "./figma-mcp-tools";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function fakeStore(): ArtifactStore & { readonly saved: unknown[] } {
  const saved: unknown[] = [];
  const byPayload = new Map<string, unknown>();
  let counter = 0;

  return {
    saved,
    async save(data: unknown) {
      const key = JSON.stringify(data);
      const existing = [...byPayload.entries()].find(([, value]) => JSON.stringify(value) === key);
      if (existing !== undefined) return { id: existing[0], data };

      const id = `payload-${counter++}`;
      byPayload.set(id, data);
      saved.push(data);
      return { id, data };
    },
    async get(id: string) {
      const data = byPayload.get(id);
      return data === undefined ? null : { id, data };
    },
    async exists(id: string) {
      return byPayload.has(id);
    },
  };
}

function context(store: ArtifactStore): CapabilityContext {
  return {
    executionId: "exec-1",
    workflowId: "wf-1",
    capabilityId: "cap-1",
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    artifactRefs: [],
    parentArtifacts: [],
    artifactStore: store,
    config: {},
    signal: new AbortController().signal,
  };
}

function png(bytes = PNG_SIGNATURE): CapturedScreenshot {
  return { base64Data: bytes.toString("base64"), format: "png", width: 100, height: 100 };
}

describe("valid screenshots", () => {
  test("stores a valid PNG and returns its stable identity", async () => {
    const store = fakeStore();
    const stored = await storeFigmaScreenshotArtifact(context(store), {
      artifactId: "figma-screenshot-1:1",
      nodeId: "1:1",
      fileKey: "abc",
      captured: png(),
    });

    expect(stored.format).toBe("png");
    expect(stored.width).toBe(100);
    expect(store.saved).toHaveLength(1);
  });

  test("multiple distinct screenshots are each stored", async () => {
    const store = fakeStore();
    await storeFigmaScreenshotArtifact(context(store), {
      artifactId: "figma-screenshot-1:1",
      nodeId: "1:1",
      fileKey: "abc",
      captured: png(),
    });
    await storeFigmaScreenshotArtifact(context(store), {
      artifactId: "figma-screenshot-1:2",
      nodeId: "1:2",
      fileKey: "abc",
      captured: png(Buffer.concat([PNG_SIGNATURE, Buffer.from("different")])),
    });

    expect(store.saved).toHaveLength(2);
  });

  test("identical bytes captured twice are deduplicated by the content-addressed store", async () => {
    const store = fakeStore();
    const first = await storeFigmaScreenshotArtifact(context(store), {
      artifactId: "figma-screenshot-1:1",
      nodeId: "1:1",
      fileKey: "abc",
      captured: png(),
    });
    const second = await storeFigmaScreenshotArtifact(context(store), {
      artifactId: "figma-screenshot-1:1",
      nodeId: "1:1",
      fileKey: "abc",
      captured: png(),
    });

    expect(second.payloadId).toBe(first.payloadId);
    expect(store.saved).toHaveLength(1);
  });
});

describe("invalid screenshots", () => {
  test("rejects a MIME type that does not match the file signature", async () => {
    const store = fakeStore();
    const notActuallyPng: CapturedScreenshot = {
      base64Data: Buffer.from("<html>this is not an image</html>").toString("base64"),
      format: "png",
    };

    await expect(
      storeFigmaScreenshotArtifact(context(store), {
        artifactId: "figma-screenshot-1:1",
        nodeId: "1:1",
        fileKey: "abc",
        captured: notActuallyPng,
      }),
    ).rejects.toThrow(FigmaScreenshotInvalidError);
  });

  test("rejects corrupted / truncated bytes", async () => {
    const store = fakeStore();
    await expect(
      storeFigmaScreenshotArtifact(context(store), {
        artifactId: "figma-screenshot-1:1",
        nodeId: "1:1",
        fileKey: "abc",
        captured: { base64Data: Buffer.from([0x00]).toString("base64"), format: "png" },
      }),
    ).rejects.toThrow(FigmaScreenshotInvalidError);
  });

  test("rejects an oversized capture", async () => {
    const store = fakeStore();
    const big = Buffer.concat([PNG_SIGNATURE, Buffer.alloc(1000, 1)]);

    await expect(
      storeFigmaScreenshotArtifact(context(store), {
        artifactId: "figma-screenshot-1:1",
        nodeId: "1:1",
        fileKey: "abc",
        captured: png(big),
        limits: { maxBytes: 100 },
      }),
    ).rejects.toThrow(FigmaScreenshotInvalidError);
  });

  test("rejects dimensions exceeding the configured maximum", async () => {
    const store = fakeStore();
    await expect(
      storeFigmaScreenshotArtifact(context(store), {
        artifactId: "figma-screenshot-1:1",
        nodeId: "1:1",
        fileKey: "abc",
        captured: { base64Data: PNG_SIGNATURE.toString("base64"), format: "png", width: 9999, height: 100 },
        limits: { maxWidth: 4096 },
      }),
    ).rejects.toThrow(FigmaScreenshotInvalidError);
  });

  test("rejects invalid base64", async () => {
    const store = fakeStore();
    await expect(
      storeFigmaScreenshotArtifact(context(store), {
        artifactId: "figma-screenshot-1:1",
        nodeId: "1:1",
        fileKey: "abc",
        captured: { base64Data: "not valid base64!!! %%%", format: "png" },
      }),
    ).rejects.toThrow();
  });
});
