import {
  designSpecificationSchema,
  figmaSourceSnapshotSchema,
  generatedImplementationV1Schema,
  projectImplementationContextV1Schema,
  visualValidationReportV1Schema,
  type CapabilityContext,
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
import { writeArtifact } from "./artifact-io";
import { FEEDBACK_LOOP_ARTIFACT_IDS, type FeedbackLoopWorkflowInput } from "./feedback-loop-types";

type Stage5Ref = { id: string; type: string; metadata: Record<string, unknown> };

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

async function seedStage5Inputs(context: CapabilityContext, input: FeedbackLoopWorkflowInput, initial: VisualValidationReportV1): Promise<Stage5Ref[]> {
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
  const referenceArtifactIds: string[] = [];
  for (const evidence of initial.referenceEvidence) {
    const payload = input.referenceImagePayloads?.[evidence.image.artifactId];
    const stored = payload === undefined ? undefined : await context.artifactStore.save(payload, { type: "validation.reference-image", artifactId: `feedback-reference-${evidence.evidenceId}` });
    referenceArtifactIds.push(stored?.id ?? evidence.image.artifactId);
  }
  const snapshot = figmaSourceSnapshotSchema.parse({
    schemaVersion: "1", source: { designFile: `designflow://feedback-loop/${input.project.id}`, frames: spec.frames, nodeIds: spec.frames },
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
  return refs;
}

/**
 * Executes the existing Stage 5 capabilities in their production order.
 * This is intentionally a runtime composition seam, not a second browser
 * implementation. Every intermediate Stage 5 artifact is persisted.
 */
export async function runFreshStage5Validation(context: CapabilityContext, input: FeedbackLoopWorkflowInput, initial: VisualValidationReportV1): Promise<{ report: VisualValidationReportV1; artifactIds: string[] }> {
  let refs = await seedStage5Inputs(context, input, initial);
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
  return { report, artifactIds: persisted };
}

export async function storeRevalidatedReport(context: CapabilityContext, report: VisualValidationReportV1, stage5ArtifactIds: readonly string[]) {
  return writeArtifact(context, { artifactId: FEEDBACK_LOOP_ARTIFACT_IDS.revalidatedReport, artifactType: "feedback.revalidated-visual-report", name: "Revalidated Visual Validation Report", payload: report, summary: { status: report.overallStatus, stage5ArtifactIds: [...stage5ArtifactIds], projectFilesChanged: false } });
}
