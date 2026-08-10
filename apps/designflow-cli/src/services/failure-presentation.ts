// apps/designflow-cli/src/services/failure-presentation.ts
import type { ProposalAttemptDiagnostic } from "@designflow/sdk";
import { describeCapability } from "./presentation";

/**
 * Phase 9 product failure presentation.
 *
 * Maps persisted failure facts — error codes, Phase 7D per-attempt validator
 * diagnostics, and mutation evidence — into a bounded, human-readable failure
 * screen. Pure functions of facts the engine already recorded: nothing here
 * invents details, re-derives safety state, or performs recovery. What is not
 * persisted is not shown.
 */

// ── Facts in ────────────────────────────────────────────────────

export interface ProductFailureFacts {
  readonly status: string;
  readonly errorCode?: string | undefined;
  readonly failedCapabilityId?: string | undefined;
  readonly attemptDiagnostics?: readonly ProposalAttemptDiagnostic[] | undefined;
  readonly retryAfterSeconds?: number | undefined;
  /** Persisted proof that approved files were written. */
  readonly hasApplication: boolean;
  /** Persisted proof a rollback snapshot exists. */
  readonly hasSnapshot: boolean;
  /** The required post-apply validation recorded a failed check. */
  readonly validationFailed: boolean;
  /** The validation record says a rollback was triggered. */
  readonly rollbackTriggered: boolean;
  /** The execution's run id, for support/technical details. */
  readonly executionId?: string | undefined;
}

export interface ProductFailure {
  /** Plain-language headline. */
  readonly title: string;
  /** Body lines: summary, attempts, mutation truth, recovery guidance. */
  readonly lines: readonly string[];
  /** Bounded safe facts shown only behind the Details action. */
  readonly technicalDetails: readonly string[];
}

// ── Curated wording ─────────────────────────────────────────────

/** Curated labels for the deterministic proposal validation codes. */
const VALIDATION_LABELS: Readonly<Record<string, string>> = {
  ERR_PROPOSAL_MODULE_COMPILE_FAILED: "Build check failed",
  ERR_PROPOSAL_TARGET_MISSING: "Proposed file target was invalid",
  ERR_PROPOSAL_TARGET_EXISTS: "Proposed file target was invalid",
  ERR_DUPLICATE_PROPOSAL_ACTION: "Proposed file target was invalid",
  ERR_PROPOSAL_EMPTY_EXECUTABLE_CONTENT:
    "Proposed change did not contain a meaningful implementation",
  ERR_PROPOSAL_NOOP_MODIFY:
    "Proposed change did not contain a meaningful implementation",
  ERR_PROPOSAL_COVERAGE_INCOMPLETE:
    "The proposal did not cover the selected design",
  ERR_PROPOSAL_COVERAGE_INVALID:
    "The proposal did not cover the selected design",
  ERR_UNSAFE_PATH:
    "The proposal tried to change a file outside the allowed project scope",
  ERR_PATH_TRAVERSAL:
    "The proposal tried to change a file outside the allowed project scope",
  ERR_UNSUPPORTED_FILE_TYPE: "Proposed file target was invalid",
  ERR_PROPOSAL_INVALID: "The proposal did not match the required shape",
  ERR_PROPOSAL_TOO_LARGE: "The proposal was too large to review safely",
};

interface CuratedFailure {
  readonly title: string;
  readonly summary?: string;
  readonly recovery: readonly string[];
}

function curatedFor(facts: ProductFailureFacts): CuratedFailure {
  const stage = stageSuffix(facts);

  switch (facts.errorCode) {
    case "ERR_PROPOSAL_ATTEMPTS_EXHAUSTED":
      return {
        title: "Implementation could not produce a safe change.",
        recovery: [
          "You can start the run again from the menu — your design and destination are kept.",
        ],
      };
    case "ERR_MODEL_AUTHENTICATION":
      return {
        title: facts.hasApplication
          ? "AI session expired."
          : "AI sign-in is required.",
        ...(facts.hasApplication
          ? { summary: `Your project changes were already applied successfully, but ${stage ?? "a later step"} could not continue.` }
          : {}),
        recovery: ["Sign in again from the menu, then start the run again."],
      };
    case "ERR_MODEL_RATE_LIMIT":
    case "ERR_MODEL_RATE_LIMITED":
      return {
        title: "Too many requests right now.",
        recovery: [
          facts.retryAfterSeconds !== undefined
            ? `Wait about ${Math.ceil(facts.retryAfterSeconds)} seconds, then try again.`
            : "Wait a moment, then try again.",
        ],
      };
    case "ERR_MODEL_QUOTA_EXCEEDED":
      return {
        title: "DesignFlow usage limit reached.",
        summary: "Retrying now will not help until the limit resets.",
        recovery: [],
      };
    case "ERR_MODEL_SERVICE_UNAVAILABLE":
      return {
        title: "DesignFlow AI is temporarily unavailable.",
        recovery: ["Try again in a few minutes."],
      };
    case "ERR_MODEL_ROUTE_NOT_FOUND":
      return {
        title: "A required DesignFlow AI capability is unavailable.",
        recovery: ["Update DesignFlow, or try again later."],
      };
    case "ERR_FIGMA_SOURCE_INVALID":
      return {
        title: "This Figma link could not be read.",
        recovery: ["Check the URL and paste the Figma frame link again."],
      };
    case "ERR_FIGMA_NODE_NOT_FOUND":
    case "ERR_FIGMA_FRAME_NOT_FOUND":
    case "ERR_FIGMA_FILE_NOT_FOUND":
      return {
        title: "Could not read the design.",
        summary: "The referenced Figma content was not available.",
        recovery: ["Open the referenced Figma file in Figma Desktop and retry."],
      };
    case "ERR_FIGMA_DESKTOP_SELECTION_UNAVAILABLE":
    case "ERR_FIGMA_EVIDENCE_INSUFFICIENT":
      return {
        title: "Could not read enough design data from the current selection.",
        recovery: ["Paste the frame's Figma URL instead of using the current selection."],
      };
    default:
      return {
        title:
          stage !== undefined
            ? facts.hasApplication && !facts.validationFailed
              ? `Changes were applied, but ${stage} could not complete.`
              : `Could not finish ${stage}.`
            : "The Design Engineer run did not complete.",
        recovery: [],
      };
  }
}

/** The failed step in product vocabulary, or undefined when unknown. */
function stageSuffix(facts: ProductFailureFacts): string | undefined {
  if (facts.failedCapabilityId === undefined) return undefined;
  const producer = describeCapability(facts.failedCapabilityId, facts.failedCapabilityId);
  if (producer.label === facts.failedCapabilityId) return undefined;
  return producer.label.toLowerCase();
}

// ── Mutation truth ──────────────────────────────────────────────

function mutationLines(facts: ProductFailureFacts): string[] {
  if (!facts.hasApplication) return ["No files were changed."];
  if (facts.validationFailed && facts.rollbackTriggered) {
    return ["Validation failed.", "Your project was restored from the snapshot."];
  }
  if (facts.validationFailed) {
    return ["Validation failed.", "Rollback needs attention — review your project before continuing."];
  }
  return ["Your approved changes were applied and remain in place."];
}

// ── Attempts ────────────────────────────────────────────────────

function attemptLines(
  diagnostics: readonly ProposalAttemptDiagnostic[],
): string[] {
  const lines: string[] = [];
  for (const diagnostic of diagnostics) {
    lines.push("", `Attempt ${diagnostic.attempt}`);
    lines.push(`  ${VALIDATION_LABELS[diagnostic.code] ?? "Validation failed"}`);
    if (diagnostic.path !== undefined) lines.push(`  ${diagnostic.path}`);
    const detail = diagnostic.compileErrorSummary ?? diagnostic.fact;
    if (detail !== undefined) lines.push(`  ${firstDetailLine(detail)}`);
  }
  return lines;
}

/** One bounded human-relevant line from a compile summary or fact. */
function firstDetailLine(detail: string): string {
  const parts = detail.split(" | ").map((part) => part.trim()).filter((part) => part.length > 0);
  const informative = parts.find((part) => !/^error during build:?$/i.test(part)) ?? parts[0] ?? detail;
  return informative.slice(0, 200);
}

// ── Build ───────────────────────────────────────────────────────

export function buildProductFailure(facts: ProductFailureFacts): ProductFailure {
  const curated = curatedFor(facts);
  const lines: string[] = [];

  if (curated.summary !== undefined) lines.push("", curated.summary);

  if (
    facts.errorCode === "ERR_PROPOSAL_ATTEMPTS_EXHAUSTED" &&
    facts.attemptDiagnostics !== undefined &&
    facts.attemptDiagnostics.length > 0
  ) {
    lines.push(...attemptLines(facts.attemptDiagnostics));
  }

  lines.push("", ...mutationLines(facts));

  if (curated.recovery.length > 0) {
    lines.push("");
    for (const action of curated.recovery) lines.push(action);
  }

  return {
    title: curated.title,
    lines,
    technicalDetails: technicalDetailLines(facts),
  };
}

/** Bounded safe facts for the Details action. Never prompts, output, or secrets. */
function technicalDetailLines(facts: ProductFailureFacts): string[] {
  const lines: string[] = [];
  if (facts.errorCode !== undefined) lines.push(`Error code: ${facts.errorCode}`);
  if (facts.failedCapabilityId !== undefined) lines.push(`Failed step: ${facts.failedCapabilityId}`);
  if (facts.retryAfterSeconds !== undefined) lines.push(`Retry after: ${facts.retryAfterSeconds}s`);
  for (const diagnostic of facts.attemptDiagnostics ?? []) {
    lines.push(
      `Attempt ${diagnostic.attempt}: ${diagnostic.code}` +
        (diagnostic.operation !== undefined ? ` · ${diagnostic.operation}` : "") +
        (diagnostic.path !== undefined ? ` · ${diagnostic.path}` : ""),
    );
    if (diagnostic.message.length > 0) lines.push(`  ${diagnostic.message.slice(0, 300)}`);
    if (diagnostic.compileErrorSummary !== undefined) {
      lines.push(`  ${diagnostic.compileErrorSummary.slice(0, 600)}`);
    }
  }
  if (facts.executionId !== undefined) lines.push(`Run id: ${facts.executionId}`);
  return lines;
}

export function renderProductFailure(failure: ProductFailure): string[] {
  return ["", failure.title, ...failure.lines];
}
