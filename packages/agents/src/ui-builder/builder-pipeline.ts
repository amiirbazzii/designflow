// packages/agents/src/ui-builder/builder-pipeline.ts
//
// The bounded build: generate → enforce → cover → reach → validate.
//
//   attempt 1 ─┐
//   attempt 2 ─┼─ each one checked deterministically; only a proposal that
//   attempt 3 ─┘  passes every gate is ever returned
//
// Three attempts total, matching the limit the legacy proposal loop already
// established — this introduces no new retry budget. Every attempt receives
// the same immutable Implementation Map: failure feedback says "fix your
// implementation", never "choose a different plan", and an attempt that
// silently switched reuse to create fails map enforcement rather than being
// rewarded for it.
//
// Proposed-state validation (the isolated workspace, the project's real
// build) lives in `@designflow/capability-implementation` and is injected —
// the agents package must not depend on a capability package, and this file
// must not become a second place that knows how to compile a project.
import type { CanonicalProjectContext, ImplementationMap, ProposedFileChanges, UIBlueprint } from "@designflow/sdk";

import { compileUIBuilderEvidence, type BuilderEvidenceBundle } from "./builder-evidence-compiler";
import type { BuilderSourceExcerpt } from "./builder-source-selection";
import { enforceImplementationMap, type MapViolation } from "./map-enforcement";
import { checkReachability, deriveBuilderCoverage, type BuilderCoverageResult, type ReachabilityResult } from "./builder-coverage";
import {
  buildFeedback,
  coverageFeedback,
  reachabilityFeedback,
  repairInstruction,
  violationFeedback,
  type BuilderAttemptFailure,
} from "./repair-context";

/** The legacy proposal loop's limit, reused rather than re-invented. */
export const MAX_BUILDER_ATTEMPTS = 3;

export interface ProposedStateOutcome {
  readonly status: "passed" | "failed" | "unavailable";
  readonly diagnostics: readonly string[];
}

export interface BuildImplementationOptions {
  readonly blueprint: UIBlueprint;
  readonly map: ImplementationMap;
  readonly context: CanonicalProjectContext;
  readonly projectId: string;
  readonly baseProjectFingerprint: string;
  readonly sourceExcerpts?: readonly BuilderSourceExcerpt[];
  /** `initial` builds the plan; `visual_repair` fixes measured mismatches in it. */
  readonly mode?: "initial" | "visual_repair";
  /** Host-compiled repair evidence, required to mean anything in repair mode. */
  readonly visualRepairEvidence?: unknown;
  /** Produces one proposal for one bounded request. */
  readonly generate: (evidence: BuilderEvidenceBundle, attempt: number) => Promise<ProposedFileChanges>;
  /** Injected isolated build; absent means the gate is skipped and said to be. */
  readonly validateProposedState?: (proposal: ProposedFileChanges) => Promise<ProposedStateOutcome>;
  readonly maxAttempts?: number;
}

export type BuildStatus = "valid" | "exhausted" | "unavailable" | "map_unexecutable" | "stale_project";

export interface BuildResult {
  readonly status: BuildStatus;
  readonly proposal?: ProposedFileChanges;
  readonly attempts: number;
  readonly failures: readonly BuilderAttemptFailure[];
  readonly violations: readonly MapViolation[];
  readonly coverage?: BuilderCoverageResult;
  readonly reachability?: ReachabilityResult;
  readonly proposedState?: ProposedStateOutcome;
  readonly reason?: string;
  readonly metrics: {
    readonly requestBytes: number;
    readonly relevantFileCount: number;
    readonly proposalBytes: number;
    readonly attemptCount: number;
    readonly mapViolationCount: number;
    readonly coverageRequirementCount: number;
    readonly coverageResolvedCount: number;
    readonly createdFileCount: number;
    readonly modifiedFileCount: number;
  };
}

const UNEXECUTABLE = "ERR_IMPLEMENTATION_MAP_UNEXECUTABLE";

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/**
 * Confirms the source the plan was made against still looks like the source
 * in front of us.
 *
 * Deliberately narrow: it compares the excerpts the host just read to the
 * map's recorded project fingerprint identity, and reports staleness. It does
 * NOT re-implement approval's fingerprint verification — that duplication is
 * already scheduled for consolidation before V2-7, and a fifth copy here is
 * exactly what that consolidation would have to unpick.
 */
function projectLooksStale(map: ImplementationMap, context: CanonicalProjectContext): string | undefined {
  const planned = map.binding.projectFingerprint;
  const current = context.project.contextFingerprint;
  if (planned === undefined || current === undefined) return undefined;
  if (planned === current) return undefined;
  return `The Implementation Map was planned against project state ${planned.slice(0, 12)}…, but the project is now ${current.slice(0, 12)}…`;
}

/** Runs the bounded build. No filesystem writes, ever. */
export async function buildImplementation(options: BuildImplementationOptions): Promise<BuildResult> {
  const maxAttempts = options.maxAttempts ?? MAX_BUILDER_ATTEMPTS;
  const failures: BuilderAttemptFailure[] = [];
  let lastViolations: readonly MapViolation[] = [];
  let lastCoverage: BuilderCoverageResult | undefined;
  let lastReachability: ReachabilityResult | undefined;
  let lastProposedState: ProposedStateOutcome | undefined;
  let requestBytes = 0;
  let relevantFileCount = 0;
  let proposalBytes = 0;

  const metrics = (attempt: number, proposal?: ProposedFileChanges) => ({
    requestBytes,
    relevantFileCount,
    proposalBytes,
    attemptCount: attempt,
    mapViolationCount: lastViolations.length,
    coverageRequirementCount: lastCoverage?.requirementCount ?? 0,
    coverageResolvedCount: lastCoverage?.resolvedCount ?? 0,
    createdFileCount: proposal?.files.filter((file) => file.action === "create").length ?? 0,
    modifiedFileCount: proposal?.files.filter((file) => file.action === "modify").length ?? 0,
  });

  const stale = projectLooksStale(options.map, options.context);
  if (stale !== undefined) {
    return {
      status: "stale_project",
      attempts: 0,
      failures: [],
      violations: [],
      reason: stale,
      metrics: metrics(0),
    };
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const evidence = compileUIBuilderEvidence({
      blueprint: options.blueprint,
      map: options.map,
      context: options.context,
      ...(options.sourceExcerpts !== undefined ? { sourceExcerpts: options.sourceExcerpts } : {}),
      ...(options.mode !== undefined ? { mode: options.mode } : {}),
      ...(options.visualRepairEvidence !== undefined ? { visualRepairEvidence: options.visualRepairEvidence } : {}),
      ...(failures.length > 0 ? { repairFeedback: repairInstruction(failures) } : {}),
    });
    requestBytes = evidence.bytes;
    relevantFileCount = evidence.relevantFileCount;

    let proposal: ProposedFileChanges;
    try {
      proposal = await options.generate(evidence, attempt);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === UNEXECUTABLE) {
        return {
          status: "map_unexecutable",
          attempts: attempt,
          failures,
          violations: lastViolations,
          reason: error instanceof Error ? error.message : "the Implementation Map could not be executed",
          metrics: metrics(attempt),
        };
      }
      // A model that never answered is not a failed implementation.
      return {
        status: "unavailable",
        attempts: attempt,
        failures,
        violations: lastViolations,
        reason: error instanceof Error ? error.message.slice(0, 300) : "the builder model was unavailable",
        metrics: metrics(attempt),
      };
    }

    proposalBytes = byteLength(proposal);

    // 1. The plan is binding.
    lastViolations = enforceImplementationMap(proposal, options.map, options.blueprint);
    if (lastViolations.length > 0) {
      failures.push(violationFeedback(attempt, lastViolations));
      continue;
    }

    // 2. Reachability — a screen nobody can open is not an implementation.
    lastReachability = checkReachability(proposal, options.map);
    if (!lastReachability.reachable) {
      failures.push(reachabilityFeedback(attempt, lastReachability.reason ?? "the screen is not reachable"));
      continue;
    }

    // 3. Host-derived coverage. The model's opinion of its own completeness
    //    is not consulted anywhere in this function.
    lastCoverage = deriveBuilderCoverage(proposal, options.map, options.blueprint);
    if (lastCoverage.missing.length > 0) {
      failures.push(coverageFeedback(attempt, lastCoverage.missing));
      continue;
    }

    // 4. The exact proposed state must compile under the project's own build.
    if (options.validateProposedState !== undefined) {
      lastProposedState = await options.validateProposedState(proposal);
      if (lastProposedState.status === "failed") {
        failures.push(buildFeedback(attempt, lastProposedState.diagnostics));
        continue;
      }
    }

    return {
      status: "valid",
      proposal,
      attempts: attempt,
      failures,
      violations: [],
      coverage: lastCoverage,
      reachability: lastReachability,
      ...(lastProposedState !== undefined ? { proposedState: lastProposedState } : {}),
      metrics: metrics(attempt, proposal),
    };
  }

  return {
    status: "exhausted",
    attempts: maxAttempts,
    failures,
    violations: lastViolations,
    ...(lastCoverage !== undefined ? { coverage: lastCoverage } : {}),
    ...(lastReachability !== undefined ? { reachability: lastReachability } : {}),
    ...(lastProposedState !== undefined ? { proposedState: lastProposedState } : {}),
    reason: "no attempt produced a proposal that satisfied the Implementation Map, coverage, reachability and the project build",
    metrics: metrics(maxAttempts),
  };
}
