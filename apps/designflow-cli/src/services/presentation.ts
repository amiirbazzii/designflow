// apps/designflow-cli/src/services/presentation.ts
import { designRoleName, type DesignRoleId } from "./readiness";

import type { ArtifactSummary } from "@designflow/product";
import { DESIGN_TO_CODE_PRODUCT_STAGES, type FeedbackLoopParentRecordV1 } from "@designflow/sdk";

/**
 * The view model between what a run recorded and what a person reads.
 *
 * Pure by construction — every function here is a projection of values the
 * caller already loaded, so nothing in this file reads a store, a clock, an
 * environment or a filesystem. That is what lets progress, artifacts, traces
 * and the completion screen say the same sentence about the same fact.
 *
 * Two rules hold throughout:
 *
 * **A role is claimed only where an agent was actually invoked.** The five
 * roles map to the five agent-invoking capabilities and nothing else. Every
 * other step is deterministic and is described as a stage, never attributed
 * to anyone.
 *
 * **Nothing is invented.** A field the artifact does not carry produces a
 * "not recorded" line, never a plausible-looking default.
 */

// ── Roles and stages ────────────────────────────────────────────

export interface RoleProducer {
  readonly kind: "role";
  readonly roleId: DesignRoleId;
  /** The role's human name. */
  readonly label: string;
  /** What that role is doing, in one clause. */
  readonly message: string;
}

export interface StageProducer {
  readonly kind: "stage";
  readonly label: string;
  readonly message: string;
}

export type Producer = RoleProducer | StageProducer;

/**
 * The only capabilities that invoke a specialized agent.
 *
 * The coordinator is deliberately absent: its decision happens in the session,
 * before a workflow exists, so no capability in a run belongs to it.
 */
const AGENT_CAPABILITIES: Readonly<Record<string, DesignRoleId>> = {
  "invoke-figma-specification-agent": "specification",
  "invoke-implementation-agent": "implementation",
  "invoke-visual-validation-agent": "visual-validation",
  "invoke-visual-validation-agent-stage5": "visual-validation",
  "invoke-visual-correction-agent": "visual-correction",
  // Current V2 roles (V2-9): the only flagship nodes where an agent runs.
  "map-v2-project": "project-mapper",
  "build-v2-implementation": "ui-builder",
};

const ROLE_MESSAGES: Readonly<Record<DesignRoleId, string>> = {
  "design-interpreter": "interpreting the design's structure",
  "project-mapper": "matching the design to this project",
  "ui-builder": "writing the implementation",
  "visual-critic": "judging the measured differences",
  coordinator: "deciding what to do",
  specification: "reading the design and writing a specification",
  implementation: "planning the implementation",
  "visual-validation": "judging the visual differences",
  "visual-correction": "proposing corrections",
};

/** Deterministic steps, phrased as what the machine did rather than who did it. */
const STAGE_MESSAGES: Readonly<Record<string, string>> = {
  // Current V2 flagship deterministic steps (V2-9). Neutral wording: agents
  // appear only where agents actually run.
  "compile-v2-blueprint": "Understanding the design",
  "compile-v2-project-context": "Understanding the project",
  "run-visual-convergence": "Checking the rendered implementation",
  "assert-v2-finalizable": "Checking the visual result",
  "inspect-finalization-project": "Verifying the project state",
  "resolve-selected-proposal": "Preparing the exact proposal",
  "store-final-review": "Preparing the review",
  "store-finalization-result": "Recording the result",
  "parse-figma-source": "Reading the design source",
  "retrieve-figma-source-snapshot": "Retrieving the design source",
  "prepare-figma-source-fixture": "Preparing the design source",
  "inspect-registered-project": "Inspecting the registered project",
  "map-design-system": "Matching the design system to the project",
  "store-implementation-plan": "Storing the implementation plan",
  "store-proposed-file-changes": "Preparing the proposed changes",
  "request-implementation-approval": "Waiting for your approval",
  "create-project-snapshot": "Taking a rollback snapshot",
  "apply-approved-file-changes": "Applying the approved changes",
  "run-project-validation": "Running the project's own checks",
  "store-generated-implementation": "Recording what was implemented",
  "prepare-visual-validation": "Preparing visual validation",
  "start-preview-server": "Starting a local preview",
  "capture-implementation-screenshots": "Capturing screenshots",
  "resolve-reference-evidence": "Resolving the reference images",
  "store-dom-and-computed-style-evidence": "Collecting layout evidence",
  "compare-visual-evidence": "Comparing the screenshots",
  "store-visual-validation-report": "Storing the visual report",
  "select-actionable-findings": "Selecting findings to act on",
  "prepare-correction-context": "Preparing correction context",
  "store-correction-plan": "Storing the correction plan",
  "store-proposed-correction-changes": "Preparing the proposed corrections",
  "request-correction-approval": "Waiting for your approval",
  "consume-correction-approval": "Consuming the approval",
  "create-correction-snapshot": "Taking a rollback snapshot",
  "apply-approved-correction": "Applying the approved corrections",
  "run-correction-project-validation": "Running the project's own checks",
  "rerun-stage5-visual-validation": "Re-running visual validation",
  "evaluate-feedback-loop": "Evaluating the iteration",
  "store-feedback-loop-input": "Recording the loop input",
  "store-feedback-loop-iteration": "Recording the iteration",
  "normalize-feedback-loop-revalidation-gate": "Checking whether to iterate again",
  "store-stage-2-summary": "Summarizing the design source",
  "store-stage-3-summary": "Summarizing the specification",
  "store-stage-4-summary": "Summarizing the implementation",
  "store-stage-5-summary": "Summarizing visual validation",
  "store-stage-6-summary": "Summarizing the correction loop",
};

/**
 * Who or what a capability is, said the way a reader would say it.
 *
 * `fallbackLabel` is the caller's already-computed de-slugged label — the
 * product layer's `humanizeCapabilityId`. A capability this file does not
 * know keeps that label rather than printing a raw identifier, so adding a
 * capability upstream degrades to plain English instead of leaking an id.
 */
export function describeCapability(
  capabilityId: string,
  fallbackLabel: string,
): Producer {
  const roleId = AGENT_CAPABILITIES[capabilityId];

  if (roleId !== undefined) {
    return {
      kind: "role",
      roleId,
      label: designRoleName(roleId),
      message: ROLE_MESSAGES[roleId],
    };
  }

  return {
    kind: "stage",
    label: STAGE_MESSAGES[capabilityId] ?? fallbackLabel,
    message: STAGE_MESSAGES[capabilityId] ?? fallbackLabel,
  };
}

/** One progress line: a role says who is working, a stage says what is happening. */
export function progressLabel(
  capabilityId: string,
  fallbackLabel: string,
): string {
  const producer = describeCapability(capabilityId, fallbackLabel);

  return producer.kind === "role"
    ? `${producer.label} — ${producer.message}`
    : producer.label;
}

// ── Interactive product progress ───────────────────────────────

export type ProductProgressStage =
  | "Understanding"
  | "Planning"
  | "Building"
  | "Checking"
  | "Refining"
  | "Review"
  | "Applying";

export interface ProductProgressDefinition {
  readonly stage: ProductProgressStage;
  readonly label: string;
}

/**
 * The interactive shell's vocabulary for the Design Engineer journey.
 *
 * This is deliberately a projection of capability ids already present in the
 * progress event stream. The shell never invents future work: a product line
 * is rendered only after its capability has appeared in that stream.
 */
const PRODUCT_PROGRESS_DEFINITIONS: Readonly<
  Record<string, ProductProgressDefinition>
> = {
  "parse-figma-source": { stage: "Understanding", label: "Design loaded" },
  "retrieve-figma-source-snapshot": { stage: "Understanding", label: "Design loaded" },
  "invoke-figma-specification-agent": { stage: "Understanding", label: "Design understood" },
  "inspect-registered-project": { stage: "Understanding", label: "Project understood" },
  "map-design-system": { stage: "Understanding", label: "Existing components matched" },

  "invoke-implementation-agent": { stage: "Building", label: "Preparing implementation" },
  "store-implementation-plan": { stage: "Building", label: "Implementation planned" },
  "store-generated-implementation": { stage: "Building", label: "Implementation prepared" },

  "prepare-visual-validation": { stage: "Checking", label: "Browser checks" },
  "start-preview-server": { stage: "Checking", label: "Browser checks" },
  "capture-implementation-screenshots": { stage: "Checking", label: "Browser checks" },
  "store-dom-and-computed-style-evidence": { stage: "Checking", label: "Browser checks" },
  "resolve-reference-evidence": { stage: "Checking", label: "Visual comparison" },
  "compare-visual-evidence": { stage: "Checking", label: "Visual comparison" },
  "invoke-visual-validation-agent": { stage: "Checking", label: "Visual comparison" },
  "invoke-visual-validation-agent-stage5": { stage: "Checking", label: "Visual comparison" },
  "store-visual-validation-report": { stage: "Checking", label: "Visual comparison" },
  "store-stage-5-summary": { stage: "Checking", label: "Visual comparison" },

  "store-proposed-file-changes": { stage: "Review", label: "Implementation proposal ready" },
  "request-implementation-approval": { stage: "Review", label: "Waiting for approval" },
  "create-project-snapshot": { stage: "Applying", label: "Rollback snapshot ready" },
  "apply-approved-file-changes": { stage: "Applying", label: "Applying approved implementation" },

  // ── Current V2 flagship capabilities (V2-9) ──
  "compile-v2-blueprint": { stage: "Understanding", label: "Design understood" },
  "compile-v2-project-context": { stage: "Understanding", label: "Project understood" },
  "map-v2-project": { stage: "Planning", label: "Destination and components planned" },
  "build-v2-implementation": { stage: "Building", label: "Implementation prepared" },
  "run-visual-convergence": { stage: "Checking", label: "Visual comparison" },
  "assert-v2-finalizable": { stage: "Checking", label: "Visual result" },
  "inspect-finalization-project": { stage: "Review", label: "Preparing review" },
  "resolve-selected-proposal": { stage: "Review", label: "Preparing review" },
  "store-final-review": { stage: "Review", label: "Preparing review" },
  "run-project-validation": { stage: "Applying", label: "Build and validation" },
  "store-finalization-result": { stage: "Applying", label: "Result recorded" },
};

/** Derived from the one canonical SDK product-stage source (V2-9). */
const PRODUCT_PROGRESS_STAGE_ORDER: readonly ProductProgressStage[] =
  DESIGN_TO_CODE_PRODUCT_STAGES.filter((stage) => stage.id !== "done").map(
    (stage) => stage.label as ProductProgressStage,
  );

export function productProgressDefinition(
  capabilityId: string,
): ProductProgressDefinition | undefined {
  return PRODUCT_PROGRESS_DEFINITIONS[capabilityId];
}

function productProgressMarker(status: string): string {
  return status === "done" ? "✓" : status === "active" ? "→" : "○";
}

/**
 * Renders only observed Design Engineer capabilities in product language.
 * Unknown or planner-only pending steps are intentionally omitted because
 * their product meaning is not known here.
 */
export function renderProductProgress(progress: {
  readonly steps: readonly {
    readonly status: string;
    readonly capabilityId?: string | undefined;
  }[];
}): string {
  const groups = new Map<
    ProductProgressStage,
    Array<{ label: string; statuses: string[] }>
  >();

  for (const step of progress.steps) {
    if (step.capabilityId === undefined) continue;
    const definition = productProgressDefinition(step.capabilityId);
    if (definition === undefined) continue;

    const group = groups.get(definition.stage) ?? [];
    const existing = group.find((item) => item.label === definition.label);
    if (existing === undefined) {
      group.push({ label: definition.label, statuses: [step.status] });
    } else {
      existing.statuses.push(step.status);
    }
    groups.set(definition.stage, group);
  }

  if (groups.size === 0) return "Preparing Design Engineer...";

  const lines: string[] = [];
  for (const stage of PRODUCT_PROGRESS_STAGE_ORDER) {
    const group = groups.get(stage);
    if (group === undefined) continue;

    lines.push(stage);
    for (const item of group) {
      const status = item.statuses.includes("active")
        ? "active"
        : item.statuses.every((value) => value === "done")
          ? "done"
          : "pending";
      lines.push(`  ${productProgressMarker(status)} ${item.label}`);
    }
    lines.push("");
  }

  lines.pop();
  return lines.join("\n");
}

export interface ProductRunResultFacts {
  readonly state: string;
  readonly status: string;
  readonly hasImplementation: boolean;
  readonly hasSpecification: boolean;
  readonly hasValidation: boolean;
  readonly validationFailed: boolean;
  readonly rollbackTriggered: boolean;
}

/** A bounded, product-level completion view for the interactive shell. */
export function renderProductRunResult(facts: ProductRunResultFacts): string[] {
  if (facts.status === "rejected") {
    return [
      "",
      "Changes rejected",
      "",
      "No files were changed.",
    ];
  }

  if (facts.status === "cancelled") {
    return [
      "",
      "Cancelled",
      "",
      "The Design Engineer run was cancelled before it finished.",
      "No further work was started.",
    ];
  }

  if (facts.state === "ready") {
    const lines = ["", "Complete", ""];
    if (facts.hasImplementation) lines.push("✓ Implementation prepared");
    else if (facts.hasSpecification) lines.push("✓ Design specification prepared");
    if (facts.hasValidation) lines.push("✓ Validation completed");
    lines.push("", "Ready for review");
    return lines;
  }

  const lines = [
    "",
    "Implementation stopped",
    "",
    facts.validationFailed
      ? "The proposed change could not pass validation."
      : "The Design Engineer run did not complete.",
  ];

  if (facts.rollbackTriggered) {
    lines.push("DesignFlow restored the project to its previous state.");
  } else if (!facts.hasImplementation) {
    lines.push("No files were changed.");
  } else {
    lines.push("Review the run before continuing.");
  }

  lines.push("", "Run `designflow traces` for technical details.");
  return lines;
}

// ── Artifact stage grouping ─────────────────────────────────────

export interface ArtifactGroup {
  readonly stage: string;
  readonly artifacts: readonly ArtifactSummary[];
}

/**
 * Which product stage each artifact belongs to.
 *
 * Keyed by artifact id, which is the run's own vocabulary — not by workflow
 * id, and not by the order things happened to arrive.
 */
const ARTIFACT_STAGES: Readonly<Record<string, string>> = {
  // ── Current V2 flagship artifacts, canonical stage labels (V2-9) ──
  "ui-blueprint": "Understanding",
  "project-context": "Understanding",
  "implementation-map": "Planning",
  "builder-proposal": "Building",
  "visual-convergence": "Checking",
  "v2-finalization-eligibility": "Checking",
  "v2-final-review": "Review",
  "v2-finalization-result": "Applying",
  // ── Historical (legacy architecture) grouping — compatibility only ──
  "parsed-figma-source": "Design source",
  "figma-source-snapshot": "Design source",
  "stage-2-summary": "Design source",

  "design-specification": "Design specification",
  "stage-3-summary": "Design specification",

  "project-implementation-context": "Project analysis",
  "design-system-mapping": "Project analysis",

  "implementation-agent-output": "Implementation",
  "implementation-plan": "Implementation",
  "proposed-file-changes": "Implementation",

  "implementation-approval": "Approval and apply",
  "project-snapshot": "Approval and apply",
  "file-application-result": "Approval and apply",
  "implementation-validation": "Approval and apply",
  "generated-implementation": "Approval and apply",
  "stage-4-summary": "Approval and apply",

  "visual-validation-input": "Visual validation",
  "preview-runtime-record": "Visual validation",
  "implementation-screenshot-evidence": "Visual validation",
  "reference-screenshot-evidence": "Visual validation",
  "dom-and-computed-style-evidence": "Visual validation",
  "image-comparison-metrics": "Visual validation",
  "visual-validation-agent-output": "Visual validation",
  "visual-validation-report": "Visual validation",
  "stage-5-summary": "Visual validation",

  "actionable-finding-selection": "Visual correction",
  "correction-context": "Visual correction",
  "correction-agent-output": "Visual correction",
  "correction-plan": "Visual correction",
  "proposed-correction-changes": "Visual correction",
  "correction-approval-binding": "Visual correction",
  "consumed-correction-approval": "Visual correction",
  "correction-snapshot": "Visual correction",
  "correction-application-result": "Visual correction",
  "correction-project-validation": "Visual correction",
  "feedback-loop-input": "Visual correction",
  "feedback-loop-iteration": "Visual correction",
  "feedback-loop-revalidation-gate": "Visual correction",
  "feedback-loop-revalidation-output": "Visual correction",
  "feedback-loop-report": "Visual correction",
  "stage-6-summary": "Visual correction",
};

const STAGE_ORDER: readonly string[] = [
  // Canonical V2 stage labels first (derived vocabulary)…
  ...DESIGN_TO_CODE_PRODUCT_STAGES.filter((stage) => stage.id !== "done").map((stage) => stage.label),
  // …then the historical legacy groupings, for old runs only.
  "Design source",
  "Design specification",
  "Project analysis",
  "Implementation",
  "Approval and apply",
  "Visual validation",
  "Visual correction",
];

/**
 * Groups a run's artifacts by product stage, in stage order.
 *
 * Returns `null` when no artifact belongs to a known stage — a run that is
 * not the design journey (a QA review, say) has no stages to group by, and a
 * single group called "Other" would be a worse list than a plain list. The
 * caller falls back to the flat listing in that case.
 */
export function groupArtifactsByStage(
  artifacts: readonly ArtifactSummary[],
): readonly ArtifactGroup[] | null {
  const known = artifacts.filter(
    (artifact) => ARTIFACT_STAGES[artifact.artifactId] !== undefined,
  );

  if (known.length === 0) return null;

  const groups: ArtifactGroup[] = [];

  for (const stage of STAGE_ORDER) {
    const members = known.filter(
      (artifact) => ARTIFACT_STAGES[artifact.artifactId] === stage,
    );
    if (members.length > 0) groups.push({ stage, artifacts: members });
  }

  const rest = artifacts.filter(
    (artifact) => ARTIFACT_STAGES[artifact.artifactId] === undefined,
  );
  if (rest.length > 0) groups.push({ stage: "Other output", artifacts: rest });

  return groups;
}

/**
 * Artifacts whose payload is captured image or DOM evidence.
 *
 * Their bodies are bytes, not prose: a screenshot payload printed to a
 * terminal is a wall of base64 that helps nobody and scrolls away everything
 * that did. Listing views never print any payload; this marks the ones whose
 * *detail* view substitutes a description for the body.
 */
const EVIDENCE_ARTIFACT_IDS: readonly string[] = [
  "implementation-screenshot-evidence",
  "reference-screenshot-evidence",
  "dom-and-computed-style-evidence",
];

export function isEvidenceArtifact(artifactId: string): boolean {
  return EVIDENCE_ARTIFACT_IDS.includes(artifactId);
}

// ── Provenance ──────────────────────────────────────────────────

export interface ProvenanceFacts {
  readonly agentVersion?: string;
  readonly modelProfileId?: string;
  readonly providerId?: string;
  readonly model?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Pulls whatever provenance an artifact payload happens to carry.
 *
 * Two shapes exist in stored artifacts and both are read: a nested
 * `agent: { version, modelProfileId }` and the flat `agentVersion` /
 * `modelProfileId` pair. Anything else yields nothing, which is the honest
 * answer for an artifact written before these fields existed.
 */
export function readProvenanceFacts(payload: unknown): ProvenanceFacts {
  if (!isRecord(payload)) return {};

  const nested = isRecord(payload["agent"]) ? payload["agent"] : undefined;

  const agentVersion =
    (nested !== undefined ? readText(nested, "version") : undefined) ??
    readText(payload, "agentVersion");

  const modelProfileId =
    (nested !== undefined ? readText(nested, "modelProfileId") : undefined) ??
    readText(payload, "modelProfileId");

  return {
    ...(agentVersion !== undefined ? { agentVersion } : {}),
    ...(modelProfileId !== undefined ? { modelProfileId } : {}),
  };
}

/**
 * The provenance lines for one artifact.
 *
 * A deterministic producer says so and stops — attaching a model profile to a
 * step that never consulted a model would be a fabricated audit trail. An
 * agent-produced artifact that records nothing says that too, rather than
 * borrowing a default from somewhere else in the run.
 */
export function describeProvenance(
  createdBy: string | undefined,
  facts: ProvenanceFacts,
): readonly string[] {
  if (createdBy === undefined) {
    return ["Producer details: not recorded in this artifact version."];
  }

  const producer = describeCapability(createdBy, createdBy);

  if (producer.kind === "stage") {
    return [`Produced by: ${producer.label} (deterministic step)`];
  }

  const lines = [`Produced by: ${producer.label}`];

  if (facts.agentVersion !== undefined) lines.push(`Agent version: ${facts.agentVersion}`);
  if (facts.modelProfileId !== undefined) lines.push(`Model profile: ${facts.modelProfileId}`);
  if (facts.providerId !== undefined) lines.push(`Provider: ${facts.providerId}`);
  if (facts.model !== undefined) lines.push(`Model: ${facts.model}`);

  if (lines.length === 1) {
    lines.push("Producer details: not recorded in this artifact version.");
  }

  return lines;
}

// ── Related executions ──────────────────────────────────────────

export interface RelatedExecution {
  readonly executionId: string;
  /** "Iteration 2" for a feedback loop, else a neutral child label. */
  readonly label: string;
  /** Only what the record actually holds — never a guess. */
  readonly detailLines: readonly string[];
}

/**
 * A feedback-loop parent's iterations, from the persisted parent record.
 *
 * Every fact comes out of the stored iteration: its number, its status, how
 * many approvals it consumed, whether a rollback happened and whether a
 * visual report was produced. Nothing is inferred from timestamps or from the
 * order records happen to sit in.
 */
export function projectFeedbackLoopIterations(
  record: FeedbackLoopParentRecordV1,
): readonly RelatedExecution[] {
  return record.iterations.map((iteration) => {
    const detailLines: string[] = [`Status: ${iteration.status.replace(/_/g, " ")}`];

    if (iteration.stopReason !== undefined) {
      detailLines.push(`Reason: ${iteration.stopReason}`);
    }

    if (iteration.approvalIds.length > 0) {
      detailLines.push(`Approvals: ${iteration.approvalIds.length}`);
    }

    if (iteration.rollbackArtifactIds.length > 0) {
      detailLines.push("The project was restored from its snapshot.");
    } else if (iteration.applicationArtifactIds.length > 0) {
      detailLines.push("Corrections were applied to the project.");
    }

    if (iteration.validationArtifactIds.length > 0) {
      detailLines.push("The project's own checks ran.");
    }

    if (iteration.visualReportArtifactIds.length > 0) {
      detailLines.push(
        `Findings resolved: ${iteration.resolvedFindings.length}` +
          `, remaining: ${iteration.remainingFindings.length}` +
          `, introduced: ${iteration.introducedFindings.length}`,
      );
    }

    return {
      executionId: iteration.childExecutionId,
      label: `Iteration ${iteration.iterationNumber}`,
      detailLines,
    };
  });
}

/** What a caller must know about a child run to render it. Structural on purpose. */
export interface ChildExecutionFacts {
  readonly executionId: string;
  readonly workflowName: string;
  readonly statusLabel: string;
  readonly summary?: string;
}

/**
 * Generic child executions, from persisted lineage.
 *
 * The caller resolves which executions name this one as their parent; this
 * only phrases them. An execution that merely ran nearby is not a child and
 * never appears, because nothing here looks at time.
 */
export function projectChildExecutions(
  children: readonly ChildExecutionFacts[],
): readonly RelatedExecution[] {
  return children.map((child) => ({
    executionId: child.executionId,
    label: child.workflowName,
    detailLines: [
      `Status: ${child.statusLabel}`,
      ...(child.summary !== undefined ? [child.summary] : []),
    ],
  }));
}

// ── Final summaries ─────────────────────────────────────────────

export type RunOutcome =
  | "applied"
  | "specification-only"
  | "artifacts-only"
  | "nothing-applied"
  | "rolled-back"
  | "rejected"
  | "cancelled";

export interface RunOutcomeFacts {
  readonly state: string;
  readonly status: string;
  readonly hasApplication: boolean;
  readonly hasSpecification: boolean;
  readonly hasNamedArtifacts: boolean;
  readonly rollbackTriggered: boolean;
  readonly approvalRejected: boolean;
}

/**
 * What a finished run came to, derived from artifacts and execution state.
 *
 * Never from the workflow id: two runs of the same workflow can end in
 * opposite places, and a summary that reads the name instead of the result
 * would describe the wrong one confidently.
 */
export function classifyRunOutcome(facts: RunOutcomeFacts): RunOutcome {
  if (facts.approvalRejected) return "rejected";
  if (facts.status === "cancelled") return "cancelled";
  if (facts.rollbackTriggered) return "rolled-back";
  if (facts.hasApplication) return "applied";
  if (facts.state !== "ready") return "nothing-applied";
  if (facts.hasSpecification) return "specification-only";
  if (facts.hasNamedArtifacts) return "artifacts-only";
  return "nothing-applied";
}

/** Visual validation only says what the stage-5 summary recorded. */
export type VisualOutcome = "passed" | "findings" | "failed" | "inconclusive" | "unavailable";

export function classifyVisualOutcome(overallStatus: unknown): VisualOutcome {
  if (typeof overallStatus !== "string") return "unavailable";

  switch (overallStatus) {
    case "pass":
    case "passed":
      return "passed";
    case "pass_with_findings":
      return "findings";
    case "fail":
    case "failed":
      return "failed";
    case "inconclusive":
      return "inconclusive";
    default:
      return "unavailable";
  }
}

export function describeVisualOutcome(outcome: VisualOutcome): string {
  switch (outcome) {
    case "passed":
      return "Visual validation passed.";
    case "findings":
      return "Visual validation passed with findings.";
    case "failed":
      return "Visual validation found differences.";
    case "inconclusive":
      return "Visual validation was inconclusive.";
    case "unavailable":
      return "Visual validation recorded no overall status.";
  }
}
