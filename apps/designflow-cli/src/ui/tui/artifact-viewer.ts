import type { ArtifactDetail } from "@designflow/product";
import {
  correctionPlanV1Schema,
  designSpecificationSchema,
  designSystemMappingSchema,
  implementationPlanV1Schema,
  implementationValidationReportSchema,
  projectImplementationContextV1Schema,
  proposedFileChangesSchema,
  visualValidationReportV1Schema,
} from "@designflow/sdk";
import type { OutputView, OutputViewerType } from "./model";

export interface TuiArtifactReader {
  readonly read: (output: OutputView) => Promise<ArtifactDetail>;
}

export type ViewerTone = "primary" | "secondary" | "muted" | "success" | "warning" | "danger";

export interface ArtifactViewerLine {
  readonly text: string;
  readonly tone?: ViewerTone;
}

export interface ArtifactViewerMetadata {
  readonly label: string;
  readonly value: string;
}

export interface ArtifactViewerDocument {
  readonly title: string;
  readonly subtitle?: string;
  readonly lines: readonly ArtifactViewerLine[];
  readonly metadata: readonly ArtifactViewerMetadata[];
  readonly unavailable: boolean;
}

const MAX_ITEMS = 24;
const MAX_TEXT = 320;

export function buildArtifactViewerDocument(
  output: OutputView,
  detail: ArtifactDetail | undefined,
): ArtifactViewerDocument {
  const metadata = artifactMetadata(output);
  if (detail?.payload === undefined) {
    return {
      title: output.label,
      lines: [
        { text: "Artifact unavailable", tone: "warning" },
        { text: "DesignFlow could not load this output.", tone: "secondary" },
        { text: "Your workflow was not changed.", tone: "secondary" },
        { text: "Press d for safe technical metadata.", tone: "muted" },
      ],
      metadata,
      unavailable: true,
    };
  }

  const lines = output.viewerType === "unknown"
    ? unknownLines(output)
    : renderByType(output.viewerType, detail.payload);
  return {
    title: output.label,
    subtitle: output.stage,
    lines,
    metadata,
    unavailable: false,
  };
}

function artifactMetadata(output: OutputView): readonly ArtifactViewerMetadata[] {
  const summary = output.artifactSummary;
  return [
    { label: "Stage", value: output.stage },
    { label: "Artifact type", value: output.artifactRef?.type ?? "Unknown" },
    ...(summary?.version === undefined ? [] : [{ label: "Version", value: String(summary.version) }]),
    ...(summary?.status === undefined ? [] : [{ label: "Status", value: summary.status }]),
    ...(summary?.createdBy === undefined ? [] : [{ label: "Created by", value: safeText(summary.createdBy, 120) }]),
    ...(summary?.artifactId === undefined ? [] : [{ label: "Artifact ID", value: safeText(summary.artifactId, 120) }]),
  ];
}

function renderByType(type: OutputViewerType, payload: unknown): readonly ArtifactViewerLine[] {
  switch (type) {
    case "specification": return renderSpecification(payload);
    case "project-analysis": return renderProjectAnalysis(payload);
    case "component-mapping": return renderComponentMapping(payload);
    case "proposal": return renderProposal(payload);
    case "validation": return renderValidation(payload);
    case "visual-validation": return renderVisualValidation(payload);
    case "correction": return renderCorrection(payload);
    case "unknown": return unknownLines();
  }
}

function renderSpecification(payload: unknown): readonly ArtifactViewerLine[] {
  const parsed = designSpecificationSchema.safeParse(payload);
  if (!parsed.success) return summaryLines(payload, ["fileKey", "documentVersion", "resolvedFrameCount", "componentCount", "ambiguityCount", "screenshotCount"]);
  const value = parsed.data;
  const lines: ArtifactViewerLine[] = [];
  section(lines, "Source");
  key(lines, "Design file", value.sourceIdentity.designFile);
  optionalKey(lines, "File key", value.sourceIdentity.fileKey);
  optionalKey(lines, "Document version", value.sourceIdentity.documentVersion);
  section(lines, "Frames");
  list(lines, value.frames);
  section(lines, "Structure");
  list(lines, value.hierarchy.map((node) => node.name));
  section(lines, "Components");
  list(lines, value.components.map((component) => `${component.name}${component.role === undefined ? "" : ` — ${component.role}`}${component.reusableAssessment === undefined ? "" : ` (${component.reusableAssessment})`}`));
  section(lines, "Design details");
  list(lines, [
    ...value.layoutBehavior,
    ...value.responsiveAssumptions,
    ...value.interactions,
    ...value.states,
  ]);
  section(lines, "Design tokens");
  list(lines, [
    ...value.designTokens.colors.map((item) => `Color: ${item}`),
    ...value.designTokens.spacing.map((item) => `Spacing: ${item}`),
    ...value.designTokens.typography.map((item) => `Typography: ${item}`),
    ...value.designTokens.radii.map((item) => `Radius: ${item}`),
    ...value.designTokens.borders.map((item) => `Border: ${item}`),
    ...value.designTokens.shadows.map((item) => `Shadow: ${item}`),
  ]);
  section(lines, "Content");
  list(lines, value.content);
  section(lines, "Accessibility");
  list(lines, value.accessibilityNotes);
  section(lines, "Open questions");
  list(lines, value.ambiguities.map((item) => item.description));
  return lines;
}

function renderProjectAnalysis(payload: unknown): readonly ArtifactViewerLine[] {
  const parsed = projectImplementationContextV1Schema.safeParse(payload);
  if (!parsed.success) return summaryLines(payload, ["framework", "language", "packageManager", "sourceRoot"]);
  const value = parsed.data;
  const lines: ArtifactViewerLine[] = [];
  section(lines, "Runtime");
  key(lines, "Framework", value.runtime.framework);
  optionalKey(lines, "Framework version", value.runtime.frameworkVersion);
  key(lines, "Language", value.runtime.language);
  key(lines, "Package manager", value.runtime.packageManager);
  section(lines, "Structure");
  list(lines, [...value.structure.sourceRoots.map((item) => `Source: ${item}`), ...value.structure.routeRoots.map((item) => `Route: ${item}`)]);
  section(lines, "Relevant files");
  list(lines, [...value.designSystem.componentSources.map((item) => item.path), ...value.designSystem.tokenSources.map((item) => item.path)]);
  section(lines, "Reusable components");
  list(lines, value.designSystem.components.filter((item) => item.safeToReuse).map((item) => `${item.name} → ${item.sourcePath}`));
  section(lines, "Styling");
  list(lines, value.styling.strategies);
  section(lines, "Available checks");
  list(lines, Object.values(value.commands).filter((command): command is NonNullable<typeof command> => command !== undefined).map((command) => command.name));
  section(lines, "Warnings");
  list(lines, value.warnings.map((item) => item.message), "warning");
  return lines;
}

function renderComponentMapping(payload: unknown): readonly ArtifactViewerLine[] {
  const parsed = designSystemMappingSchema.safeParse(payload);
  if (!parsed.success) return summaryLines(payload, ["unresolved"]);
  const value = parsed.data;
  const lines: ArtifactViewerLine[] = [];
  section(lines, "Components");
  list(lines, value.componentMappings.map((item) => `${item.designComponentId} → ${item.projectComponentReference ?? item.action} (${item.action})`));
  section(lines, "Tokens");
  list(lines, value.tokenMappings.map((item) => `${item.designTokenId} → ${item.projectTokenReference ?? item.action} (${item.action})`));
  section(lines, "Assets");
  list(lines, value.assetMappings.map((item) => `${item.designAssetId} → ${item.projectAssetReference ?? item.action} (${item.action})`));
  section(lines, "Unresolved");
  list(lines, value.unresolved.map((item) => item.description), "warning");
  return lines;
}

function renderProposal(payload: unknown): readonly ArtifactViewerLine[] {
  const proposal = proposedFileChangesSchema.safeParse(payload);
  if (proposal.success) {
    const lines: ArtifactViewerLine[] = [];
    section(lines, "Files");
    list(lines, proposal.data.files.map((file) => `${capitalize(file.action)} ${file.path}`));
    section(lines, "Packages");
    list(lines, proposal.data.packageChanges.map((change) => `${capitalize(change.action)} ${change.packageName}${change.requestedVersion === undefined ? "" : ` @ ${change.requestedVersion}`}`));
    section(lines, "Requested checks");
    list(lines, proposal.data.commandsRequested.map((command) => `${command.name}${command.required ? " (required)" : ""}`));
    section(lines, "Assumptions");
    list(lines, proposal.data.assumptions);
    section(lines, "Unresolved items");
    list(lines, proposal.data.unresolvedItems, "warning");
    lines.push({ text: "Full diff available during review.", tone: "muted" });
    return lines;
  }
  const plan = implementationPlanV1Schema.safeParse(payload);
  if (plan.success) {
    const lines: ArtifactViewerLine[] = [];
    section(lines, "Objective");
    lines.push({ text: safeText(plan.data.objective), tone: "primary" });
    optionalKey(lines, "Destination", plan.data.targetRoute);
    section(lines, "Files");
    list(lines, plan.data.proposedFileActions.map((file) => `${capitalize(file.action)} ${file.path}`));
    section(lines, "Reuse");
    list(lines, [...plan.data.reuseComponents.map((item) => `Component: ${item}`), ...plan.data.reuseTokens.map((item) => `Token: ${item}`)]);
    section(lines, "Validation plan");
    list(lines, plan.data.validationPlan);
    section(lines, "Assumptions");
    list(lines, plan.data.assumptions);
    return lines;
  }
  return summaryLines(payload, ["createCount", "modifyCount", "moduleValidation", "reachableChangedFiles", "unreachableChangedFiles"]);
}

function renderValidation(payload: unknown): readonly ArtifactViewerLine[] {
  const parsed = implementationValidationReportSchema.safeParse(payload);
  if (!parsed.success) return summaryLines(payload, ["passed", "rollbackTriggered", "warnings"]);
  const lines: ArtifactViewerLine[] = [];
  section(lines, "Checks");
  for (const check of parsed.data.checks.slice(0, MAX_ITEMS)) {
    lines.push({ text: `${markerFor(check.status)} ${check.name}: ${check.summary}`, tone: check.status === "passed" ? "success" : check.status === "failed" ? "danger" : "warning" });
  }
  key(lines, "Overall", parsed.data.passed ? "Passed" : "Needs attention", parsed.data.passed ? "success" : "danger");
  key(lines, "Project files", parsed.data.rollbackTriggered ? "Restored after validation" : "No files changed yet");
  section(lines, "Warnings");
  list(lines, parsed.data.warnings, "warning");
  return lines;
}

function renderVisualValidation(payload: unknown): readonly ArtifactViewerLine[] {
  const parsed = visualValidationReportV1Schema.safeParse(payload);
  if (!parsed.success) return summaryLines(payload, ["overallStatus", "comparisonMode", "confidence"]);
  const value = parsed.data;
  const lines: ArtifactViewerLine[] = [];
  key(lines, "Result", value.overallStatus.replace(/_/g, " "), value.overallStatus === "pass" ? "success" : value.overallStatus === "inconclusive" || value.overallStatus === "unavailable" ? "warning" : "primary");
  key(lines, "Comparison", value.comparisonMode);
  key(lines, "Confidence", `${Math.round(value.confidence * 100)}%`);
  section(lines, "Reachability");
  list(lines, value.viewportResults.map((item) => `${item.viewport.id}: ${item.status.replace(/_/g, " ")}`));
  section(lines, "Findings");
  list(lines, value.findings.map((finding) => `${capitalize(finding.severity)}: ${finding.explanation}`), "warning");
  section(lines, "Limitations");
  list(lines, [...value.limitations, ...value.captureWarnings], "warning");
  return lines;
}

function renderCorrection(payload: unknown): readonly ArtifactViewerLine[] {
  const planPayload = asRecord(payload)?.plan ?? payload;
  const plan = correctionPlanV1Schema.safeParse(planPayload);
  if (plan.success) {
    const lines: ArtifactViewerLine[] = [];
    section(lines, "Reason");
    lines.push({ text: safeText(plan.data.objective), tone: "primary" });
    key(lines, "Iteration", String(plan.data.iterationNumber));
    section(lines, "Files");
    list(lines, plan.data.filesExpectedToChange.map((path) => `Modify ${path}`));
    section(lines, "Validation");
    list(lines, plan.data.validationCommands);
    section(lines, "Risks");
    list(lines, [...plan.data.risks, ...plan.data.limitations], "warning");
    return lines;
  }
  const value = asRecord(payload);
  if (value !== undefined && Array.isArray(value.changes)) {
    const lines: ArtifactViewerLine[] = [];
    section(lines, "Changes");
    list(lines, value.changes.flatMap((item) => {
      const change = asRecord(item);
      return change === undefined || typeof change.relativePath !== "string" ? [] : [`${capitalize(String(change.operation ?? "change"))} ${change.relativePath}`];
    }));
    return lines;
  }
  return summaryLines(payload, ["finalStatus", "stopReason", "iterationLimit", "totalFilesChanged"]);
}

function unknownLines(output?: OutputView): readonly ArtifactViewerLine[] {
  const type = output?.artifactRef?.type;
  const status = output?.artifactSummary?.status;
  return [
    ...(type === undefined ? [] : [{ text: `Type: ${safeText(type, 120)}`, tone: "secondary" as const }]),
    ...(status === undefined ? [] : [{ text: `Status: ${safeText(status, 120)}`, tone: "secondary" as const }]),
    { text: "This output does not yet have a dedicated viewer.", tone: "secondary" },
    { text: "Press d for safe technical metadata.", tone: "muted" },
  ];
}

function summaryLines(payload: unknown, fields: readonly string[]): readonly ArtifactViewerLine[] {
  const value = asRecord(payload);
  if (value === undefined) return unknownLines();
  const lines: ArtifactViewerLine[] = [];
  for (const field of fields) {
    const item = value[field];
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") key(lines, humanize(field), typeof item === "string" ? item.replace(/_/g, " ") : String(item));
    else if (Array.isArray(item) && item.every((entry) => typeof entry === "string")) list(lines, item as string[]);
  }
  return lines.length === 0 ? unknownLines() : lines;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function section(lines: ArtifactViewerLine[], title: string): void {
  if (lines.length > 0) lines.push({ text: "", tone: "muted" });
  lines.push({ text: title, tone: "primary" });
}

function key(lines: ArtifactViewerLine[], label: string, value: string, tone: ViewerTone = "secondary"): void {
  lines.push({ text: `${label}: ${safeText(value)}`, tone });
}

function optionalKey(lines: ArtifactViewerLine[], label: string, value: string | undefined): void {
  if (value !== undefined) key(lines, label, value);
}

function list(lines: ArtifactViewerLine[], values: readonly string[], tone: ViewerTone = "secondary"): void {
  for (const value of values.slice(0, MAX_ITEMS)) lines.push({ text: `• ${safeText(value)}`, tone });
  if (values.length > MAX_ITEMS) lines.push({ text: `… ${values.length - MAX_ITEMS} more`, tone: "muted" });
}

function markerFor(status: string): string {
  return status === "passed" ? "✓" : status === "failed" ? "✕" : status === "skipped" ? "○" : "!";
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}

function humanize(value: string): string {
  return capitalize(value.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`).replace(/[-_]/g, " "));
}

function safeText(value: string, limit: number = MAX_TEXT): string {
  return stripControlCharacters(value)
    .replace(/(?:bearer\s+|api[_-]?key\s*[=:]\s*)[^\s,;]+/gi, "[redacted]")
    .slice(0, limit);
}

function stripControlCharacters(value: string): string {
  return Array.from(value).filter((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code >= 32 && code !== 127;
  }).join("");
}
