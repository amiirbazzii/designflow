import { randomInt } from "node:crypto";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  PreviewRuntime,
  RendererUnavailableError,
  loadOptionalPlaywrightRenderer,
  type BrowserCapture,
  type BrowserRenderer,
  type PreviewRuntimeRecord,
} from "@designflow/workflow-design-to-code";
import { previewTargetV1Schema, type PreviewTargetV1 } from "@designflow/sdk";
import type { FreshFrameEvidence } from "./fresh-figma-evidence";
import type { FreshScaffoldResult } from "./fresh-project-scaffolder";

const PREVIEW_HOST = "127.0.0.1";
const STARTUP_TIMEOUT_MS = 30_000;
const CAPTURE_TIMEOUT_MS = 30_000;
const MAX_IMAGE_BYTES = 10_000_000;
const MAX_IMAGE_PIXELS = 8_000_000;

export interface FreshPreviewResult {
  readonly previewUrl: string;
  readonly finalPathname: string;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly screenshot: {
    readonly mimeType: "image/png";
    readonly bytes: Uint8Array;
    readonly width: number;
    readonly height: number;
  };
  readonly diagnostics: {
    readonly dom?: BrowserCapture["dom"];
    readonly consoleErrors: readonly string[];
    readonly runtimeErrors: readonly string[];
    readonly failedResources: readonly string[];
    readonly warnings: readonly string[];
  };
  readonly provenance: {
    readonly startedAt: string;
    readonly completedAt: string;
    readonly durationMs: number;
    readonly previewProcess: PreviewRuntimeRecord;
  };
}

export type FreshPreviewErrorCode =
  | "ERR_FRESH_PREVIEW_PATH"
  | "ERR_FRESH_PREVIEW_PROCESS_FAILED"
  | "ERR_FRESH_PREVIEW_READINESS_TIMEOUT"
  | "ERR_FRESH_PREVIEW_NAVIGATION_FAILED"
  | "ERR_FRESH_PREVIEW_UNEXPECTED_PATH"
  | "ERR_FRESH_PREVIEW_SCREENSHOT_FAILED"
  | "ERR_FRESH_PREVIEW_RUNTIME_ERROR"
  | "ERR_FRESH_PREVIEW_CANCELLED";

export class FreshPreviewError extends Error {
  public constructor(
    public readonly code: FreshPreviewErrorCode,
    message: string,
    public readonly metadata: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "FreshPreviewError";
    Object.setPrototypeOf(this, FreshPreviewError.prototype);
  }
}

interface FreshPreviewRuntime {
  start(target: PreviewTargetV1, root: string, signal: AbortSignal): Promise<PreviewRuntimeRecord>;
  close(): Promise<void>;
}

export interface FreshPreviewDependencies {
  readonly createRuntime?: () => FreshPreviewRuntime;
  readonly loadRenderer?: () => Promise<BrowserRenderer | undefined>;
  readonly choosePort?: () => Promise<number>;
}

export interface FreshPreviewRequest {
  readonly evidence: FreshFrameEvidence;
  readonly scaffold: FreshScaffoldResult;
  readonly signal?: AbortSignal;
}

function defaultRuntime(): FreshPreviewRuntime {
  return new PreviewRuntime();
}

async function defaultPort(): Promise<number> {
  return randomInt(49_152, 65_535);
}

function assertInsideFreshProject(scaffold: FreshScaffoldResult): Promise<string> {
  const root = resolve(scaffold.outputRoot);
  const target = resolve(scaffold.targetPath);
  const escaped = relative(root, target);
  if (escaped.length === 0 || escaped === ".." || escaped.startsWith(`..${sep}`) || isAbsolute(escaped)) {
    throw new FreshPreviewError("ERR_FRESH_PREVIEW_PATH", "Fresh preview target must remain inside its generated output root.", { targetPath: target });
  }
  return Promise.all([realpath(root), realpath(target)]).then(([rootReal, targetReal]) => {
    const realEscaped = relative(rootReal, targetReal);
    if (realEscaped.length === 0 || realEscaped === ".." || realEscaped.startsWith(`..${sep}`) || isAbsolute(realEscaped)) {
      throw new FreshPreviewError("ERR_FRESH_PREVIEW_PATH", "Fresh preview target resolved outside its generated output root.", { targetPath: targetReal });
    }
    return targetReal;
  });
}

function makeTarget(root: string, port: number): PreviewTargetV1 {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new FreshPreviewError("ERR_FRESH_PREVIEW_PATH", "Fresh preview port is invalid.", { port });
  }
  return previewTargetV1Schema.parse({
    schemaVersion: "1",
    packageManager: "npm",
    command: {
      executable: "npm",
      args: ["run", "dev", "--", "--host", PREVIEW_HOST, "--port", String(port)],
      scriptName: "dev",
    },
    cwdIdentity: root,
    expectedHost: PREVIEW_HOST,
    assignedPort: port,
    startupTimeoutMs: STARTUP_TIMEOUT_MS,
    readinessUrl: `http://${PREVIEW_HOST}:${port}/`,
    environmentAllowList: [],
    shutdownPolicy: "always",
  });
}

function cancelled(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw new FreshPreviewError("ERR_FRESH_PREVIEW_CANCELLED", "Fresh preview was cancelled.");
  }
}

function validateViewport(evidence: FreshFrameEvidence): { readonly width: number; readonly height: number } {
  const { width, height } = evidence.frame;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096 || width * height > MAX_IMAGE_PIXELS) {
    throw new FreshPreviewError("ERR_FRESH_PREVIEW_SCREENSHOT_FAILED", "Fresh preview dimensions are outside the bounded browser viewport contract.", { width, height });
  }
  return { width, height };
}

function classifyRuntimeFailure(error: unknown): FreshPreviewError {
  if (error instanceof FreshPreviewError) return error;
  if (error instanceof RendererUnavailableError) {
    return new FreshPreviewError("ERR_FRESH_PREVIEW_SCREENSHOT_FAILED", error.message);
  }
  return new FreshPreviewError(
    "ERR_FRESH_PREVIEW_NAVIGATION_FAILED",
    error instanceof Error ? error.message : "Fresh preview browser navigation failed.",
  );
}

function verifyFinalUrl(target: PreviewTargetV1, finalUrl: string | undefined): URL {
  if (finalUrl === undefined) {
    throw new FreshPreviewError("ERR_FRESH_PREVIEW_NAVIGATION_FAILED", "Fresh preview did not report its final browser URL.");
  }
  let expected: URL;
  let actual: URL;
  try {
    expected = new URL(target.readinessUrl);
    actual = new URL(finalUrl);
  } catch {
    throw new FreshPreviewError("ERR_FRESH_PREVIEW_NAVIGATION_FAILED", "Fresh preview returned an invalid browser URL.");
  }
  const pathname = actual.pathname === "" ? "/" : actual.pathname;
  if (actual.origin !== expected.origin || pathname !== "/") {
    throw new FreshPreviewError(
      "ERR_FRESH_PREVIEW_UNEXPECTED_PATH",
      "Fresh preview navigation left the expected local root path.",
      { expectedOrigin: expected.origin, expectedPathname: "/", actualOrigin: actual.origin, actualPathname: pathname },
    );
  }
  return actual;
}

export async function captureFreshUiPreview(
  request: FreshPreviewRequest,
  dependencies: FreshPreviewDependencies = {},
): Promise<FreshPreviewResult> {
  const signal = request.signal ?? new AbortController().signal;
  cancelled(signal);
  const viewport = validateViewport(request.evidence);
  const root = await assertInsideFreshProject(request.scaffold);
  const port = await (dependencies.choosePort ?? defaultPort)();
  const target = makeTarget(root, port);
  const runtime = (dependencies.createRuntime ?? defaultRuntime)();
  const startedAt = new Date().toISOString();
  const started = Date.now();
  let processRecord: PreviewRuntimeRecord | undefined;
  try {
    processRecord = await runtime.start(target, root, signal);
    cancelled(signal);
    if (processRecord.status === "failed") {
      throw new FreshPreviewError("ERR_FRESH_PREVIEW_PROCESS_FAILED", "Fresh preview process exited before readiness.", { stderr: processRecord.stderr });
    }
    if (processRecord.status !== "ready") {
      throw new FreshPreviewError("ERR_FRESH_PREVIEW_READINESS_TIMEOUT", "Fresh preview did not become ready before startup timeout.", { stderr: processRecord.stderr });
    }

    const renderer = await (dependencies.loadRenderer ?? loadOptionalPlaywrightRenderer)();
    if (renderer === undefined) {
      throw new FreshPreviewError("ERR_FRESH_PREVIEW_SCREENSHOT_FAILED", "Playwright/Chromium is unavailable for Fresh preview capture.");
    }
    try {
      const capture = await renderer.capture(
        target.readinessUrl,
        { id: "fresh-frame", width: viewport.width, height: viewport.height },
        { fullPage: false, waitForFontsMs: 250, timeoutMs: CAPTURE_TIMEOUT_MS, maxImageBytes: MAX_IMAGE_BYTES, maxImagePixels: MAX_IMAGE_PIXELS, allowedOrigin: new URL(target.readinessUrl).origin },
        signal,
      );
      cancelled(signal);
      const finalUrl = verifyFinalUrl(target, capture.finalUrl);
      const width = viewport.width;
      const height = viewport.height;
      if (capture.width !== width || capture.height !== height) {
        throw new FreshPreviewError("ERR_FRESH_PREVIEW_SCREENSHOT_FAILED", "Fresh preview screenshot dimensions do not match authoritative Figma dimensions.", { expectedWidth: width, expectedHeight: height, actualWidth: capture.width, actualHeight: capture.height });
      }
      const runtimeErrors = capture.runtimeErrors ?? [];
      if (runtimeErrors.length > 0) {
        throw new FreshPreviewError("ERR_FRESH_PREVIEW_RUNTIME_ERROR", "Fresh preview page reported runtime errors.", { errors: runtimeErrors });
      }
      return {
        previewUrl: target.readinessUrl,
        finalPathname: finalUrl.pathname === "" ? "/" : finalUrl.pathname,
        viewport: { width, height },
        screenshot: { mimeType: "image/png", bytes: capture.bytes, width: capture.width, height: capture.height },
        diagnostics: {
          ...(capture.dom === undefined ? {} : { dom: capture.dom }),
          consoleErrors: capture.consoleErrors,
          runtimeErrors,
          failedResources: capture.failedResources,
          warnings: capture.warnings,
        },
        provenance: {
          startedAt,
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - started,
          previewProcess: processRecord,
        },
      };
    } finally {
      await renderer.close();
    }
  } catch (error) {
    if (signal.aborted) throw new FreshPreviewError("ERR_FRESH_PREVIEW_CANCELLED", "Fresh preview was cancelled.");
    throw classifyRuntimeFailure(error);
  } finally {
    await runtime.close();
  }
}
