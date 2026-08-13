import {
  DesignFlowError,
  designSpecificationSchema,
  figmaSourceSnapshotSchema,
  figmaSourceProvenanceSchema,
  generatedImplementationV1Schema,
  projectImplementationContextV1Schema,
  visualValidationInconclusiveReasonSchema,
  visualValidationReportV1Schema,
  type CapabilityContext,
  type FigmaSourceSnapshot,
  type VisualValidationReportV1,
} from "@designflow/sdk";
import {
  captureImplementationScreenshotsCapability,
  compareVisualEvidenceCapability,
  invokeVisualValidationAgentStage5Capability,
  prepareVisualValidationCapability,
  resolveReferenceEvidenceCapability,
  startPreviewServerCapability,
  storeDomEvidenceCapability,
  storeVisualValidationReportCapability,
} from "./visual-validation-capabilities";
import { inspectRegisteredProject } from "@designflow/capability-implementation";
import {
  parseFigmaSourceCapability,
  retrieveFigmaSourceSnapshotCapability,
} from "@designflow/capability-figma-mcp";
import { readArtifact, writeArtifact } from "./artifact-io";
import { FEEDBACK_LOOP_ARTIFACT_IDS, type FeedbackLoopWorkflowInput } from "./feedback-loop-types";

type Stage5Ref = { id: string; type: string; metadata: Record<string, unknown> };

export type RevalidationReferenceSource = "persisted" | "refreshed";
type Stage5Phase = "reference_resolution" | "reference_acquisition" | "reference_decode" | "preview_start" | "capture" | "comparison" | "artifact_write";
type TrustedVisualReference = NonNullable<FeedbackLoopWorkflowInput["trustedVisualReference"]>;

class Stage5RevalidationError extends DesignFlowError {
  public readonly phase: Stage5Phase;
  public readonly referenceSource: RevalidationReferenceSource;

  public constructor(
    phase: Stage5Phase,
    error: unknown,
    referenceSource: RevalidationReferenceSource,
  ) {
    const code = error instanceof DesignFlowError ? error.code : "ERR_STAGE5_REVALIDATION";
    super(code, `Stage 5 ${phase} failed.`);
    this.name = "Stage5RevalidationError";
    this.phase = phase;
    this.referenceSource = referenceSource;
    Object.setPrototypeOf(this, Stage5RevalidationError.prototype);
  }
}

function stage5Error(
  phase: Stage5Phase,
  error: unknown,
  referenceSource: RevalidationReferenceSource,
): Stage5RevalidationError {
  return error instanceof Stage5RevalidationError
    ? error
    : new Stage5RevalidationError(phase, error, referenceSource);
}

function errorCode(error: unknown): string {
  const code = error instanceof DesignFlowError ? error.code : "ERR_STAGE5_REVALIDATION";
  return /^[A-Z0-9_]{1,96}$/.test(code) ? code : "ERR_STAGE5_REVALIDATION";
}

function sanitizeDiagnosticMessage(error: unknown, phase: Stage5Phase): string {
  const source = error instanceof Error ? error.message : String(error);
  const sanitized = source
    .replace(/(?:authorization|proxy-authorization|x-api-key|api[-_]?key|access[-_]?token)\s*[:=]\s*[^\r\n]*/gi, "[redacted]")
    .replace(/\bbearer\s+[^\s,;]+/gi, "bearer [redacted]")
    .replace(/(?:[A-Za-z]:[\\/]|\/(?:Users|private|tmp|var|home|workspace)[^\s'"`)]*)[^\s'"`)]*/g, "[path]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
  return sanitized.length > 0 ? sanitized : `Visual validation failed during ${phase}.`;
}

export function visualValidationInconclusiveReason(
  error: unknown,
  fallbackPhase: Stage5Phase = "reference_resolution",
) {
  const phase = error instanceof Stage5RevalidationError ? error.phase : fallbackPhase;
  return visualValidationInconclusiveReasonSchema.parse({
    code: errorCode(error),
    phase,
    message: sanitizeDiagnosticMessage(error, phase),
  });
}

export async function resolveTrustedVisualReference(
  context: CapabilityContext,
  reference: TrustedVisualReference | undefined,
  report: VisualValidationReportV1,
): Promise<FigmaSourceSnapshot | undefined> {
  if (reference === undefined) return undefined;
  const provenance = figmaSourceProvenanceSchema.safeParse(reference.provenance);
  if (!provenance.success || provenance.data.mode === "placeholder") return undefined;
  if (provenance.data.requestedFileKey !== reference.fileKey) return undefined;
  if (provenance.data.requestedNodeId !== undefined && provenance.data.requestedNodeId !== reference.nodeId) return undefined;
  const stored = await context.artifactStore.get(reference.artifactHash);
  if (stored === null || stored.artifact.id !== reference.artifactHash) return undefined;
  if (stored.artifact.metadata["artifactId"] !== reference.artifactId || stored.artifact.metadata["type"] !== reference.artifactType) return undefined;
  let snapshot: FigmaSourceSnapshot;
  try {
    snapshot = figmaSourceSnapshotSchema.parse(stored.data);
  } catch {
    return undefined;
  }
  if (snapshot.source.fileKey !== reference.fileKey || !snapshot.source.nodeIds.includes(reference.nodeId)) return undefined;
  const screenshot = snapshot.screenshots.find((candidate) => candidate.nodeId === reference.nodeId);
  if (screenshot === undefined) return undefined;
  const matchingEvidence = report.referenceEvidence.some((evidence) =>
    evidence.authenticity === "real-figma" &&
    evidence.frame.id === reference.nodeId &&
    evidence.image.artifactId === screenshot.artifactId &&
    evidence.image.contentHash === reference.contentHash &&
    (() => {
      const provenance = figmaSourceProvenanceSchema.safeParse(evidence.sourceProvenance);
      return provenance.success && provenance.data.mode !== "placeholder" && provenance.data.requestedFileKey === reference.fileKey;
    })(),
  );
  return matchingEvidence ? snapshot : undefined;
}

/**
 * A persisted reference is reusable only when its source identity and stored
 * screenshot identities still bind to the same file/node evidence. Dimensions
 * alone are deliberately insufficient.
 */
export function hasTrustedPersistedReference(
  snapshot: FigmaSourceSnapshot | undefined,
  report: VisualValidationReportV1,
): boolean {
  if (snapshot?.source.fileKey === undefined || report.referenceEvidence.length === 0)
    return false;
  const nodeIds = new Set(snapshot.source.nodeIds);
  const screenshotIds = new Set(snapshot.screenshots.map((screenshot) => screenshot.artifactId));
  return report.referenceEvidence.every((evidence) => {
    const provenance = figmaSourceProvenanceSchema.safeParse(evidence.sourceProvenance);
    return evidence.authenticity === "real-figma" &&
      evidence.image.artifactId.length > 0 &&
      screenshotIds.has(evidence.image.artifactId) &&
      evidence.frame.id !== undefined &&
      nodeIds.has(evidence.frame.id) &&
      provenance.success &&
      provenance.data.mode !== "placeholder" &&
      provenance.data.requestedFileKey === snapshot.source.fileKey;
  });
}

function stage5Context(context: CapabilityContext, capabilityId: string, refs: readonly Stage5Ref[]): CapabilityContext {
  return { ...context, capabilityId, artifactRefs: refs, parentArtifacts: refs };
}

function refFrom(output: unknown): Stage5Ref {
  if (typeof output !== "object" || output === null || !("artifactRef" in output)) throw new Error("Stage 5 capability did not return an artifact reference.");
  const ref = (output as { artifactRef?: unknown }).artifactRef;
  if (typeof ref !== "object" || ref === null || !("id" in ref) || !("type" in ref) || !("metadata" in ref)) throw new Error("Stage 5 capability returned an invalid artifact reference.");
  return ref as Stage5Ref;
}

function stage5Input(input: FeedbackLoopWorkflowInput) {
  const frame = input.affectedFileMap[Object.keys(input.affectedFileMap)[0] ?? ""]?.[0] ?? "Header";
  return {
    enabled: true as const,
    project: { id: input.project.id, name: input.project.name, rootPath: input.project.rootPath },
    stateDirectory: input.stateDirectory,
    designFile: `designflow://feedback-loop/${input.project.id}`,
    frames: [frame],
    captureScreenshots: true,
    viewports: input.viewportConfiguration.viewports,
    readinessPath: "/",
    capture: {},
    agentVersion: "0.1.0",
    modelProfileId: input.modelProfileId,
  };
}

async function seedStage5Inputs(context: CapabilityContext, input: FeedbackLoopWorkflowInput, initial: VisualValidationReportV1): Promise<{ refs: Stage5Ref[]; referenceSource: RevalidationReferenceSource }> {
  const inspected = inspectRegisteredProject(input.project);
  const project = projectImplementationContextV1Schema.parse(inspected);
  const spec = designSpecificationSchema.parse({
    schemaVersion: "1",
    sourceIdentity: { designFile: `designflow://feedback-loop/${input.project.id}` },
    frames: [input.affectedFileMap[Object.keys(input.affectedFileMap)[0] ?? ""]?.[0] ?? "Header"],
    hierarchy: [{ id: "feedback-loop-root", name: "Feedback loop root" }],
    designTokens: { colors: [], spacing: [], typography: [], radii: [], borders: [], shadows: [], referencedVariableNames: [] },
    components: [], layoutBehavior: [], responsiveAssumptions: [], assets: [], content: [], interactions: [], states: [], accessibilityNotes: [], ambiguities: [], agentVersion: "0.1.0",
  });
  const generated = generatedImplementationV1Schema.parse({
    schemaVersion: "1", projectId: input.project.id, designSpecificationArtifactId: "design-specification", projectContextArtifactId: "project-implementation-context", mappingArtifactId: "design-system-mapping", implementationPlanArtifactId: "implementation-plan", proposalArtifactId: "proposed-file-changes", applicationArtifactId: "file-application-result", validationArtifactId: "implementation-validation", changedFiles: [], createdFiles: [], modifiedFiles: [], dependencyChanges: [], reusedComponents: [], reusedTokens: [], assumptions: [], unresolvedItems: [], agentId: "implementation-agent", agentVersion: "0.1.0", modelProfileId: "implementation-default",
  });
  const firstProvenance = figmaSourceProvenanceSchema.safeParse(
    initial.referenceEvidence[0]?.sourceProvenance,
  );
  const firstFileKey = firstProvenance.success && firstProvenance.data.mode !== "placeholder"
    ? firstProvenance.data.requestedFileKey
    : undefined;
  let referenceSnapshot = await resolveTrustedVisualReference(
    context,
    input.trustedVisualReference,
    initial,
  );
  let referenceSource: RevalidationReferenceSource = referenceSnapshot === undefined
    ? "refreshed"
    : "persisted";
  // Historical inputs had no explicit handoff. Preserve their safe local
  // fallback, but do not label it as new persisted-parent proof.
  const childLocalSnapshotRaw = input.trustedVisualReference === undefined
    ? await (async () => {
        try {
          return await readArtifact(context, "figma-source-snapshot", figmaSourceSnapshotSchema);
        } catch {
          return undefined;
        }
      })()
    : undefined;
  const childLocalSnapshot = childLocalSnapshotRaw === undefined
    ? undefined
    : figmaSourceSnapshotSchema.parse(childLocalSnapshotRaw);
  if (referenceSnapshot === undefined && childLocalSnapshot !== undefined && hasTrustedPersistedReference(childLocalSnapshot, initial)) {
    referenceSnapshot = childLocalSnapshot;
  }
  const refreshableProvenance = firstProvenance.success &&
    firstProvenance.data.mode !== "placeholder"
    ? firstProvenance.data
    : undefined;
  if (referenceSnapshot === undefined && refreshableProvenance !== undefined && context.mcp !== undefined) {
    const provenance = refreshableProvenance;
    const fileKey = provenance.requestedFileKey;
    const nodeId = provenance.requestedNodeId ?? initial.referenceEvidence[0]?.frame.id;
    if (nodeId === undefined)
      throw new DesignFlowError(
        "ERR_FIGMA_REFERENCE_IDENTITY_MISSING",
        "The visual reference cannot be refreshed because its Figma node identity is missing.",
      );
    try {
      const parsed = await parseFigmaSourceCapability.execute(
        context,
        {
          designFile: `https://www.figma.com/design/${fileKey}/?node-id=${nodeId.replace(":", "-")}`,
          frames: [nodeId],
          allowFixtureNames: false,
        },
      );
      const parsedRef = refFrom(parsed);
      const retrieved = await retrieveFigmaSourceSnapshotCapability.execute(
        {
          ...context,
          artifactRefs: [...context.artifactRefs, parsedRef],
          parentArtifacts: [...context.parentArtifacts, parsedRef],
        },
        {
          captureScreenshots: true,
          refreshFigmaSource: true,
          sourceMode: provenance.mode,
          serverIdentity: provenance.serverIdentity,
          requestedNodeId: nodeId,
        },
      );
      const retrievedRef = refFrom(retrieved);
      const payloadId = retrievedRef.metadata["payloadId"];
      if (typeof payloadId !== "string")
        throw new DesignFlowError(
          "ERR_FIGMA_REFERENCE_PAYLOAD_MISSING",
          "The refreshed Figma reference did not retain a trusted payload.",
        );
      const stored = await context.artifactStore.get(payloadId);
      referenceSnapshot = figmaSourceSnapshotSchema.parse(stored?.data);
      referenceSource = "refreshed";
    } catch (error) {
      throw stage5Error("reference_acquisition", error, referenceSource);
    }
  }
  const referenceArtifactIds: string[] = [];
  if (referenceSnapshot !== undefined) {
    referenceArtifactIds.push(
      ...(referenceSnapshot.screenshots ?? []).map((screenshot) => screenshot.artifactId),
    );
  } else {
    for (const evidence of initial.referenceEvidence) {
      const existing = await context.artifactStore.get(evidence.image.artifactId);
      if (existing !== null && typeof existing.data === "string") {
        referenceArtifactIds.push(evidence.image.artifactId);
        continue;
      }
      const payload = input.referenceImagePayloads?.[evidence.image.artifactId];
      const stored = payload === undefined ? undefined : await context.artifactStore.save(payload, { type: "validation.reference-image", artifactId: `feedback-reference-${evidence.evidenceId}` });
      referenceArtifactIds.push(stored?.id ?? evidence.image.artifactId);
    }
  }
  const source = childLocalSnapshot?.source ?? {
    designFile: `designflow://feedback-loop/${input.project.id}`,
    ...(firstFileKey === undefined ? {} : { fileKey: firstFileKey }),
    frames: spec.frames,
    nodeIds: initial.referenceEvidence.map((evidence) => evidence.frame.id ?? "frame"),
  };
  const snapshot = referenceSnapshot ?? figmaSourceSnapshotSchema.parse({
    ...(childLocalSnapshot ?? {}),
    schemaVersion: "1", source: { ...source, frames: (source.frames ?? []).length > 0 ? source.frames : spec.frames, nodeIds: (source.nodeIds ?? []).length > 0 ? source.nodeIds : spec.frames },
    ...(childLocalSnapshot?.sourceProvenance === undefined && firstProvenance.success ? { sourceProvenance: firstProvenance.data } : {}),
    screenshots: initial.referenceEvidence.map((evidence, index) => ({ nodeId: evidence.frame.id ?? "frame", artifactId: referenceArtifactIds[index] ?? evidence.image.artifactId, width: evidence.image.width, height: evidence.image.height, format: "png" })),
    capabilities: { screenshotsAvailable: initial.referenceEvidence.length > 0 }, warnings: [],
  });
  const refs: Stage5Ref[] = [];
  for (const item of [
    ["project-implementation-context", "project.implementation-context", project],
    ["design-specification", "design.specification", spec],
    ["generated-implementation", "code.generated-implementation", generated],
    ["figma-source-snapshot", "design.figma-source-snapshot", snapshot],
  ] as const) {
    try {
      refs.push(refFrom(await writeArtifact(stage5Context(context, `seed-${item[0]}`, refs), { artifactId: item[0], artifactType: item[1], name: item[0], payload: item[2], summary: { projectFilesChanged: false, feedbackLoopSeed: true } })));
    } catch (error) {
      throw stage5Error("artifact_write", error, referenceSource);
    }
  }
  return { refs, referenceSource };
}

/**
 * Executes the existing Stage 5 capabilities in their production order.
 * This is intentionally a runtime composition seam, not a second browser
 * implementation. Every intermediate Stage 5 artifact is persisted.
 */
export async function runFreshStage5Validation(context: CapabilityContext, input: FeedbackLoopWorkflowInput, initial: VisualValidationReportV1): Promise<{ report: VisualValidationReportV1; artifactIds: string[]; referenceSource: RevalidationReferenceSource }> {
  const fallbackSource: RevalidationReferenceSource = "refreshed";
  let seeded: Awaited<ReturnType<typeof seedStage5Inputs>>;
  try {
    seeded = await seedStage5Inputs(context, input, initial);
  } catch (error) {
    throw stage5Error(
      error instanceof Stage5RevalidationError ? error.phase : "reference_resolution",
      error,
      error instanceof Stage5RevalidationError ? error.referenceSource : fallbackSource,
    );
  }
  let refs = seeded.refs;
  const stageInput = stage5Input(input);
  const steps: Array<[string, { execute(context: CapabilityContext, input: unknown): Promise<unknown>; input: unknown }]> = [
    ["prepare-visual-validation", { execute: prepareVisualValidationCapability.execute.bind(prepareVisualValidationCapability), input: stageInput }],
    ["start-preview-server", { execute: startPreviewServerCapability.execute.bind(startPreviewServerCapability), input: stageInput }],
    ["capture-implementation-screenshots", { execute: captureImplementationScreenshotsCapability.execute.bind(captureImplementationScreenshotsCapability), input: stageInput }],
    ["store-dom-and-computed-style-evidence", { execute: storeDomEvidenceCapability.execute.bind(storeDomEvidenceCapability), input: {} }],
    ["resolve-reference-evidence", { execute: resolveReferenceEvidenceCapability.execute.bind(resolveReferenceEvidenceCapability), input: {} }],
    ["compare-visual-evidence", { execute: compareVisualEvidenceCapability.execute.bind(compareVisualEvidenceCapability), input: {} }],
    ["invoke-visual-validation-agent-stage5", { execute: invokeVisualValidationAgentStage5Capability.execute.bind(invokeVisualValidationAgentStage5Capability), input: {} }],
    ["store-visual-validation-report", { execute: storeVisualValidationReportCapability.execute.bind(storeVisualValidationReportCapability), input: {} }],
  ];
  for (const [capabilityId, step] of steps) {
    const phase: Stage5Phase = capabilityId === "prepare-visual-validation"
      ? "reference_resolution"
      : capabilityId === "start-preview-server"
        ? "preview_start"
        : capabilityId === "capture-implementation-screenshots"
          ? "capture"
          : capabilityId === "resolve-reference-evidence"
            ? "reference_decode"
            : capabilityId === "compare-visual-evidence" || capabilityId === "invoke-visual-validation-agent-stage5"
              ? "comparison"
              : "artifact_write";
    try {
      const output = await step.execute(stage5Context(context, capabilityId, refs), step.input);
      refs = [...refs, refFrom(output)];
    } catch (error) {
      throw stage5Error(phase, error, seeded.referenceSource);
    }
  }
  const reportRef = refs.find((ref) => ref.id === "visual-validation-report");
  if (reportRef === undefined) throw stage5Error("artifact_write", new Error("Stage 5 did not produce a Visual Validation Report."), seeded.referenceSource);
  const payloadId = reportRef.metadata["payloadId"];
  if (typeof payloadId !== "string") throw stage5Error("artifact_write", new Error("Stage 5 report did not retain its payload reference."), seeded.referenceSource);
  let report: VisualValidationReportV1;
  try {
    const stored = await context.artifactStore.get(payloadId);
    report = visualValidationReportV1Schema.parse(stored?.data);
  } catch (error) {
    throw stage5Error("artifact_write", error, seeded.referenceSource);
  }
  const persisted = ["preview-runtime-record", "implementation-screenshot-evidence", "dom-and-computed-style-evidence", "reference-screenshot-evidence", "image-comparison-metrics", "visual-validation-agent-output", "visual-validation-report"];
  return { report, artifactIds: persisted, referenceSource: seeded.referenceSource };
}

export async function storeRevalidatedReport(context: CapabilityContext, report: VisualValidationReportV1, stage5ArtifactIds: readonly string[], referenceSource: RevalidationReferenceSource = "refreshed") {
  return writeArtifact(context, { artifactId: FEEDBACK_LOOP_ARTIFACT_IDS.revalidatedReport, artifactType: "feedback.revalidated-visual-report", name: "Revalidated Visual Validation Report", payload: report, summary: { status: report.overallStatus, stage5ArtifactIds: [...stage5ArtifactIds], referenceSource, projectFilesChanged: false } });
}
