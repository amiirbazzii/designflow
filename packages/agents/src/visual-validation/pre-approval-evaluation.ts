// packages/agents/src/visual-validation/pre-approval-evaluation.ts
//
// The V2-5 evaluation, in one place:
//
//   RenderedState → deterministic deltas → Visual Critic (optional)
//                                        → VisualDeltaReport
//
// Rendering itself is not here and cannot be: it runs a real build and a real
// browser, which belongs to the deterministic workflow package
// (`render-proposed-state.ts`). This function takes the evidence that render
// produced, so the composition root owns the one place where the two meet and
// neither package depends on the other.
//
// The ordering inside is the guarantee. Measurement is evaluated first and
// completely, so the report exists — and has an outcome — before any model is
// asked anything. The Critic is injected and allowed to be absent, unavailable
// or wrong: none of those change the verdict, they only change how well it
// reads.
import {
  DEFAULT_VISUAL_PASS_FAIL_POLICY,
  type ImplementationMap,
  type RenderedState,
  type UIBlueprint,
  type VisualDeltaReport,
} from "@designflow/sdk";

import { applyVisualCriticPatches } from "./critic-patch-merge";
import { compileVisualExpectations } from "./visual-expectation-compiler";
import { evaluateVisualDeltas } from "./visual-delta-evaluator";
import { assembleVisualDeltaReport } from "./visual-delta-report";
import {
  compileCriticEvidence,
  partitionCriticFindings,
  VISUAL_CRITIC_AGENT_ID,
  VISUAL_CRITIC_AGENT_VERSION,
  type CriticPartition,
} from "./visual-critic-agent";

/**
 * The seam a model reaches the Critic through.
 *
 * Returns a raw patch — unvalidated, untrusted — because the merge is what
 * decides whether it is allowed to say what it says.
 */
export type VisualCriticInvoker = (
  evidence: ReturnType<typeof compileCriticEvidence>,
  partition: CriticPartition,
) => Promise<unknown>;

export interface EvaluateRenderedStateOptions {
  readonly renderedState: RenderedState;
  readonly blueprint: UIBlueprint;
  readonly implementationMap?: ImplementationMap;
  readonly critic?: VisualCriticInvoker;
  readonly criticModel?: { readonly modelProfileId?: string; readonly model?: string };
  readonly policy?: VisualDeltaReport["passFailPolicy"];
}

export interface PreApprovalEvaluation {
  readonly report: VisualDeltaReport;
  readonly unevaluatedExpectationIds: readonly string[];
}

export async function evaluateRenderedState(
  options: EvaluateRenderedStateOptions,
): Promise<PreApprovalEvaluation> {
  const { expectations } = compileVisualExpectations(options.blueprint, options.implementationMap);
  const evaluation = evaluateVisualDeltas(expectations, options.renderedState);
  const policy = options.policy ?? { ...DEFAULT_VISUAL_PASS_FAIL_POLICY };

  // No findings, or no critic: the deterministic report is already complete
  // and there is nothing worth spending a model call on.
  if (options.critic === undefined || evaluation.findings.length === 0)
    return {
      report: assembleVisualDeltaReport({
        renderedState: options.renderedState,
        findings: evaluation.findings,
        expectationCount: expectations.length,
        policy,
        critic: { status: "not_requested", partitionCount: 0, patchCount: 0, summaries: [] },
      }),
      unevaluatedExpectationIds: evaluation.unevaluatedExpectationIds,
    };

  const partitions = partitionCriticFindings(evaluation.findings, expectations);
  const patches: unknown[] = [];
  const failures: { partitionId: string; code: string }[] = [];

  for (const partition of partitions) {
    try {
      patches.push(await options.critic(compileCriticEvidence(partition), partition));
    } catch {
      // One partition failing costs its interpretation and nothing else. The
      // measured findings for it are already in the report.
      failures.push({ partitionId: partition.partitionId, code: "ERR_VISUAL_CRITIC_UNAVAILABLE" });
    }
  }

  const merged = applyVisualCriticPatches(evaluation.findings, patches, {
    failures,
    allowSeverityEscalation: policy.criticSeverityMayEscalate,
  });

  const status =
    merged.appliedPatchCount === 0 ? "unavailable" : merged.failures.length > 0 ? "partial" : "completed";

  return {
    report: assembleVisualDeltaReport({
      renderedState: options.renderedState,
      findings: merged.findings,
      annotations: merged.annotations,
      expectationCount: expectations.length,
      policy,
      critic: {
        status,
        partitionCount: partitions.length,
        patchCount: merged.appliedPatchCount,
        agentId: VISUAL_CRITIC_AGENT_ID,
        agentVersion: VISUAL_CRITIC_AGENT_VERSION,
        ...(options.criticModel?.modelProfileId !== undefined
          ? { modelProfileId: options.criticModel.modelProfileId }
          : {}),
        ...(options.criticModel?.model !== undefined ? { model: options.criticModel.model } : {}),
        summaries: merged.summaries.slice(0, 16),
      },
    }),
    unevaluatedExpectationIds: evaluation.unevaluatedExpectationIds,
  };
}
