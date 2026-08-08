import {
  DesignFlowError,
  designSpecificationSchema,
  figmaSourceSnapshotSchema,
  figmaSourceProvenanceSchema,
  generatedImplementationV1Schema,
  projectImplementationContextV1Schema,
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
  const persistedSnapshot = await (async () => {
    try {
      return await readArtifact(context, "figma-source-snapshot", figmaSourceSnapshotSchema);
    } catch {
      return undefined;
    }
  })();
  const firstProvenance = figmaSourceProvenanceSchema.safeParse(
    initial.referenceEvidence[0]?.sourceProvenance,
  );
  const firstFileKey = firstProvenance.success && firstProvenance.data.mode !== "placeholder"
    ? firstProvenance.data.requestedFileKey
    : undefined;
  const persistedReference = hasTrustedPersistedReference(
    persistedSnapshot === undefined ? undefined : figmaSourceSnapshotSchema.parse(persistedSnapshot),
    initial,
  );
  let referenceSnapshot = persistedReference ? persistedSnapshot : undefined;
  let referenceSource: RevalidationReferenceSource = persistedReference
    ? "persisted"
    : "refreshed";
  const refreshableProvenance = firstProvenance.success &&
    firstProvenance.data.mode !== "placeholder"
    ? firstProvenance.data
    : undefined;
  if (!persistedReference && refreshableProvenance !== undefined && context.mcp !== undefined) {
    const provenance = refreshableProvenance;
    const fileKey = provenance.requestedFileKey;
    const nodeId = provenance.requestedNodeId ?? initial.referenceEvidence[0]?.frame.id;
    if (nodeId === undefined)
      throw new DesignFlowError(
        "ERR_FIGMA_REFERENCE_IDENTITY_MISSING",
        "The visual reference cannot be refreshed because its Figma node identity is missing.",
      );
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
  const source = persistedSnapshot?.source ?? {
    designFile: `designflow://feedback-loop/${input.project.id}`,
    ...(firstFileKey === undefined ? {} : { fileKey: firstFileKey }),
    frames: spec.frames,
    nodeIds: initial.referenceEvidence.map((evidence) => evidence.frame.id ?? "frame"),
  };
  const snapshot = referenceSnapshot ?? figmaSourceSnapshotSchema.parse({
    ...(persistedSnapshot ?? {}),
    schemaVersion: "1", source: { ...source, frames: (source.frames ?? []).length > 0 ? source.frames : spec.frames, nodeIds: (source.nodeIds ?? []).length > 0 ? source.nodeIds : spec.frames },
    ...(persistedSnapshot?.sourceProvenance === undefined && firstProvenance.success ? { sourceProvenance: firstProvenance.data } : {}),
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
    refs.push(refFrom(await writeArtifact(stage5Context(context, `seed-${item[0]}`, refs), { artifactId: item[0], artifactType: item[1], name: item[0], payload: item[2], summary: { projectFilesChanged: false, feedbackLoopSeed: true } })));
  }
  return { refs, referenceSource };
}

/**
 * Executes the existing Stage 5 capabilities in their production order.
 * This is intentionally a runtime composition seam, not a second browser
 * implementation. Every intermediate Stage 5 artifact is persisted.
 */
export async function runFreshStage5Validation(context: CapabilityContext, input: FeedbackLoopWorkflowInput, initial: VisualValidationReportV1): Promise<{ report: VisualValidationReportV1; artifactIds: string[]; referenceSource: RevalidationReferenceSource }> {
  const seeded = await seedStage5Inputs(context, input, initial);
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
    const output = await step.execute(stage5Context(context, capabilityId, refs), step.input);
    refs = [...refs, refFrom(output)];
  }
  const reportRef = refs.find((ref) => ref.id === "visual-validation-report");
  if (reportRef === undefined) throw new Error("Stage 5 did not produce a Visual Validation Report.");
  const payloadId = reportRef.metadata["payloadId"];
  if (typeof payloadId !== "string") throw new Error("Stage 5 report did not retain its payload reference.");
  const stored = await context.artifactStore.get(payloadId);
  const report = visualValidationReportV1Schema.parse(stored?.data);
  const persisted = ["preview-runtime-record", "implementation-screenshot-evidence", "dom-and-computed-style-evidence", "reference-screenshot-evidence", "image-comparison-metrics", "visual-validation-agent-output", "visual-validation-report"];
  return { report, artifactIds: persisted, referenceSource: seeded.referenceSource };
}

export async function storeRevalidatedReport(context: CapabilityContext, report: VisualValidationReportV1, stage5ArtifactIds: readonly string[], referenceSource: RevalidationReferenceSource = "refreshed") {
  return writeArtifact(context, { artifactId: FEEDBACK_LOOP_ARTIFACT_IDS.revalidatedReport, artifactType: "feedback.revalidated-visual-report", name: "Revalidated Visual Validation Report", payload: report, summary: { status: report.overallStatus, stage5ArtifactIds: [...stage5ArtifactIds], referenceSource, projectFilesChanged: false } });
}
