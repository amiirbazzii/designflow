import { visualValidationReportV1Schema, type VisualFindingV1, type VisualValidationReportV1 } from "@designflow/sdk";
import { actionableFindingSelectionSchema, feedbackLoopWorkflowInputSchema, type ActionableFindingSelection, type FeedbackLoopWorkflowInput } from "./feedback-loop-types";

const forbidden = /(^|\/)(\.env(?:\.|$)|\.npmrc|\.pypirc|\.ssh|\.aws|secrets?|credentials?|private[-_.]?key|node_modules|dist|build|\.designflow)(\/|$)|\.(pem|key|p12|pfx)$/i;

function evidenceSet(report: VisualValidationReportV1): Set<string> {
  const values = new Set<string>([...
    report.referenceEvidence.flatMap((evidence) => [evidence.evidenceId, evidence.image.artifactId]),
    ...report.implementationEvidence.flatMap((evidence) => [evidence.evidenceId, evidence.image.artifactId]),
    ...report.viewportResults.flatMap((result) => [...result.implementationEvidenceIds, ...result.referenceEvidenceIds]),
  ]);
  return values;
}

function filesForFinding(finding: VisualFindingV1, input: FeedbackLoopWorkflowInput): string[] {
  const mapped = input.affectedFileMap[finding.findingId] ?? [];
  return mapped.filter((path) => path.length > 0 && !forbidden.test(path) && !path.startsWith("/") && !path.split("/").includes(".."));
}

function isActionable(finding: VisualFindingV1, input: FeedbackLoopWorkflowInput, evidence: Set<string>): boolean {
  if ((finding.severity !== "major" && finding.severity !== "critical") || finding.status === "not-applicable") return false;
  if (finding.category === "capture-error" || finding.origin === "model-interpreted" && (!input.iterationPolicy.modelInterpretedAllowed || finding.confidence < input.iterationPolicy.modelConfidenceThreshold)) return false;
  if (!finding.affectedComponent && !finding.affectedFrame) return false;
  if (finding.evidenceReferences.some((id) => !evidence.has(id) && !id.startsWith("specification:"))) return false;
  if ((finding.category === "size" || finding.category === "layout" || finding.category === "spacing") && (finding.expectedValue === undefined || finding.actualValue === undefined)) return false;
  return filesForFinding(finding, input).length > 0;
}

export function selectActionableFindings(rawReport: unknown, rawInput: unknown): ActionableFindingSelection {
  const report = visualValidationReportV1Schema.parse(rawReport);
  const input = feedbackLoopWorkflowInputSchema.parse(rawInput);
  const evidence = evidenceSet(report);
  const selected = report.findings.filter((finding) => isActionable(finding, input, evidence)).slice(0, input.iterationPolicy.maxFindingsPerIteration);
  const excluded = report.findings.filter((finding) => !selected.some((candidate) => candidate.findingId === finding.findingId)).map((finding) => finding.findingId);
  if (report.overallStatus === "unavailable") return actionableFindingSelectionSchema.parse({ schemaVersion: "1", selectedFindingIds: [], excludedFindingIds: excluded, reason: "Renderer unavailable; correction is not safe.", stopReason: "renderer_unavailable" });
  if (report.overallStatus === "inconclusive" || report.comparisonMode === "insufficient-reference") return actionableFindingSelectionSchema.parse({ schemaVersion: "1", selectedFindingIds: [], excludedFindingIds: excluded, reason: "Visual validation is inconclusive or lacks sufficient reference evidence.", stopReason: "visual_validation_inconclusive" });
  if (selected.length === 0) return actionableFindingSelectionSchema.parse({ schemaVersion: "1", selectedFindingIds: [], excludedFindingIds: excluded, reason: "No findings satisfy deterministic severity, evidence, identity, and scope policy.", stopReason: "no_actionable_findings" });
  return actionableFindingSelectionSchema.parse({ schemaVersion: "1", selectedFindingIds: selected.map((finding) => finding.findingId), excludedFindingIds: excluded, reason: `${selected.length} finding(s) are evidence-bound and within the approved file scope.` });
}

export function selectedFindingRecords(rawReport: unknown, rawInput: unknown, selection: ActionableFindingSelection): VisualFindingV1[] {
  const report = visualValidationReportV1Schema.parse(rawReport);
  const input = feedbackLoopWorkflowInputSchema.parse(rawInput);
  const evidence = evidenceSet(report);
  return selection.selectedFindingIds.map((id) => {
    const finding = report.findings.find((candidate) => candidate.findingId === id);
    if (!finding || !isActionable(finding, input, evidence)) throw new Error(`Finding ${id} is not actionable under the current report and policy.`);
    return finding;
  });
}

export function affectedFilesForFinding(finding: VisualFindingV1, input: FeedbackLoopWorkflowInput): string[] { return filesForFinding(finding, feedbackLoopWorkflowInputSchema.parse(input)); }
