// packages/agents/src/ui-builder/repair-context.ts
//
// What a failed attempt is allowed to tell the next one.
//
// The distinction this file exists to hold: repair feedback means "fix your
// implementation of the plan", never "pick a different plan". Every attempt
// receives the same immutable Implementation Map, and the feedback carries
// deterministic findings only — codes, paths, bounded messages — so a model
// cannot talk itself into re-planning by re-reading its own prose.
import type { MapViolation } from "./map-enforcement";
import type { BuilderCoverageEntry } from "./builder-coverage";

export type BuilderFailureCode =
  | "ERR_IMPLEMENTATION_MAP_VIOLATION"
  | "ERR_PROPOSED_STATE_BUILD_FAILED"
  | "ERR_V2_COVERAGE_MISSING"
  | "ERR_REACHABILITY_FAILED"
  | "ERR_PROPOSAL_INVALID";

export interface BuilderAttemptFailure {
  readonly attempt: number;
  readonly code: BuilderFailureCode;
  readonly findings: readonly string[];
}

const MAX_FINDINGS = 12;
const MAX_FINDING_LENGTH = 300;

function bound(findings: readonly string[]): readonly string[] {
  return findings.slice(0, MAX_FINDINGS).map((finding) => finding.slice(0, MAX_FINDING_LENGTH));
}

export function violationFeedback(attempt: number, violations: readonly MapViolation[]): BuilderAttemptFailure {
  return {
    attempt,
    code: "ERR_IMPLEMENTATION_MAP_VIOLATION",
    findings: bound(violations.map((violation) => `${violation.code}: ${violation.message}`)),
  };
}

export function coverageFeedback(attempt: number, missing: readonly BuilderCoverageEntry[]): BuilderAttemptFailure {
  return {
    attempt,
    code: "ERR_V2_COVERAGE_MISSING",
    findings: bound(missing.map((entry) => `${entry.label}: ${entry.note ?? "not realized by the proposal"}`)),
  };
}

export function reachabilityFeedback(attempt: number, reason: string): BuilderAttemptFailure {
  return { attempt, code: "ERR_REACHABILITY_FAILED", findings: bound([reason]) };
}

export function buildFeedback(attempt: number, diagnostics: readonly string[]): BuilderAttemptFailure {
  return { attempt, code: "ERR_PROPOSED_STATE_BUILD_FAILED", findings: bound(diagnostics) };
}

/**
 * The feedback handed to the next attempt.
 *
 * Deliberately shaped as instructions about the *implementation*: the plan is
 * restated as immutable so the next attempt cannot read the failure as
 * permission to change it.
 */
export function repairInstruction(failures: readonly BuilderAttemptFailure[]): {
  readonly planIsImmutable: true;
  readonly previousFailures: readonly BuilderAttemptFailure[];
} {
  return { planIsImmutable: true, previousFailures: failures.slice(-2) };
}
