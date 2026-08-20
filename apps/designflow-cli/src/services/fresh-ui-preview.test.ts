import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserCapture, BrowserRenderer, PreviewRuntimeRecord } from "@designflow/workflow-design-to-code";
import type { PreviewTargetV1 } from "@designflow/sdk";
import type { FreshFrameEvidence } from "./fresh-figma-evidence";
import type { FreshScaffoldResult } from "./fresh-project-scaffolder";
import { captureFreshUiPreview, FreshPreviewError } from "./fresh-ui-preview";

const evidence: FreshFrameEvidence = {
  schemaVersion: "1",
  frame: { id: "1026:6115", name: "Add Expense Form", path: ["Add Expense Form"], width: 392, height: 488 },
  snapshot: undefined as never,
  specificationEvidence: undefined,
};

async function fixture(): Promise<{ root: string; scaffold: FreshScaffoldResult }> {
  const root = await mkdtemp(join(tmpdir(), "designflow-fresh-preview-"));
  const targetPath = join(root, "add-expense-form");
  await Bun.write(join(targetPath, ".keep"), "");
  return { root, scaffold: { outputRoot: root, targetPath, frameSlug: "add-expense-form", files: [] } };
}

function record(status: PreviewRuntimeRecord["status"], target?: PreviewRuntimeRecord["target"]): PreviewRuntimeRecord {
  return { status, ...(target === undefined ? {} : { target }), startedAt: "2026-01-01T00:00:00.000Z", endedAt: "2026-01-01T00:00:01.000Z", stdout: "", stderr: "", warnings: [] };
}

function harness(options: {
  readonly runtimeStatus?: PreviewRuntimeRecord["status"];
  readonly capture?: Partial<BrowserCapture>;
  readonly rendererError?: Error;
}) {
  let closes = 0;
  let capturedViewport: { id: string; width: number; height: number } | undefined;
  const runtime = {
    start: async (target: PreviewTargetV1, _root: string, _signal: AbortSignal) => record(options.runtimeStatus ?? "ready", target),
    close: async () => { closes += 1; },
  };
  const renderer: BrowserRenderer = {
    capture: async (_url, viewport) => {
      capturedViewport = viewport;
      if (options.rendererError !== undefined) throw options.rendererError;
      return {
        bytes: new Uint8Array([1, 2, 3]), width: 392, height: 488,
        finalUrl: "http://127.0.0.1:43123/", consoleErrors: [], runtimeErrors: [], failedResources: [], warnings: [],
        ...options.capture,
      };
    },
    close: async () => { closes += 1; },
  };
  return { runtime, renderer, get closes() { return closes; }, get capturedViewport() { return capturedViewport; } };
}

describe("Fresh UI preview", () => {
  it("starts the generated project, captures the exact Figma viewport, and cleans up", async () => {
    const { root, scaffold } = await fixture();
    const h = harness({});
    try {
      const result = await captureFreshUiPreview({ evidence, scaffold }, {
        createRuntime: () => h.runtime,
        loadRenderer: async () => h.renderer,
        choosePort: async () => 43123,
      });
      expect(result.finalPathname).toBe("/");
      expect(result.viewport).toEqual({ width: 392, height: 488 });
      expect(result.screenshot.bytes).toEqual(new Uint8Array([1, 2, 3]));
      expect(result.diagnostics.dom).toBeUndefined();
      expect(h.capturedViewport).toEqual({ id: "fresh-frame", width: 392, height: 488 });
      expect(result.provenance.previewProcess.target?.command.args).toEqual(["run", "dev", "--", "--host", "127.0.0.1", "--port", "43123"]);
      expect(result.provenance.previewProcess.target?.readinessUrl).toBe("http://127.0.0.1:43123/");
      expect(h.closes).toBe(2);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("classifies process failure and readiness timeout", async () => {
    const { root, scaffold } = await fixture();
    try {
      for (const [status, code] of [["failed", "ERR_FRESH_PREVIEW_PROCESS_FAILED"], ["unavailable", "ERR_FRESH_PREVIEW_READINESS_TIMEOUT"]] as const) {
        const h = harness({ runtimeStatus: status });
        await expect(captureFreshUiPreview({ evidence, scaffold }, { createRuntime: () => h.runtime, loadRenderer: async () => h.renderer, choosePort: async () => 43123 })).rejects.toMatchObject({ code });
        expect(h.closes).toBe(1);
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("rejects redirects, screenshot failures, runtime errors, and cancellation", async () => {
    const { root, scaffold } = await fixture();
    try {
      const redirect = harness({ capture: { finalUrl: "https://example.com/" } });
      await expect(captureFreshUiPreview({ evidence, scaffold }, { createRuntime: () => redirect.runtime, loadRenderer: async () => redirect.renderer, choosePort: async () => 43123 })).rejects.toMatchObject({ code: "ERR_FRESH_PREVIEW_UNEXPECTED_PATH" });
      const screenshot = harness({ rendererError: new Error("capture failed") });
      await expect(captureFreshUiPreview({ evidence, scaffold }, { createRuntime: () => screenshot.runtime, loadRenderer: async () => screenshot.renderer, choosePort: async () => 43123 })).rejects.toMatchObject({ code: "ERR_FRESH_PREVIEW_NAVIGATION_FAILED" });
      expect(screenshot.closes).toBe(2);
      const runtimeError = harness({ capture: { runtimeErrors: ["boom"] } });
      await expect(captureFreshUiPreview({ evidence, scaffold }, { createRuntime: () => runtimeError.runtime, loadRenderer: async () => runtimeError.renderer, choosePort: async () => 43123 })).rejects.toMatchObject({ code: "ERR_FRESH_PREVIEW_RUNTIME_ERROR" });
      expect(runtimeError.closes).toBe(2);
      const signal = AbortSignal.abort();
      await expect(captureFreshUiPreview({ evidence, scaffold, signal }, { createRuntime: () => { throw new Error("must not start"); } })).rejects.toBeInstanceOf(FreshPreviewError);
      await expect(captureFreshUiPreview({ evidence, scaffold, signal }, { createRuntime: () => { throw new Error("must not start"); } })).rejects.toMatchObject({ code: "ERR_FRESH_PREVIEW_CANCELLED" });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("rejects targets outside the approved Fresh output root", async () => {
    const { root } = await fixture();
    try {
      const scaffold: FreshScaffoldResult = { outputRoot: root, targetPath: join(root, "..", "escape"), frameSlug: "escape", files: [] };
      await expect(captureFreshUiPreview({ evidence, scaffold }, { createRuntime: () => { throw new Error("must not start"); } })).rejects.toMatchObject({ code: "ERR_FRESH_PREVIEW_PATH" });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("rejects unbounded or fractional authoritative dimensions before starting a process", async () => {
    const { root, scaffold } = await fixture();
    try {
      for (const frame of [
        { ...evidence.frame, width: 0 },
        { ...evidence.frame, width: 392.5 },
        { ...evidence.frame, width: 5000 },
      ]) {
        await expect(captureFreshUiPreview({ evidence: { ...evidence, frame }, scaffold }, { createRuntime: () => { throw new Error("must not start"); } })).rejects.toMatchObject({ code: "ERR_FRESH_PREVIEW_SCREENSHOT_FAILED" });
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
