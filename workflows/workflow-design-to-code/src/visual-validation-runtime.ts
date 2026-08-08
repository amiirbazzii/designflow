import { createHash, randomInt } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { inflateSync } from "node:zlib";
import {
  previewTargetV1Schema,
  safePreviewCommandV1Schema,
  screenshotEvidenceV1Schema,
  type PreviewTargetV1,
  type ScreenshotEvidenceV1,
  type SafePreviewCommandV1,
  type VisualViewportV1,
  type Stage4ProjectImplementationContext,
} from "@designflow/sdk";

const MAX_OUTPUT = 100_000;

export const DEFAULT_VISUAL_VIEWPORTS: readonly VisualViewportV1[] = [
  { id: "desktop", width: 1440, height: 1024 },
  { id: "tablet", width: 768, height: 1024 },
  { id: "mobile", width: 390, height: 844 },
];

export interface PreviewRuntimeRecord {
  readonly status: "ready" | "unavailable" | "failed";
  readonly target?: PreviewTargetV1;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly exitCode?: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly warnings: readonly string[];
}

export interface BrowserCapture {
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly consoleErrors: readonly string[];
  readonly failedResources: readonly string[];
  readonly warnings: readonly string[];
  readonly dom?: DomEvidence;
}

export interface DomElementEvidence {
  readonly selector: string;
  readonly text?: string;
  readonly display?: string;
  readonly visibility?: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly color?: string;
  readonly backgroundColor?: string;
  readonly fontSize?: string;
  readonly fontWeight?: string;
  readonly lineHeight?: string;
  readonly borderRadius?: string;
  readonly overflow?: string;
  readonly alignItems?: string;
  readonly justifyContent?: string;
  readonly gap?: string;
  readonly padding?: string;
  readonly margin?: string;
}

export interface DomEvidence {
  readonly elements: readonly DomElementEvidence[];
  readonly overflow: readonly string[];
}

export interface BrowserRenderer {
  capture(url: string, viewport: VisualViewportV1, options: { fullPage: boolean; waitForFontsMs: number; timeoutMs: number; maxImageBytes: number; maxImagePixels: number }, signal: AbortSignal): Promise<BrowserCapture>;
  close(): Promise<void>;
}

export type CaptureProgressCallback = (
  viewport: VisualViewportV1,
  capture: BrowserCapture,
) => Promise<boolean>;

export interface SpatialComparison {
  readonly algorithmVersion: "png-rgba-pixel-diff-v1";
  readonly threshold: number;
  readonly mismatchRatioThreshold: number;
  readonly mismatchRatio: number;
  readonly identical: boolean;
  readonly dimensionCompatible: boolean;
  readonly referenceWidth: number;
  readonly referenceHeight: number;
  readonly implementationWidth: number;
  readonly implementationHeight: number;
  readonly changedPixelCount: number;
  readonly changedRegion?: { x: number; y: number; width: number; height: number };
  /**
   * The common top-left-aligned region both images cover. The pixel diff has
   * always run over this region; these fields make its extent and its own
   * mismatch ratio explicit so a dimension mismatch no longer hides what the
   * comparable content actually showed.
   */
  readonly overlapWidth: number;
  readonly overlapHeight: number;
  /** Overlap area divided by the larger image's area, in [0, 1]. */
  readonly overlapCoverage: number;
  readonly overlapChangedPixelCount: number;
  /** Changed pixels within the overlap divided by the overlap area. */
  readonly overlapMismatchRatio: number;
  /** Always true when both PNGs decoded — content comparison is never skipped for size. */
  readonly pixelDiffExecuted: boolean;
}

export class RendererUnavailableError extends Error {
  public constructor(message = "The Playwright browser renderer is unavailable.") {
    super(message);
    this.name = "RendererUnavailableError";
  }
}

function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DEFAULT_PIXEL_THRESHOLD = 8;
const DEFAULT_MISMATCH_RATIO_THRESHOLD = 0.005;
const DEFAULT_MAX_IMAGE_BYTES = 10_000_000;
const DEFAULT_MAX_IMAGE_PIXELS = 8_000_000;

interface DecodedPng {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 24) | ((bytes[offset + 1] ?? 0) << 16) | ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0);
}

function pngBytes(bytes: Uint8Array, maxBytes = DEFAULT_MAX_IMAGE_BYTES): Uint8Array {
  if (bytes.byteLength > maxBytes || bytes.byteLength < PNG_SIGNATURE.byteLength) throw new RendererUnavailableError("PNG exceeded the configured image byte limit or is truncated.");
  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) if (bytes[index] !== PNG_SIGNATURE[index]) throw new RendererUnavailableError("Visual evidence is not a PNG image.");
  return bytes;
}

function decodePng(bytes: Uint8Array, maxBytes = DEFAULT_MAX_IMAGE_BYTES, maxPixels = DEFAULT_MAX_IMAGE_PIXELS): DecodedPng {
  const input = pngBytes(bytes, maxBytes);
  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat: Uint8Array[] = [];
  while (offset + 12 <= input.length) {
    const length = readUint32(input, offset) >>> 0;
    const type = String.fromCharCode(...input.subarray(offset + 4, offset + 8));
    const start = offset + 8;
    const end = start + length;
    if (length > input.length || end + 4 > input.length) throw new RendererUnavailableError("PNG chunk exceeded the configured bounds.");
    if (type === "IHDR") {
      width = readUint32(input, start) >>> 0;
      height = readUint32(input, start + 4) >>> 0;
      const bitDepth = input[start + 8] ?? 0;
      colorType = input[start + 9] ?? 0;
      if (width === 0 || height === 0 || width * height > maxPixels) throw new RendererUnavailableError("PNG exceeded the configured pixel limit.");
      if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) throw new RendererUnavailableError("Only bounded 8-bit RGB/RGBA PNG evidence is supported.");
    } else if (type === "IDAT") {
      idat.push(input.slice(start, end));
    } else if (type === "IEND") {
      break;
    }
    offset = end + 4;
  }
  if (width === 0 || height === 0 || idat.length === 0) throw new RendererUnavailableError("PNG evidence has no usable image data.");
  const compressedLength = idat.reduce((total, chunk) => total + chunk.byteLength, 0);
  const compressed = new Uint8Array(compressedLength);
  let compressedOffset = 0;
  for (const chunk of idat) { compressed.set(chunk, compressedOffset); compressedOffset += chunk.byteLength; }
  const raw = new Uint8Array(inflateSync(compressed));
  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const sourceStride = width * bytesPerPixel;
  if (raw.length !== (sourceStride + 1) * height) throw new RendererUnavailableError("PNG scanline data did not match its declared dimensions.");
  const rgba = new Uint8Array(width * height * 4);
  const previous = new Uint8Array(sourceStride);
  let sourceOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[sourceOffset++] ?? 0;
    const row = raw.subarray(sourceOffset, sourceOffset + sourceStride);
    sourceOffset += sourceStride;
    const decoded = new Uint8Array(sourceStride);
    for (let x = 0; x < sourceStride; x += 1) {
      const left = x >= bytesPerPixel ? decoded[x - bytesPerPixel] ?? 0 : 0;
      const above = previous[x] ?? 0;
      const upperLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] ?? 0 : 0;
      const value = row[x] ?? 0;
      decoded[x] = filter === 0 ? value : filter === 1 ? (value + left) & 255 : filter === 2 ? (value + above) & 255 : filter === 3 ? (value + Math.floor((left + above) / 2)) & 255 : filter === 4 ? (value + (left + above - upperLeft)) & 255 : value;
    }
    const output = rgba.subarray(y * width * 4, (y + 1) * width * 4);
    for (let x = 0; x < width; x += 1) {
      output[x * 4] = decoded[x * bytesPerPixel] ?? 0;
      output[x * 4 + 1] = decoded[x * bytesPerPixel + 1] ?? 0;
      output[x * 4 + 2] = decoded[x * bytesPerPixel + 2] ?? 0;
      output[x * 4 + 3] = colorType === 6 ? decoded[x * bytesPerPixel + 3] ?? 255 : 255;
    }
    previous.set(decoded);
  }
  return { width, height, rgba };
}

export function comparePngImages(reference: Uint8Array, implementation: Uint8Array, options: { threshold?: number; mismatchRatioThreshold?: number; maxImageBytes?: number; maxImagePixels?: number } = {}): SpatialComparison {
  const threshold = options.threshold ?? DEFAULT_PIXEL_THRESHOLD;
  const mismatchRatioThreshold = options.mismatchRatioThreshold ?? DEFAULT_MISMATCH_RATIO_THRESHOLD;
  const referenceImage = decodePng(reference, options.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES, options.maxImagePixels ?? DEFAULT_MAX_IMAGE_PIXELS);
  const implementationImage = decodePng(implementation, options.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES, options.maxImagePixels ?? DEFAULT_MAX_IMAGE_PIXELS);
  const dimensionCompatible = referenceImage.width === implementationImage.width && referenceImage.height === implementationImage.height;
  const width = Math.min(referenceImage.width, implementationImage.width);
  const height = Math.min(referenceImage.height, implementationImage.height);
  const comparedPixels = Math.max(referenceImage.width * referenceImage.height, implementationImage.width * implementationImage.height);
  let overlapChangedPixelCount = 0;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const referenceOffset = (y * referenceImage.width + x) * 4;
    const implementationOffset = (y * implementationImage.width + x) * 4;
    let different = false;
    for (let channel = 0; channel < 4; channel += 1) if (Math.abs((referenceImage.rgba[referenceOffset + channel] ?? 0) - (implementationImage.rgba[implementationOffset + channel] ?? 0)) > threshold) different = true;
    if (different) {
      overlapChangedPixelCount += 1;
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
  }
  const changedPixelCount = overlapChangedPixelCount + Math.abs(referenceImage.width * referenceImage.height - implementationImage.width * implementationImage.height);
  const mismatchRatio = Math.min(1, changedPixelCount / comparedPixels);
  const overlapArea = width * height;
  return {
    algorithmVersion: "png-rgba-pixel-diff-v1",
    threshold,
    mismatchRatioThreshold,
    mismatchRatio,
    identical: dimensionCompatible && changedPixelCount === 0,
    dimensionCompatible,
    referenceWidth: referenceImage.width,
    referenceHeight: referenceImage.height,
    implementationWidth: implementationImage.width,
    implementationHeight: implementationImage.height,
    changedPixelCount,
    ...(maxX >= 0 ? { changedRegion: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } } : {}),
    overlapWidth: width,
    overlapHeight: height,
    overlapCoverage: comparedPixels === 0 ? 0 : overlapArea / comparedPixels,
    overlapChangedPixelCount,
    overlapMismatchRatio: overlapArea === 0 ? 0 : overlapChangedPixelCount / overlapArea,
    pixelDiffExecuted: true,
  };
}

function redact(value: string): string {
  return value.replace(/([A-Za-z0-9_-]*(?:token|secret|password|credential)[A-Za-z0-9_-]*\s*[=:]\s*)[^\s\n]+/gi, "$1[REDACTED]").slice(-MAX_OUTPUT);
}

function packageArgs(manager: "npm" | "bun" | "pnpm" | "yarn", script: string, port: number): string[] {
  const suffix = ["--host", "127.0.0.1", "--port", String(port)];
  return manager === "yarn" ? [script, ...suffix] : ["run", script, "--", ...suffix];
}

export function discoverPreviewCommand(context: Stage4ProjectImplementationContext): SafePreviewCommandV1 | undefined {
  const command = context.commands.preview;
  if (command === undefined) return undefined;
  return safePreviewCommandV1Schema.parse({
    executable: context.runtime.packageManager,
    args: packageArgs(context.runtime.packageManager as "npm" | "bun" | "pnpm" | "yarn", command.scriptName ?? command.name, 0),
    scriptName: command.scriptName ?? command.name,
  });
}

async function ephemeralPort(): Promise<number> {
  // The preview process owns the actual bind and is forced to 127.0.0.1.
  // Selecting from the IANA dynamic range avoids opening a listener merely to
  // reserve a port, which is unreliable in restricted CLI environments.
  return randomInt(49_152, 65_535);
}

export async function makePreviewTarget(
  context: Stage4ProjectImplementationContext,
  readinessPath = "/",
  startupTimeoutMs = 30_000,
): Promise<PreviewTargetV1 | undefined> {
  const discovered = discoverPreviewCommand(context);
  if (discovered === undefined) return undefined;
  const port = await ephemeralPort();
  const args = discovered.args.map((arg) => arg === "0" ? String(port) : arg);
  return previewTargetV1Schema.parse({
    schemaVersion: "1",
    packageManager: context.runtime.packageManager,
    command: { ...discovered, args },
    cwdIdentity: context.project.rootIdentity,
    expectedHost: "127.0.0.1",
    assignedPort: port,
    startupTimeoutMs,
    readinessUrl: `http://127.0.0.1:${port}${readinessPath}`,
    environmentAllowList: [],
    shutdownPolicy: "always",
  });
}

function boundedAppend(current: string, chunk: Buffer): string {
  return redact(`${current}${chunk.toString("utf8")}`);
}

export class PreviewRuntime {
  private child: ChildProcess | undefined;
  private stdout = "";
  private stderr = "";

  public async start(target: PreviewTargetV1, root: string, signal: AbortSignal): Promise<PreviewRuntimeRecord> {
    const startedAt = new Date().toISOString();
    const started = Date.now();
    const env: NodeJS.ProcessEnv = { NODE_ENV: "development", ...(process.env.PATH !== undefined ? { PATH: process.env.PATH } : {}) };
    for (const name of target.environmentAllowList) {
      const value = process.env[name];
      if (value !== undefined && !/token|secret|password|credential|key/i.test(name)) env[name] = value;
    }
    const child = spawn(target.command.executable, target.command.args, {
      cwd: root,
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;
    child.stdout?.on("data", (chunk: Buffer) => { this.stdout = boundedAppend(this.stdout, chunk); });
    child.stderr?.on("data", (chunk: Buffer) => { this.stderr = boundedAppend(this.stderr, chunk); });
    let exitCode: number | undefined;
    let exited = false;
    child.once("error", (error) => { exited = true; this.stderr = boundedAppend(this.stderr, Buffer.from(error instanceof Error ? error.message : "preview process error")); });
    child.once("close", (code) => { exited = true; exitCode = code ?? 1; });
    const abort = (): void => { this.child?.kill(); };
    signal.addEventListener("abort", abort, { once: true });
    try {
      while (Date.now() - started < target.startupTimeoutMs) {
        if (exited) break;
        try {
          const response = await fetch(target.readinessUrl, { signal: AbortSignal.timeout(500) });
          if (response.ok) {
            return { status: "ready", target, startedAt, endedAt: new Date().toISOString(), stdout: this.stdout, stderr: this.stderr, warnings: [] };
          }
        } catch { /* the server is still starting */ }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const record: PreviewRuntimeRecord = {
        status: exited ? "failed" : "unavailable",
        target,
        startedAt,
        endedAt: new Date().toISOString(),
        ...(exitCode !== undefined ? { exitCode } : {}),
        stdout: this.stdout,
        stderr: this.stderr,
        warnings: [exited ? "The preview process exited before readiness." : "The preview server did not become ready before the startup timeout."],
      };
      await this.close();
      return record;
    } catch (error) {
      signal.removeEventListener("abort", abort);
      await this.close();
      throw error;
    }
  }

  public async close(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    if (child === undefined || child.exitCode !== null) return;
    child.kill();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 1_000);
      child.once("close", () => { clearTimeout(timer); resolve(); });
    });
  }
}

export async function loadOptionalPlaywrightRenderer(): Promise<BrowserRenderer | undefined> {
  // Playwright is intentionally optional: the installed CLI stays portable
  // and reports renderer_unavailable when the browser package is not present.
  const dynamicImport = Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;
  let loaded: unknown;
  let resolved: string;
  try { resolved = createRequire(import.meta.url).resolve("playwright"); } catch { return undefined; }
  try { loaded = await dynamicImport(resolved); } catch { return undefined; }
  if (typeof loaded !== "object" || loaded === null) return undefined;
  const moduleValue = loaded as Record<string, unknown> & { default?: Record<string, unknown> };
  const chromium = moduleValue.chromium ?? moduleValue.default?.chromium;
  if (typeof chromium !== "object" || chromium === null) return undefined;
  const launch = (chromium as { launch?: (options: { headless: boolean }) => Promise<unknown> }).launch;
  if (launch === undefined) return undefined;
  try {
    return createPlaywrightRenderer(await launch.call(chromium, { headless: true }));
  } catch {
    // A package can be installed without its Chromium payload. Keep this
    // boundary honest: callers must report unavailable, never pass.
    return undefined;
  }
}

function createPlaywrightRenderer(browser: unknown): BrowserRenderer {
  const value = browser as { newContext?: (options: Record<string, unknown>) => Promise<unknown>; close?: () => Promise<void> };
  return {
    async capture(url, viewport, options, signal): Promise<BrowserCapture> {
      if (signal.aborted) throw new RendererUnavailableError("Visual capture was cancelled.");
      const context = await value.newContext?.({ viewport: { width: viewport.width, height: viewport.height }, serviceWorkers: "block" });
      if (context === undefined) throw new RendererUnavailableError("Playwright could not create an isolated browser context.");
      const page = await (context as { newPage: () => Promise<unknown> }).newPage();
      try {
        const pageValue = page as {
          on?: (event: "console" | "requestfailed", listener: (value: unknown) => void) => void;
          goto: (target: string, options: { waitUntil: string; timeout: number }) => Promise<unknown>;
          evaluate: (expression: string) => Promise<unknown>;
          screenshot: (options: { fullPage: boolean; type: "png" }) => Promise<Uint8Array>;
          close?: () => Promise<void>;
        };
        const consoleErrors: string[] = [];
        const failedResources: string[] = [];
        pageValue.on?.("console", (value) => {
          const consoleValue = value as { type?: () => string; text?: () => string };
          if (consoleValue.type?.() === "error") consoleErrors.push((consoleValue.text?.() ?? "console error").slice(0, 500));
        });
        pageValue.on?.("requestfailed", (value) => {
          const request = value as { url?: () => string };
          const url = request.url?.();
          if (url !== undefined) failedResources.push(url.slice(0, 500));
        });
        await pageValue.goto(url, { waitUntil: "networkidle", timeout: options.timeoutMs });
        await pageValue.evaluate(`document.fonts?.ready`);
        if (options.waitForFontsMs > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(options.waitForFontsMs, 250)));
        const bytes = await pageValue.screenshot({ fullPage: options.fullPage, type: "png" });
        if (bytes.byteLength > options.maxImageBytes || viewport.width * viewport.height > options.maxImagePixels) throw new RendererUnavailableError("Screenshot exceeded configured limits.");
        const dom = await pageValue.evaluate(`(() => {
          const elements = Array.from(document.querySelectorAll('[data-designflow-evidence], [data-designflow-element]')).slice(0, 64).map((element) => {
            const node = element;
            const rect = node.getBoundingClientRect();
            const styles = getComputedStyle(node);
            return {
              selector: node.getAttribute('data-designflow-evidence') || node.getAttribute('data-designflow-element') || node.tagName.toLowerCase(),
              text: (node.textContent || '').trim().slice(0, 1000),
              display: styles.display,
              visibility: styles.visibility,
              x: rect.x, y: rect.y, width: rect.width, height: rect.height,
              color: styles.color, backgroundColor: styles.backgroundColor,
              fontSize: styles.fontSize, fontWeight: styles.fontWeight, lineHeight: styles.lineHeight,
              borderRadius: styles.borderRadius, overflow: styles.overflow,
              alignItems: styles.alignItems, justifyContent: styles.justifyContent, gap: styles.gap,
              padding: styles.padding, margin: styles.margin,
            };
          });
          const overflow = Array.from(document.querySelectorAll('*')).filter((node) => {
            const rect = node.getBoundingClientRect();
            return rect.right > window.innerWidth + 1 || rect.bottom > window.innerHeight + 1 || rect.left < -1 || rect.top < -1;
          }).slice(0, 64).map((node) => node.tagName.toLowerCase());
          return { elements, overflow };
        })()`);
        const decoded = decodePng(bytes, options.maxImageBytes, options.maxImagePixels);
        return { bytes, width: decoded.width, height: decoded.height, consoleErrors, failedResources, warnings: ["browser context: isolated", "source: browser-rendered"], dom: dom as DomEvidence };
      } finally {
        await pageValueClose(page);
        await (context as { close: () => Promise<void> }).close();
      }
    },
    async close(): Promise<void> { await value.close?.(); },
  };
}

async function pageValueClose(page: unknown): Promise<void> {
  const close = (page as { close?: () => Promise<void> }).close;
  if (close !== undefined) await close.call(page);
}

export async function storeImplementationEvidence(
  store: { save(data: unknown, metadata?: Record<string, unknown>): Promise<{ id: string }> },
  captures: readonly { viewport: VisualViewportV1; capture: BrowserCapture }[],
): Promise<ScreenshotEvidenceV1[]> {
  const evidence: ScreenshotEvidenceV1[] = [];
  for (const item of captures) {
    const payload = Buffer.from(item.capture.bytes).toString("base64");
    const stored = await store.save(payload, { type: "visual-validation.screenshot", sourceType: "implementation", viewport: item.viewport.id });
    evidence.push(screenshotEvidenceV1Schema.parse({
      schemaVersion: "1",
      evidenceId: `implementation-${item.viewport.id}`,
      sourceType: "implementation",
      frame: {},
      viewport: item.viewport,
      image: { width: item.capture.width, height: item.capture.height, contentHash: hashBytes(item.capture.bytes), artifactId: stored.id },
      capturedAt: new Date().toISOString(),
      captureMethod: "browser",
      warnings: [...item.capture.warnings, ...item.capture.consoleErrors.map((error) => `console: ${error}`), ...item.capture.failedResources.map((url) => `resource failed: ${url}`)],
      authenticity: "browser-rendered",
      sourceLabel: "browser-rendered",
    }));
  }
  return evidence;
}

export async function captureWithPreview(
  root: string,
  target: PreviewTargetV1,
  renderer: BrowserRenderer,
  viewports: readonly VisualViewportV1[],
  options: { fullPage: boolean; waitForFontsMs: number; timeoutMs: number; maxImageBytes: number; maxImagePixels: number; initialCaptures?: readonly { viewport: VisualViewportV1; capture: BrowserCapture }[]; onPreviewReady?: () => Promise<boolean>; onCapture?: CaptureProgressCallback },
  signal: AbortSignal,
): Promise<{ runtime: PreviewRuntimeRecord; captures: readonly { viewport: VisualViewportV1; capture: BrowserCapture }[] }> {
  const runtime = new PreviewRuntime();
  const record = await runtime.start(target, root, signal);
  if (record.status !== "ready") {
    await renderer.close();
    return { runtime: record, captures: [] };
  }
  try {
    const captures: { viewport: VisualViewportV1; capture: BrowserCapture }[] = [...(options.initialCaptures ?? [])];
    if (await options.onPreviewReady?.())
      return { runtime: { ...record, endedAt: new Date().toISOString() }, captures };
    const completed = new Set(captures.map((item) => item.viewport.id));
    for (const viewport of viewports) {
      if (completed.has(viewport.id)) continue;
      const capture = await renderer.capture(target.readinessUrl, viewport, options, signal);
      captures.push({ viewport, capture });
      completed.add(viewport.id);
      if (await options.onCapture?.(viewport, capture)) break;
    }
    return { runtime: { ...record, endedAt: new Date().toISOString() }, captures };
  } finally {
    await renderer.close();
    await runtime.close();
  }
}

export function compareScreenshotBytes(reference: Uint8Array, implementation: Uint8Array): { mismatchRatio: number; identical: boolean } {
  if (reference.byteLength === 0 && implementation.byteLength === 0) return { mismatchRatio: 0, identical: true };
  try {
    const comparison = comparePngImages(reference, implementation);
    return { mismatchRatio: comparison.mismatchRatio, identical: comparison.identical };
  } catch {
    const length = Math.max(reference.byteLength, implementation.byteLength);
    let different = Math.abs(reference.byteLength - implementation.byteLength);
    const overlap = Math.min(reference.byteLength, implementation.byteLength);
    for (let index = 0; index < overlap; index += 1) if (reference[index] !== implementation[index]) different += 1;
    return { mismatchRatio: length === 0 ? 0 : different / length, identical: different === 0 };
  }
}
