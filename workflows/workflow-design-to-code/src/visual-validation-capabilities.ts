import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  DesignFlowError,
  designSpecificationSchema,
  figmaSourceProvenanceSchema,
  figmaSourceSnapshotSchema,
  projectImplementationContextV1Schema,
  generatedImplementationV1Schema,
  visualValidationInputV1Schema,
  visualValidationReportV1Schema,
  visualValidationAgentOutputV1Schema,
  visualFindingV1Schema,
  type Capability,
  type CapabilityContext,
  type Stage4ProjectImplementationContext,
  type ScreenshotEvidenceV1,
  type VisualFindingV1,
  type VisualViewportV1,
  stage6FailpointEnabled,
  terminateAtStage6Failpoint,
} from "@designflow/sdk";
import { readArtifact, writeArtifact } from "./artifact-io";
import { captureWithPreview, comparePngImages, discoverPreviewCommand, loadOptionalPlaywrightRenderer, makePreviewTarget, storeImplementationEvidence, type PreviewRuntimeRecord, type BrowserRenderer, type SpatialComparison, type BrowserCapture } from "./visual-validation-runtime";
import { VISUAL_VALIDATION_ARTIFACT_IDS, VISUAL_VALIDATION_ARTIFACT_TYPES, domEvidenceCollectionSchema, previewRuntimeRecordSchema, screenshotEvidenceCollectionSchema, visualComparisonMetricsSchema, visualValidationSummarySchema, visualValidationWorkflowInputSchema, type VisualValidationReport } from "./visual-validation-types";

const outputSchema = z.object({ artifactRef: z.object({ id: z.string(), type: z.string(), metadata: z.record(z.unknown()) }).strict() }).strict();
type CapabilityOutput = z.infer<typeof outputSchema>;

type PersistedCapture = {
  viewport: VisualViewportV1;
  capture: Omit<BrowserCapture, "bytes"> & { bytes: string };
  payloadId?: string;
};

function captureProgressPath(stateDirectory: string, executionId: string): string {
  const safeId = executionId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 160);
  const directory = join(stateDirectory, "stage6-capture-progress");
  mkdirSync(directory, { recursive: true });
  return join(directory, `${safeId}.json`);
}

function readCaptureProgress(path: string, executionId: string): PersistedCapture[] {
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, "utf8");
    if (raw.length > 20_000_000) return [];
    const value = JSON.parse(raw) as { executionId?: unknown; captures?: unknown };
    if (value.executionId !== executionId || !Array.isArray(value.captures)) return [];
    return value.captures.filter((item): item is PersistedCapture => {
      if (typeof item !== "object" || item === null) return false;
      const candidate = item as Record<string, unknown>;
      const viewport = candidate.viewport;
      const capture = candidate.capture;
      return typeof candidate.payloadId === "string" &&
        typeof viewport === "object" && viewport !== null &&
        typeof capture === "object" && capture !== null &&
        typeof (capture as Record<string, unknown>).bytes === "string";
    });
  } catch {
    return [];
  }
}

function writeCaptureProgress(path: string, executionId: string, captures: readonly PersistedCapture[]): void {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, JSON.stringify({ schemaVersion: "1", executionId, captures }), "utf8");
  renameSync(temporary, path);
}

function restoreCaptures(captures: readonly PersistedCapture[]): { viewport: PersistedCapture["viewport"]; capture: BrowserCapture }[] {
  return captures.map((item) => ({
    viewport: item.viewport,
    capture: { ...item.capture, bytes: new Uint8Array(Buffer.from(item.capture.bytes, "base64")) },
  }));
}

function captureFailpoint(viewportId: string): "after_desktop_capture" | "after_tablet_capture" | "after_mobile_capture" | undefined {
  if (viewportId === "desktop") return "after_desktop_capture";
  if (viewportId === "tablet") return "after_tablet_capture";
  if (viewportId === "mobile") return "after_mobile_capture";
  return undefined;
}

function requiredAgentInvoker(context: CapabilityContext) {
  if (context.agents === undefined) throw new DesignFlowError("ERR_AGENT_INVOCATION_UNAVAILABLE", "Visual Validation Agent invocation is unavailable.", { capabilityId: context.capabilityId });
  return context.agents;
}

function hash(value: Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }

export const prepareVisualValidationCapability: Capability<unknown, CapabilityOutput> = {
  id: "prepare-visual-validation", name: "Prepare visual validation", description: "Binds visual validation to the approved implementation, current project identity, and requested viewports.", type: "pure", version: "1", inputSchema: visualValidationWorkflowInputSchema, outputSchema,
  async execute(context, raw): Promise<CapabilityOutput> {
    const requested = visualValidationWorkflowInputSchema.parse(raw);
    const project = await readArtifact(context, "project-implementation-context", projectImplementationContextV1Schema);
    const stage4Project = project as Stage4ProjectImplementationContext;
    const generated = await readArtifact(context, "generated-implementation", generatedImplementationV1Schema);
    const spec = await readArtifact(context, "design-specification", designSpecificationSchema);
    const previewCommand = discoverPreviewCommand(stage4Project);
    const input = visualValidationInputV1Schema.parse({
      schemaVersion: "1", executionId: context.executionId, workflowId: context.workflowId,
      project: { id: project.project.id, rootIdentity: project.project.rootIdentity, contextFingerprint: project.project.contextFingerprint },
      generatedImplementationArtifactId: "generated-implementation", designSpecificationArtifactId: "design-specification", figmaSourceSnapshotArtifactId: "figma-source-snapshot",
      requestedFrames: requested.frames.length > 0 ? requested.frames : spec.frames, framework: project.runtime.framework,
      preview: { ...(previewCommand !== undefined ? { command: previewCommand } : {}), readinessPath: requested.readinessPath }, viewports: requested.viewports, capture: requested.capture,
      agentVersion: requested.agentVersion, ...(requested.modelProfileId !== undefined ? { modelProfileId: requested.modelProfileId } : {}),
    });
    return writeArtifact(context, { artifactId: VISUAL_VALIDATION_ARTIFACT_IDS.input, artifactType: VISUAL_VALIDATION_ARTIFACT_TYPES.input, name: "Visual Validation Input", payload: input, summary: { projectId: input.project.id, generatedImplementationArtifactId: generated.projectId, designSpecificationArtifactId: input.designSpecificationArtifactId, frameCount: input.requestedFrames.length, viewportCount: input.viewports.length, projectFilesChanged: false } });
  },
};

function runtimePayload(record: PreviewRuntimeRecord): unknown {
  return previewRuntimeRecordSchema.parse({ schemaVersion: "1", status: record.status, ...(record.target !== undefined ? { target: record.target } : {}), startedAt: record.startedAt, endedAt: record.endedAt, ...(record.exitCode !== undefined ? { exitCode: record.exitCode } : {}), stdout: record.stdout, stderr: record.stderr, warnings: record.warnings });
}

async function safePreviewTarget(
  project: Stage4ProjectImplementationContext,
  readinessPath: string,
  startupTimeoutMs?: number,
): Promise<{ target?: Awaited<ReturnType<typeof makePreviewTarget>>; warnings: string[] }> {
  try {
    return { target: await makePreviewTarget(project, readinessPath, startupTimeoutMs), warnings: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Preview target validation failed.";
    return { warnings: [`preview_target_unavailable: ${message}`] };
  }
}

export const startPreviewServerCapability: Capability<unknown, CapabilityOutput> = {
  id: "start-preview-server", name: "Start preview server", description: "Resolves a safe project-declared preview command and an ephemeral localhost target.", type: "pure", version: "1", inputSchema: z.unknown(), outputSchema,
  async execute(context, raw): Promise<CapabilityOutput> {
    const requested = visualValidationWorkflowInputSchema.parse(raw);
    const project = await readArtifact(context, "project-implementation-context", projectImplementationContextV1Schema);
    const prepared = await safePreviewTarget(project as Stage4ProjectImplementationContext, requested.readinessPath);
    const target = prepared.target;
    const now = new Date().toISOString();
    const record = target === undefined
      ? { status: "unavailable" as const, startedAt: now, endedAt: now, stdout: "", stderr: "", warnings: [...prepared.warnings, "No safe project-declared preview script was found."] }
      : { status: "unavailable" as const, target, startedAt: now, endedAt: now, stdout: "", stderr: "", warnings: [...prepared.warnings, "Preview target prepared; lifecycle runs within screenshot capture."] };
    return writeArtifact(context, { artifactId: VISUAL_VALIDATION_ARTIFACT_IDS.preview, artifactType: VISUAL_VALIDATION_ARTIFACT_TYPES.preview, name: "Preview Runtime Record", payload: runtimePayload(record), summary: { status: record.status, ...(target !== undefined ? { port: target.assignedPort } : {}), projectFilesChanged: false } });
  },
};

function configuredRenderer(context: CapabilityContext): BrowserRenderer | undefined {
  const value = context.config.visualRenderer;
  if (typeof value !== "object" || value === null) return undefined;
  const renderer = value as { capture?: BrowserRenderer["capture"]; close?: BrowserRenderer["close"] };
  if (renderer.capture === undefined || renderer.close === undefined) return undefined;
  return { capture: renderer.capture.bind(value), close: renderer.close.bind(value) };
}

export const captureImplementationScreenshotsCapability: Capability<unknown, CapabilityOutput> = {
  id: "capture-implementation-screenshots", name: "Capture implementation screenshots", description: "Renders each configured viewport in a clean browser context and stores bounded evidence.", type: "pure", version: "1", inputSchema: z.unknown(), outputSchema,
  async execute(context, raw): Promise<CapabilityOutput> {
    const requested = visualValidationWorkflowInputSchema.parse(raw);
    const input = await readArtifact(context, VISUAL_VALIDATION_ARTIFACT_IDS.input, visualValidationInputV1Schema);
    const project = await readArtifact(context, "project-implementation-context", projectImplementationContextV1Schema);
    const prepared = await safePreviewTarget(project as Stage4ProjectImplementationContext, requested.readinessPath, input.preview.startupTimeoutMs);
    const target = prepared.target;
    const progressPath = captureProgressPath(requested.stateDirectory, input.executionId);
    const persisted = readCaptureProgress(progressPath, input.executionId);
    const recovered = restoreCaptures(persisted);
    const recoveredViewportIds = new Set(recovered.map((item) => item.viewport.id));
    const recoveredAll = input.viewports.every((viewport) => recoveredViewportIds.has(viewport.id));
    let renderer = configuredRenderer(context);
    if (!recoveredAll && renderer === undefined) renderer = await loadOptionalPlaywrightRenderer();
    let runtime: PreviewRuntimeRecord;
    let captures: readonly { viewport: (typeof input.viewports)[number]; capture: Awaited<ReturnType<BrowserRenderer["capture"]>> }[] = recovered;
    let persistedCaptures = [...persisted];
    const warnings: string[] = [];
    let previewFailpointRequested = false;
    let failpointRequested: "after_desktop_capture" | "after_tablet_capture" | "after_mobile_capture" | undefined;
    if (recoveredAll) {
      const now = new Date().toISOString();
      runtime = { status: "ready", startedAt: now, endedAt: now, stdout: "", stderr: "", warnings: ["Reused completed screenshot captures from the durable Stage 6 progress marker."] };
    } else if (target === undefined) {
      const now = new Date().toISOString(); runtime = { status: "unavailable", startedAt: now, endedAt: now, stdout: "", stderr: "", warnings: [...prepared.warnings, "No safe project-declared preview script was found."] };
    } else if (renderer === undefined) {
      const now = new Date().toISOString(); runtime = { status: "unavailable", target, startedAt: now, endedAt: now, stdout: "", stderr: "", warnings: [...prepared.warnings, "renderer_unavailable: Playwright package or Chromium executable is missing."] }; warnings.push("renderer_unavailable: renderer missing");
    } else {
      try {
        const result = await captureWithPreview(requested.project.rootPath, target, renderer, input.viewports ?? [], {
          fullPage: input.capture.fullPage ?? false,
          waitForFontsMs: input.capture.waitForFontsMs ?? 5_000,
          timeoutMs: input.capture.screenshotTimeoutMs ?? 15_000,
          maxImageBytes: input.capture.maxImageBytes ?? 10_000_000,
          maxImagePixels: input.capture.maxImagePixels ?? 8_000_000,
          initialCaptures: recovered,
          onPreviewReady: async () => {
            if (!stage6FailpointEnabled("after_preview_ready")) return false;
            previewFailpointRequested = true;
            return true;
          },
          onCapture: async (viewport, capture) => {
            const payload = Buffer.from(capture.bytes).toString("base64");
            const stored = await context.artifactStore.save(payload, {
              type: "visual-validation.screenshot",
              sourceType: "implementation",
              viewport: viewport.id,
              progress: true,
            });
            const progressCapture: PersistedCapture = {
              viewport,
              capture: { ...capture, bytes: payload },
              payloadId: stored.id,
            };
            persistedCaptures = [...persistedCaptures.filter((item) => item.viewport.id !== viewport.id), progressCapture];
            writeCaptureProgress(progressPath, input.executionId, persistedCaptures);
            const failpoint = captureFailpoint(viewport.id);
            if (failpoint !== undefined && stage6FailpointEnabled(failpoint)) {
              failpointRequested = failpoint;
              return true;
            }
            return false;
          },
        }, context.signal);
        runtime = result.runtime;
        captures = result.captures as typeof captures;
        warnings.push(...runtime.warnings);
      } catch (error) {
        runtime = { status: "failed", target, startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), stdout: "", stderr: error instanceof Error ? error.message.slice(0, 2_000) : "capture failed", warnings: ["Browser capture failed."] };
      }
    }
    if (previewFailpointRequested)
      terminateAtStage6Failpoint("after_preview_ready");
    if (failpointRequested !== undefined) terminateAtStage6Failpoint(failpointRequested);
    const evidence = captures.length > 0 ? await storeImplementationEvidence(context.artifactStore, captures.map((item) => ({ viewport: item.viewport, capture: item.capture }))) : [];
    const domEvidence = captures.map((item) => ({ viewport: item.viewport, evidence: item.capture.dom ?? { elements: [], overflow: [] } }));
    const collection = screenshotEvidenceCollectionSchema.parse({ schemaVersion: "1", evidence, domEvidence, warnings: [...warnings, ...evidence.flatMap((item) => item.warnings)] });
    const runtimeRef = await writeArtifact(context, { artifactId: VISUAL_VALIDATION_ARTIFACT_IDS.preview, artifactType: VISUAL_VALIDATION_ARTIFACT_TYPES.preview, name: "Preview Runtime Record", payload: runtimePayload(runtime), summary: { status: runtime.status, ...(target !== undefined ? { port: target.assignedPort } : {}), projectFilesChanged: false } });
    const evidenceRef = await writeArtifact(context, { artifactId: VISUAL_VALIDATION_ARTIFACT_IDS.implementationEvidence, artifactType: VISUAL_VALIDATION_ARTIFACT_TYPES.implementationEvidence, name: "Implementation Screenshot Evidence", payload: collection, summary: { count: evidence.length, viewportCount: input.viewports.length, runtimeStatus: runtime.status, projectFilesChanged: false } });
    if (existsSync(progressPath)) unlinkSync(progressPath);
    void runtimeRef;
    return evidenceRef;
  },
};

export const storeDomEvidenceCapability: Capability<unknown, CapabilityOutput> = {
  id: "store-dom-and-computed-style-evidence", name: "Store DOM and computed style evidence", description: "Publishes bounded DOM and computed-style evidence collected during browser capture.", type: "pure", version: "1", inputSchema: z.unknown(), outputSchema,
  async execute(context): Promise<CapabilityOutput> {
    const collection = await readArtifact(context, VISUAL_VALIDATION_ARTIFACT_IDS.implementationEvidence, screenshotEvidenceCollectionSchema);
    const payload = domEvidenceCollectionSchema.parse({ schemaVersion: "1", viewports: collection.domEvidence, warnings: collection.warnings });
    return writeArtifact(context, { artifactId: VISUAL_VALIDATION_ARTIFACT_IDS.domEvidence, artifactType: VISUAL_VALIDATION_ARTIFACT_TYPES.domEvidence, name: "DOM and Computed Style Evidence", payload, summary: { viewportCount: payload.viewports.length, projectFilesChanged: false } });
  },
};

export const resolveReferenceEvidenceCapability: Capability<unknown, CapabilityOutput> = {
  id: "resolve-reference-evidence", name: "Resolve reference evidence", description: "Resolves available Figma screenshot references without relabeling fake-MCP evidence as real Figma.", type: "pure", version: "1", inputSchema: z.unknown(), outputSchema,
  async execute(context): Promise<CapabilityOutput> {
    const input = await readArtifact(context, VISUAL_VALIDATION_ARTIFACT_IDS.input, visualValidationInputV1Schema);
    const snapshot = await readArtifact(context, "figma-source-snapshot", figmaSourceSnapshotSchema);
    const evidence: ScreenshotEvidenceV1[] = [];
    const warnings: string[] = [];
    const source = classifyReferenceSource(snapshot);
    for (const screenshot of snapshot.screenshots ?? []) {
      const stored = await context.artifactStore.get(screenshot.artifactId);
      if (stored === null || typeof stored.data !== "string") { warnings.push(`Reference screenshot payload ${screenshot.artifactId} was unavailable.`); continue; }
      const bytes = new Uint8Array(Buffer.from(stored.data, "base64"));
      try {
        const dimensions = comparePngImages(bytes, bytes);
        const node = (snapshot.nodes ?? []).find((item) => item.id === screenshot.nodeId);
        const nodeName = typeof node?.name === "string" ? node.name.toLowerCase() : "";
        const viewportOptions = screenshot.viewportId === undefined
          ? { nodeName }
          : { explicitViewportId: screenshot.viewportId, nodeName };
        const targetViewport = associateReferenceViewport(
          dimensions.referenceWidth,
          dimensions.referenceHeight,
          input.viewports,
          viewportOptions,
        );
        const synthetic = source.authenticity === "synthetic-fixture" || source.authenticity === "fake-mcp";
        evidence.push({
          schemaVersion: "1",
          evidenceId: `reference-${screenshot.nodeId}-${targetViewport.id}`,
          sourceType: "reference",
          frame: { id: screenshot.nodeId, ...(node !== undefined ? { name: node.name } : {}) },
          viewport: targetViewport,
          image: { width: dimensions.referenceWidth, height: dimensions.referenceHeight, contentHash: hash(bytes), artifactId: screenshot.artifactId },
          capturedAt: new Date().toISOString(),
          captureMethod: source.captureMethod,
          warnings: synthetic ? ["source: synthetic-fixture", "comparison mode: synthetic-fixture"] : [],
          authenticity: source.authenticity,
          ...(source.sourceLabel !== undefined ? { sourceLabel: source.sourceLabel } : {}),
          sourceArtifactId: screenshot.artifactId,
          ...(snapshot.sourceProvenance !== undefined ? { sourceProvenance: snapshot.sourceProvenance } : {}),
          ...(node?.absoluteBoundingBox !== undefined ? { specification: [{ selector: node.name, boundingRectangle: node.absoluteBoundingBox, styles: { ...(node.cornerRadius !== undefined ? { borderRadius: node.cornerRadius } : {}), ...(node.itemSpacing !== undefined ? { gap: node.itemSpacing } : {}) } }] } : {}),
        });
      } catch { warnings.push(`Reference screenshot payload ${screenshot.artifactId} was not a bounded valid RGBA PNG.`); }
    }
    const mode = comparisonModeForReferenceEvidence(evidence);
    const ref = await writeArtifact(context, { artifactId: VISUAL_VALIDATION_ARTIFACT_IDS.referenceEvidence, artifactType: VISUAL_VALIDATION_ARTIFACT_TYPES.referenceEvidence, name: "Reference Screenshot Evidence", payload: { schemaVersion: "1", evidence, warnings }, summary: { count: evidence.length, mode, projectFilesChanged: false } });
    return ref;
  },
};

function finding(id: string, category: VisualFindingV1["category"], severity: VisualFindingV1["severity"], explanation: string, refs: string[], options: { referenceEvidenceId?: string; implementationEvidenceId?: string; expectedValue?: string; actualValue?: string; delta?: number; boundingRegion?: { x: number; y: number; width: number; height: number } } = {}): VisualFindingV1 {
  return visualFindingV1Schema.parse({ schemaVersion: "1", findingId: id, category, severity, confidence: 1, status: "confirmed", explanation, ...(options.referenceEvidenceId !== undefined ? { referenceEvidenceId: options.referenceEvidenceId } : {}), ...(options.implementationEvidenceId !== undefined ? { implementationEvidenceId: options.implementationEvidenceId } : {}), ...(options.expectedValue !== undefined ? { expectedValue: options.expectedValue } : {}), ...(options.actualValue !== undefined ? { actualValue: options.actualValue } : {}), ...(options.delta !== undefined ? { measurableDelta: options.delta } : {}), ...(options.boundingRegion !== undefined ? { boundingRegion: options.boundingRegion } : {}), evidenceReferences: refs, origin: "deterministic" });
}

async function imageBytes(context: CapabilityContext, evidence: ScreenshotEvidenceV1): Promise<Uint8Array | undefined> {
  const stored = await context.artifactStore.get(evidence.image.artifactId);
  if (stored === null || typeof stored.data !== "string") return undefined;
  const bytes = new Uint8Array(Buffer.from(stored.data, "base64"));
  return bytes.byteLength <= 10_000_000 ? bytes : undefined;
}

type ReferenceSourceClassification = Pick<ScreenshotEvidenceV1, "captureMethod" | "authenticity" | "sourceLabel">;

/**
 * Converts the typed upstream Figma provenance into reference-evidence
 * provenance. This is intentionally source-bound: a workflow/capability name
 * or a screenshot payload cannot turn a real image into a synthetic one (or
 * vice versa).
 */
export function classifyReferenceSource(snapshot: { readonly sourceProvenance?: unknown }): ReferenceSourceClassification {
  const parsed = figmaSourceProvenanceSchema.safeParse(snapshot.sourceProvenance);
  const provenance = parsed.success ? parsed.data : undefined;
  if (provenance?.mode === "mcp-desktop") {
    return { captureMethod: "figma", authenticity: "real-figma", sourceLabel: "figma-desktop" };
  }
  if (provenance?.mode === "rest") {
    return { captureMethod: "figma", authenticity: "real-figma", sourceLabel: "figma-rest" };
  }
  if (provenance?.mode === "mcp-stdio") {
    const identity = provenance.serverIdentity.toLowerCase();
    if (!identity.includes("fake") && !identity.includes("synthetic")) {
      return { captureMethod: "figma", authenticity: "real-figma", sourceLabel: "mcp-stdio" };
    }
    return { captureMethod: "fake-mcp", authenticity: "synthetic-fixture", sourceLabel: "synthetic-fixture" };
  }
  if (provenance?.mode === "placeholder") {
    return { captureMethod: "synthetic", authenticity: "synthetic-fixture", sourceLabel: "synthetic-fixture" };
  }
  return { captureMethod: "synthetic", authenticity: "unavailable", sourceLabel: "unavailable" };
}

/**
 * Associates a source-native image with a requested viewport only when the
 * association is defensible. A single reference is never copied to every
 * requested viewport as an implicit fallback.
 */
export function associateReferenceViewport(
  width: number,
  height: number,
  requested: readonly VisualViewportV1[],
  options: { readonly explicitViewportId?: string; readonly nodeName?: string } = {},
): VisualViewportV1 {
  const explicit = options.explicitViewportId === undefined
    ? undefined
    : requested.find((viewport) => viewport.id === options.explicitViewportId);
  if (explicit !== undefined) return { ...explicit, width, height };

  const exact = requested.find((viewport) => viewport.width === width && viewport.height === height);
  if (exact !== undefined) return { ...exact, width, height };

  const nodeName = options.nodeName?.toLowerCase() ?? "";
  const named = requested.find((viewport) => nodeName.includes(viewport.id.toLowerCase()));
  if (named !== undefined) return { ...named, width, height };

  const candidates = requested
    .map((viewport) => ({
      viewport,
      score: Math.max(Math.abs(width - viewport.width) / viewport.width, Math.abs(height - viewport.height) / viewport.height),
    }))
    .sort((left, right) => left.score - right.score);
  const best = candidates[0];
  const second = candidates[1];
  // A close, unambiguous match is useful for native Figma frame sizes such
  // as 413x1024. Otherwise preserve the honest source-native identity.
  if (best !== undefined && best.score <= 0.35 && (second === undefined || second.score - best.score > 0.02)) {
    return { ...best.viewport, width, height };
  }
  return { id: "source-native", width, height };
}

export function comparisonModeForReferenceEvidence(
  evidence: readonly ScreenshotEvidenceV1[],
): "pixel-reference" | "real-reference" | "synthetic-fixture" | "insufficient-reference" {
  if (evidence.length === 0) return "insufficient-reference";
  if (evidence.some((item) => item.authenticity === "synthetic-fixture" || item.authenticity === "fake-mcp")) return "synthetic-fixture";
  if (evidence.some((item) => item.authenticity === "real-figma")) return "real-reference";
  if (evidence.every((item) => item.authenticity === "unavailable")) return "insufficient-reference";
  return "pixel-reference";
}

export function referencesForViewport(
  evidence: readonly ScreenshotEvidenceV1[],
  viewportId: string,
): ScreenshotEvidenceV1[] {
  return evidence.filter((item) => item.viewport.id === viewportId);
}

export const compareVisualEvidenceCapability: Capability<unknown, CapabilityOutput> = {
  id: "compare-visual-evidence", name: "Compare visual evidence", description: "Runs deterministic evidence and policy checks before agent interpretation.", type: "pure", version: "1", inputSchema: z.unknown(), outputSchema,
  async execute(context): Promise<CapabilityOutput> {
    const input = await readArtifact(context, VISUAL_VALIDATION_ARTIFACT_IDS.input, visualValidationInputV1Schema);
    const preview = await readArtifact(context, VISUAL_VALIDATION_ARTIFACT_IDS.preview, previewRuntimeRecordSchema);
    const implementation = await readArtifact(context, VISUAL_VALIDATION_ARTIFACT_IDS.implementationEvidence, screenshotEvidenceCollectionSchema);
    const reference = await readArtifact(context, VISUAL_VALIDATION_ARTIFACT_IDS.referenceEvidence, screenshotEvidenceCollectionSchema);
    const findings: VisualFindingV1[] = [];
    const results = await Promise.all(input.viewports.map(async (viewport) => {
      const impl = implementation.evidence.find((item) => item.viewport.id === viewport.id);
      const refs = referencesForViewport(reference.evidence, viewport.id);
      const viewportFindingIds: string[] = [];
      const viewportFindings: VisualFindingV1[] = [];
      const warnings = [...implementation.warnings, ...reference.warnings];
      const captureAvailable = implementation.evidence.length > 0 || preview.status === "ready";
      if (impl === undefined && captureAvailable) { const item = finding(`missing-viewport-${viewport.id}`, "capture-error", "critical", `No implementation screenshot was captured for ${viewport.id}.`, []); viewportFindings.push(item); viewportFindingIds.push(item.findingId); }
      let comparison: SpatialComparison | undefined;
      const referenceEvidence = refs[0];
      if (impl !== undefined && referenceEvidence !== undefined) {
        const [implementationBytes, referenceBytes] = await Promise.all([imageBytes(context, impl), imageBytes(context, referenceEvidence)]);
        if (implementationBytes === undefined || referenceBytes === undefined) {
          warnings.push(`image evidence payload unavailable for ${viewport.id}`);
        } else {
          try { comparison = comparePngImages(referenceBytes, implementationBytes, { maxImageBytes: input.capture.maxImageBytes ?? 10_000_000, maxImagePixels: input.capture.maxImagePixels ?? 8_000_000 }); } catch (error) { warnings.push(`image comparison unavailable for ${viewport.id}: ${error instanceof Error ? error.message.slice(0, 300) : "invalid PNG"}`); }
        }
        if (comparison !== undefined && !comparison.dimensionCompatible) {
          const item = finding(`dimension-mismatch-${viewport.id}`, "size", "major", `Reference and implementation dimensions differ at ${viewport.id}.`, [impl.evidenceId, referenceEvidence.evidenceId], { referenceEvidenceId: referenceEvidence.evidenceId, implementationEvidenceId: impl.evidenceId, expectedValue: `${comparison.referenceWidth}x${comparison.referenceHeight}px`, actualValue: `${comparison.implementationWidth}x${comparison.implementationHeight}px`, delta: Math.abs(comparison.referenceHeight - comparison.implementationHeight), ...(comparison.changedRegion !== undefined ? { boundingRegion: comparison.changedRegion } : {}) });
          viewportFindings.push(item); viewportFindingIds.push(item.findingId);
        } else if (comparison !== undefined && comparison.mismatchRatio > comparison.mismatchRatioThreshold) {
          const specification = referenceEvidence.specification?.find((item) => /header/i.test(item.selector));
          const actual = (implementation.domEvidence ?? []).find((item) => item.viewport.id === viewport.id)?.evidence as { elements?: Array<{ selector?: string; height?: number }> } | undefined;
          const actualHeader = actual?.elements?.find((item) => specification !== undefined ? item.selector === specification.selector || /header/i.test(item.selector ?? "") : /header/i.test(item.selector ?? ""));
          const expectedHeight = specification?.boundingRectangle?.height;
          const actualHeight = actualHeader?.height;
          const measured = expectedHeight !== undefined && actualHeight !== undefined;
          const item = finding(`image-difference-${viewport.id}`, measured ? "size" : "layout", "major", measured ? `Header height differs at ${viewport.id}; deterministic DOM evidence overrides agent interpretation.` : `Implementation pixels differ materially from the reference at ${viewport.id}.`, [impl.evidenceId, referenceEvidence.evidenceId], { referenceEvidenceId: referenceEvidence.evidenceId, implementationEvidenceId: impl.evidenceId, ...(measured ? { expectedValue: `${expectedHeight}px`, actualValue: `${actualHeight}px`, delta: Math.abs(expectedHeight - actualHeight) } : { delta: comparison.mismatchRatio }), ...(comparison.changedRegion !== undefined ? { boundingRegion: comparison.changedRegion } : {}) });
          viewportFindings.push(item); viewportFindingIds.push(item.findingId);
        }
      }
      const status = !captureAvailable ? "unavailable" : impl === undefined ? "fail" : refs.length === 0 ? "inconclusive" : viewportFindingIds.length > 0 ? "fail" : "pass";
      return { viewport, status, implementationEvidenceIds: impl === undefined ? [] : [impl.evidenceId], referenceEvidenceIds: refs.map((item) => item.evidenceId), findingIds: viewportFindingIds, findings: viewportFindings, metrics: { ...(comparison !== undefined ? { pixelMismatchRatio: comparison.mismatchRatio, perceptualSimilarity: Math.max(0, 1 - comparison.mismatchRatio), changedRegionCount: comparison.changedPixelCount > 0 ? 1 : 0, ...(comparison.changedRegion !== undefined ? { changedRegion: comparison.changedRegion } : {}) } : {}), dimensionCompatible: comparison?.dimensionCompatible ?? (impl === undefined || refs.length === 0 || refs[0]?.viewport.width === impl.viewport.width) }, warnings };
    }));
    findings.push(...results.flatMap((result) => result.findings));
    const viewportResults = results.map(({ findings: _findings, ...result }) => result);
    const mode = comparisonModeForReferenceEvidence(reference.evidence);
    const payload = visualComparisonMetricsSchema.parse({ schemaVersion: "1", mode, comparison: { algorithmVersion: "png-rgba-pixel-diff-v1", threshold: 8, mismatchRatioThreshold: 0.005, maxPixels: input.capture.maxImagePixels ?? 8_000_000, maxImageBytes: input.capture.maxImageBytes ?? 10_000_000 }, findings, referenceEvidence: reference.evidence, implementationEvidence: implementation.evidence, viewportResults, warnings: [...implementation.warnings, ...reference.warnings, ...(preview.warnings)] });
    return writeArtifact(context, { artifactId: VISUAL_VALIDATION_ARTIFACT_IDS.metrics, artifactType: VISUAL_VALIDATION_ARTIFACT_TYPES.metrics, name: "Image Comparison Metrics", payload, summary: { mode, findingCount: findings.length, projectFilesChanged: false } });
  },
};

export const invokeVisualValidationAgentStage5Capability: Capability<unknown, CapabilityOutput> = {
  id: "invoke-visual-validation-agent-stage5", name: "Invoke Visual Validation Agent", description: "Invokes the evidence-bound specialized Visual Validation Agent.", type: "pure", version: "1", inputSchema: z.unknown(), outputSchema,
  async execute(context): Promise<CapabilityOutput> {
    const input = await readArtifact(context, VISUAL_VALIDATION_ARTIFACT_IDS.input, visualValidationInputV1Schema);
    const metrics = await readArtifact(context, VISUAL_VALIDATION_ARTIFACT_IDS.metrics, visualComparisonMetricsSchema);
    const output = await requiredAgentInvoker(context).invoke({ agentId: "visual-validation-agent", objective: "Interpret deterministic visual validation evidence without inventing measurements.", input: { visualValidationInput: input, deterministicFindings: metrics.findings, evidenceIds: [...metrics.implementationEvidence, ...metrics.referenceEvidence].map((item) => item.evidenceId) }, attempt: 1 }, context.signal);
    if (output.type === "failure") throw new DesignFlowError(output.code, "The Visual Validation Agent could not produce a report.", { capabilityId: context.capabilityId });
    const parsed = visualValidationAgentOutputV1Schema.parse(output.output);
    return writeArtifact(context, { artifactId: VISUAL_VALIDATION_ARTIFACT_IDS.agentOutput, artifactType: VISUAL_VALIDATION_ARTIFACT_TYPES.agentOutput, name: "Visual Validation Agent Output", payload: parsed, summary: { findingCount: parsed.findings.length, projectFilesChanged: false } });
  },
};

export const storeVisualValidationReportCapability: Capability<unknown, CapabilityOutput> = {
  id: "store-visual-validation-report", name: "Store Visual Validation Report", description: "Applies the deterministic Stage 5 pass/fail policy and stores the inspectable report.", type: "pure", version: "1", inputSchema: z.unknown(), outputSchema,
  async execute(context): Promise<CapabilityOutput> {
    const input = await readArtifact(context, VISUAL_VALIDATION_ARTIFACT_IDS.input, visualValidationInputV1Schema);
    const metrics = await readArtifact(context, VISUAL_VALIDATION_ARTIFACT_IDS.metrics, visualComparisonMetricsSchema);
    const agent = await readArtifact(context, VISUAL_VALIDATION_ARTIFACT_IDS.agentOutput, visualValidationAgentOutputV1Schema);
    const allFindings = [...metrics.findings, ...agent.findings.filter((item) => !metrics.findings.some((existing) => existing.findingId === item.findingId))];
    const critical = allFindings.filter((item) => item.severity === "critical").length;
    const major = allFindings.filter((item) => item.severity === "major").length;
    const minor = allFindings.filter((item) => item.severity === "minor").length;
    const captureUnavailable = metrics.implementationEvidence.length === 0;
    const missingViewport = metrics.viewportResults.some((result) => result.status === "fail" && result.implementationEvidenceIds.length === 0);
    const overallStatus = critical > 0 || major > 0 || missingViewport ? "fail" : captureUnavailable ? "unavailable" : metrics.referenceEvidence.length === 0 ? "inconclusive" : minor > 0 ? "pass_with_findings" : "pass";
    const categories = ["layout", "spacing", "size", "alignment", "typography", "color", "border", "radius", "shadow", "visibility", "content", "responsive", "overflow", "component-structure", "missing-element", "extra-element", "capture-error"] as const;
    const severities = ["info", "minor", "major", "critical"] as const;
    const byCategory = Object.fromEntries(categories.map((category) => [category, allFindings.filter((item) => item.category === category).length]));
    const bySeverity = Object.fromEntries(severities.map((severity) => [severity, allFindings.filter((item) => item.severity === severity).length]));
    const report: VisualValidationReport = visualValidationReportV1Schema.parse({ schemaVersion: "1", projectId: input.project.id, projectRootIdentity: input.project.rootIdentity, generatedImplementationArtifactId: input.generatedImplementationArtifactId, designSpecificationArtifactId: input.designSpecificationArtifactId, figmaSourceSnapshotArtifactId: input.figmaSourceSnapshotArtifactId, referenceEvidence: metrics.referenceEvidence, implementationEvidence: metrics.implementationEvidence, viewportResults: metrics.viewportResults, findings: allFindings, summary: { byCategory, bySeverity }, coverage: { requestedViewports: input.viewports.length, capturedViewports: metrics.implementationEvidence.length, referenceViewports: metrics.referenceEvidence.length, requiredViewportCoverage: metrics.implementationEvidence.length === input.viewports.length }, confidence: metrics.referenceEvidence.length > 0 && !captureUnavailable ? 1 : 0.35, limitations: [...metrics.warnings, ...(captureUnavailable ? ["A browser-rendered implementation screenshot was unavailable."] : []), ...(metrics.referenceEvidence.length === 0 ? ["Reference screenshot evidence was unavailable; pixel-level fidelity was not assessed."] : [])], captureWarnings: metrics.warnings, comparisonMode: metrics.mode, overallStatus, passFailPolicy: { criticalFails: true, majorDeterministicFails: true, rendererFailureFails: true, missingRequiredViewportFails: true, unavailableReferenceIsInconclusive: true }, agent: { id: "visual-validation-agent", version: input.agentVersion, ...(input.modelProfileId !== undefined ? { modelProfileId: input.modelProfileId } : {}) }, traceIds: [] });
    return writeArtifact(context, { artifactId: VISUAL_VALIDATION_ARTIFACT_IDS.report, artifactType: VISUAL_VALIDATION_ARTIFACT_TYPES.report, name: "Visual Validation Report", payload: report, summary: { status: report.overallStatus, critical, major, minor, viewportCount: report.viewportResults.length, referenceMode: report.comparisonMode, projectFilesChanged: false } });
  },
};

export const storeStage5SummaryCapability: Capability<unknown, CapabilityOutput> = {
  id: "store-stage-5-summary", name: "Store Stage 5 summary", description: "Stores a concise honest visual validation summary without applying corrections.", type: "pure", version: "1", inputSchema: z.unknown(), outputSchema,
  async execute(context): Promise<CapabilityOutput> {
    const report = await readArtifact(context, VISUAL_VALIDATION_ARTIFACT_IDS.report, visualValidationReportV1Schema);
    const summary = visualValidationSummarySchema.parse({ schemaVersion: "1", projectId: report.projectId, reportArtifactId: VISUAL_VALIDATION_ARTIFACT_IDS.report, overallStatus: report.overallStatus, viewportCount: report.viewportResults.length, critical: report.summary.bySeverity.critical ?? 0, major: report.summary.bySeverity.major ?? 0, minor: report.summary.bySeverity.minor ?? 0, referenceMode: report.comparisonMode, projectFilesChanged: false, correctionsApplied: false });
    return writeArtifact(context, { artifactId: VISUAL_VALIDATION_ARTIFACT_IDS.summary, artifactType: VISUAL_VALIDATION_ARTIFACT_TYPES.summary, name: "Stage 5 summary", payload: summary, summary: { status: summary.overallStatus, viewports: summary.viewportCount, projectFilesChanged: false, correctionsApplied: false } });
  },
};

export const visualValidationCapabilities = [prepareVisualValidationCapability, startPreviewServerCapability, captureImplementationScreenshotsCapability, storeDomEvidenceCapability, resolveReferenceEvidenceCapability, compareVisualEvidenceCapability, invokeVisualValidationAgentStage5Capability, storeVisualValidationReportCapability, storeStage5SummaryCapability] as const;
