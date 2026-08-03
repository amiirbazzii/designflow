// apps/designflow-demo/src/screens/index.ts
import type {
  ApprovalOutcome,
  ArtifactSummary,
  ExecutionProgress,
  ExecutionReport,
  PendingApproval,
} from "@designflow/product";
import type { DemoWorkflow } from "../catalog";

/**
 * The demo's screens.
 *
 * Every one is a pure function from a product model to a string. No IO, no
 * clock, no engine — which is what lets the behaviour tests assert on exactly
 * what a person would see, and what would let a web UI reuse this layer by
 * swapping the renderer for components.
 */

const RULE = "─".repeat(46);

function heading(title: string): string[] {
  return [title, RULE];
}

// ── Step 1: Landing ──────────────────────────────────────────────

export function renderLanding(workflows: readonly DemoWorkflow[]): string {
  const lines = [
    "DesignFlow",
    "Turn ideas into production workflows.",
    "",
    "Choose a workflow:",
    "",
  ];

  workflows.forEach((workflow, index) => {
    lines.push(`  ${index + 1}. ${workflow.name}`);
    lines.push(`     ${workflow.tagline}`);
  });

  return lines.join("\n");
}

// ── Step 2: Input ────────────────────────────────────────────────

export function renderInputHeading(workflow: DemoWorkflow): string {
  return [...heading(workflow.name), "Tell DesignFlow what to work on.", ""].join(
    "\n",
  );
}

export function renderInputSummary(input: Record<string, unknown>): string {
  const lines = ["", "Starting with:"];

  for (const [key, value] of Object.entries(input)) {
    lines.push(`  ${key}: ${formatValue(value)}`);
  }

  return lines.join("\n");
}

// ── Step 3: Progress ─────────────────────────────────────────────

/**
 * The running checklist.
 *
 * `✓` done, `→` underway, `○` not started — the three states
 * `ExecutionProgress` already distinguishes. The marker is chosen here rather
 * than in the product layer, because glyphs are a rendering decision.
 */
export function renderProgress(
  workflowName: string,
  progress: ExecutionProgress,
): string {
  const lines = [
    ...heading(workflowName),
    progress.completed === progress.total && progress.total > 0
      ? "Complete"
      : "Running",
    "",
  ];

  for (const step of progress.steps) {
    const marker =
      step.status === "done" ? "✓" : step.status === "active" ? "→" : "○";
    lines.push(`  ${marker} ${step.label}`);
  }

  if (progress.total > 0) {
    lines.push("");
    lines.push(`  ${progress.completed} of ${progress.total} steps`);
  }

  return lines.join("\n");
}

// ── Step 4: Approval ─────────────────────────────────────────────

export function renderApproval(approval: PendingApproval): string {
  return [
    ...heading("Approval Required"),
    "DesignFlow wants to:",
    "",
    "  Store the generated result as a DesignFlow artifact",
    "",
    "Reason:",
    "",
    `  ${approval.reason}`,
    "",
  ].join("\n");
}

export function renderApprovalOutcome(outcome: ApprovalOutcome): string {
  return outcome.decision === "approve"
    ? `\nApproved. ${outcome.message}`
    : `\nRejected. ${outcome.message}`;
}

// ── Step 5: Completion ───────────────────────────────────────────

/**
 * The summary a person reads at the end.
 *
 * Every number and line here comes from `WorkflowRunner.explain()` — the demo
 * counts nothing itself, so it cannot disagree with the engine about what
 * happened.
 */
export function renderCompletion(report: ExecutionReport): string {
  const { overview, timeline, artifacts } = report;

  const lines = [
    ...heading(
      overview.state === "ready" ? "Workflow Complete" : "Workflow Stopped",
    ),
    overview.summary,
    "",
  ];

  if (overview.durationLabel !== undefined) {
    lines.push(`Took ${overview.durationLabel}.`, "");
  }

  lines.push("Artifacts");
  lines.push(`  Created: ${overview.artifacts.created}`);
  lines.push(`  Reused:  ${overview.artifacts.reused}`);

  if (overview.artifacts.removed > 0) {
    lines.push(`  Removed: ${overview.artifacts.removed}`);
  }

  lines.push("", "Timeline");
  for (const entry of timeline.entries) {
    lines.push(`  ${entry.at}  ${entry.label}`);
  }

  const named = artifacts.filter(isNamed);

  if (named.length > 0) {
    lines.push("", "Produced");
    for (const artifact of named) {
      lines.push(`  ${artifact.name}  (${artifact.status})`);

      if (artifact.createdBy !== undefined) {
        lines.push(`     by ${artifact.createdBy}`);
      }

      if (artifact.dependencies.length > 0) {
        lines.push(`     from ${artifact.dependencies.join(", ")}`);
      }
    }

    const blobs = artifacts.length - named.length;
    if (blobs > 0) {
      lines.push("", `  (${blobs} stored payloads not listed)`);
    }
  }

  return lines.join("\n");
}

// ── Explanation ──────────────────────────────────────────────────

/** The narrated story, for the "what actually happened?" view. */
export function renderExplanation(report: ExecutionReport): string {
  const lines = [...heading("What DesignFlow did")];

  for (const entry of report.narration) {
    lines.push(`  ${entry.message}`);
  }

  return lines.join("\n");
}

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Whether an artifact is one a person would recognise.
 *
 * A capability that stores a payload registers it under a content hash, and
 * the product layer falls back to the id when no `name` was supplied — so an
 * unnamed artifact is a storage blob rather than an output. Listing those
 * beside "Design tokens" makes the summary unreadable, so they are counted
 * instead of named. Hiding them outright would be worse: the total still has
 * to reconcile with the engine's own count.
 */
function isNamed(artifact: ArtifactSummary): boolean {
  return artifact.name !== artifact.artifactId;
}

function formatValue(value: unknown): string {
  return Array.isArray(value) ? value.join(", ") : String(value);
}
