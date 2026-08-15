// apps/designflow-cli/src/services/failure-presentation.ts
import type { ModelCandidateFailure, ProposalAttemptDiagnostic } from "@designflow/sdk";
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
  /** Bounded sanitized engine failure message, exactly as persisted. */
  readonly underlyingMessage?: string | undefined;
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
  /** Ordered-model-policy provenance when a candidate chain was exhausted. */
  readonly modelCandidates?: readonly ModelCandidateFailure[] | undefined;
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
    // ── Current V2 flagship outcomes (V2-9). Deterministic typed failures;
    //    technical codes stay in Details. ──
    case "ERR_PROJECT_MAPPER_UNAVAILABLE":
      return {
        title: "Implementation could not be safely planned.",
        summary: "DesignFlow AI could not run Project Mapper.",
        // Deliberately "check AI status", not "check AI sign-in": a
        // connected, signed-in session can still reach this state if the
        // managed gateway has no route configured for the role (V2-10 field
        // defect, executionId 0506a14f-a052-4ff7-a0ce-95ad40126677) — the
        // recovery hint must not imply the cause is always authentication.
        recovery: ["No files were changed.", "Try again, or check AI status from the menu."],
      };
    // `ERR_UI_BUILDER_UNAVAILABLE` means the AI service itself could not run
    // UI Builder (no builder configured, or every model candidate
    // exhausted) — the same class of infrastructure failure as Project
    // Mapper's, and presented the same way rather than as an "attempt
    // limit" the user might read as a project/output-quality problem.
    // `ERR_UI_BUILDER_EXHAUSTED` is the different, legitimate case: the
    // model ran and answered, but never produced a valid proposal within
    // the bounded repair-attempt budget — that keeps its own wording.
    case "ERR_UI_BUILDER_UNAVAILABLE":
      return {
        title: "Implementation unavailable.",
        summary: "DesignFlow AI could not run UI Builder.",
        recovery: ["No files were changed.", "Try again, or check AI status from the menu."],
      };
    case "ERR_UI_BUILDER_EXHAUSTED":
      return {
        title: "Implementation needs another attempt.",
        summary: "DesignFlow couldn't produce a valid implementation within the safe attempt limit.",
        recovery: ["No files were changed.", "Start the run again — your design and destination are kept."],
      };
    case "ERR_IMPLEMENTATION_MAP_UNEXECUTABLE":
      return {
        title: "The implementation plan could not be executed.",
        recovery: ["No files were changed.", "Start the run again from the menu."],
      };
    case "ERR_DESTINATION_BINDING_MISMATCH":
      return {
        title: "The plan did not match your chosen destination.",
        summary: "Your destination decision is binding; DesignFlow stopped rather than placing the design somewhere else.",
        recovery: ["No files were changed.", "Choose the destination again and start the run."],
      };
    case "ERR_VISUAL_RESULT_NOT_FINALIZABLE":
      return {
        title: "Visual verification couldn't be completed.",
        summary: "The implementation was not sent for approval.",
        recovery: ["No files were changed.", "Fix browser or preview support if needed, then run again."],
      };
    case "ERR_CONVERGENCE_NOT_SELECTABLE":
      return {
        title: "No safe implementation could be selected.",
        recovery: ["No files were changed.", "Start the run again from the menu."],
      };
    case "ERR_PROJECT_CHANGED":
    case "ERR_PROJECT_FINGERPRINT_CHANGED":
      return {
        title: "Project changed while DesignFlow was working.",
        summary: "The implementation was created against an earlier project state.",
        recovery: ["No DesignFlow changes were applied.", "Run again to generate an implementation against the current project."],
      };
    case "ERR_PROPOSAL_ATTEMPTS_EXHAUSTED":
      return {
        title: "Implementation could not produce a safe change.",
        recovery: [
          "You can start the run again from the menu — your design and destination are kept.",
        ],
      };
    case "ERR_PROPOSED_STATE_WORKSPACE_FAILED":
      return {
        title: "DesignFlow could not validate the proposed change in its temporary workspace.",
        summary: "The proposed code was not the problem — DesignFlow's own validation workspace failed to build the project copy.",
        recovery: [
          "Your project files were not changed.",
          "Start the run again; if this keeps happening, check free disk space and that your temporary directory is writable.",
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

/**
 * Belt-and-braces redaction for the Details surface. Persisted messages are
 * already sanitized at the engine boundary; this strips anything that still
 * looks like a credential before it can render.
 */
export function redactDetailLine(line: string): string {
  return line
    .replace(/\b(token|secret|password|api[-_]?key|authorization|bearer|cookie)\b(\s*[:=]\s*|\s+)\S+/gi, "$1$2[redacted]")
    .replace(/\b(sk-[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_.-]{10,})\b/g, "[redacted]");
}

/**
 * The candidate chain, one indented block per attempted model.
 *
 * "Candidates tried: a (CODE) → b (CODE)" said which models failed but not
 * why or for how long — three identical `ERR_MODEL_UNAVAILABLE`s read as one
 * outage when they can be three different fixable causes. Every line here is
 * already bounded and sanitized upstream and is redacted again on the way out.
 */
function modelCandidateLines(
  candidates: readonly ModelCandidateFailure[] | undefined,
): string[] {
  if (candidates === undefined || candidates.length === 0) return [];
  const lines = ["Candidates tried"];
  candidates.slice(0, 8).forEach((candidate, index) => {
    lines.push(`  ${index + 1}. ${redactDetailLine(candidate.model)}`);
    lines.push(`     ${candidate.code}`);
    if (candidate.durationMs !== undefined) {
      lines.push(`     Duration: ${Math.round(candidate.durationMs)}ms`);
    }
    if (candidate.reason !== undefined && candidate.reason.trim().length > 0) {
      lines.push(`     Reason: ${redactDetailLine(candidate.reason.slice(0, 300))}`);
    }
  });
  return lines;
}

/** Bounded safe facts for the Details action. Never prompts, output, or secrets. */
function technicalDetailLines(facts: ProductFailureFacts): string[] {
  const lines: string[] = [];
  if (facts.errorCode !== undefined) lines.push(`Error code: ${facts.errorCode}`);
  if (facts.failedCapabilityId !== undefined) {
    const label = stageSuffix(facts);
    lines.push(
      label !== undefined
        ? `Failed step: ${label} (${facts.failedCapabilityId})`
        : `Failed step: ${facts.failedCapabilityId}`,
    );
  }
  if (facts.underlyingMessage !== undefined && facts.underlyingMessage.trim().length > 0) {
    lines.push(`Problem: ${redactDetailLine(facts.underlyingMessage.slice(0, 400))}`);
  }
  if (facts.retryAfterSeconds !== undefined) lines.push(`Retry after: ${facts.retryAfterSeconds}s`);
  for (const diagnostic of facts.attemptDiagnostics ?? []) {
    lines.push(
      `Attempt ${diagnostic.attempt}: ${diagnostic.code}` +
        (diagnostic.operation !== undefined ? ` · ${diagnostic.operation}` : "") +
        (diagnostic.path !== undefined ? ` · ${diagnostic.path}` : ""),
    );
    if (diagnostic.message.length > 0) lines.push(`  ${redactDetailLine(diagnostic.message.slice(0, 300))}`);
    if (diagnostic.compileErrorSummary !== undefined) {
      lines.push(`  ${redactDetailLine(diagnostic.compileErrorSummary.slice(0, 600))}`);
    }
  }
  lines.push(...modelCandidateLines(facts.modelCandidates));
  if (facts.executionId !== undefined) lines.push(`Run id: ${facts.executionId}`);
  lines.push(...mutationLines(facts).map((line) => line === "No files were changed." ? "Your project files were not changed." : line));
  return lines;
}

export function renderProductFailure(failure: ProductFailure): string[] {
  return ["", failure.title, ...failure.lines];
}
