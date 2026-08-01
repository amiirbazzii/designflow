// packages/product/src/worker-result-service.ts
import {
  DesignFlowError,
  workerResultSchema,
  type WorkerCriterionEvaluator,
  type WorkerManifest,
  type WorkerRegistry,
} from "@designflow/sdk";

import type { ProductExecutionService } from "./service";
import type { ArtifactSummary, ExecutionOverview } from "./schemas";
import { evaluateWorkerResult } from "./worker-evaluation-service";

/**
 * Maps an execution's product-layer read model onto a `WorkerResult` — the
 * one shape a UI client ever sees for "what happened".
 *
 * No agent id, no workflow id, no prompt, no completion, no private
 * reasoning ever crosses this boundary: everything here is built from
 * `ProductExecutionService`'s own output, which already excludes them, plus
 * `WorkerRegistry` lookups that expose only a manifest's public identity.
 */

export class WorkerResultNotReadyError extends DesignFlowError {
  public constructor(executionId: string, state: string) {
    super(
      "ERR_WORKER_RESULT_NOT_READY",
      `Execution ${executionId} has not finished yet (${state})`,
      { executionId, state },
    );
    this.name = "WorkerResultNotReadyError";
    Object.setPrototypeOf(this, WorkerResultNotReadyError.prototype);
  }
}

export interface WorkerResultServiceOptions {
  readonly execution: ProductExecutionService;
  readonly workers: WorkerRegistry;
  /**
   * Lists every execution's overview, most recent first — the same port
   * `ProductExecutionService.listAllOverviews` already satisfies. Optional:
   * a host that never calls `listWorkerResults` need not wire it.
   */
  readonly listAllOverviews?: ((limit?: number) => Promise<readonly ExecutionOverview[]>) | undefined;
  /**
   * Fetches an artifact's raw payload by its logical id — the same port a
   * `RegistryArtifactStore.get` satisfies. Optional: without it, deterministic
   * evaluation still runs, but any criterion that needs to inspect artifact
   * content (rather than just its presence) reports `satisfied: undefined`.
   */
  readonly getArtifactPayload?: ((artifactId: string) => Promise<unknown | undefined>) | undefined;
  /**
   * Each worker's deterministic per-criterion evaluator, keyed by worker id —
   * the composition root's job, since only it legitimately depends on both
   * `@designflow/product` and every workflow package. Defaults to `{}`: a
   * host that supplies none simply gets "no deterministic evaluator is
   * implemented" for every criterion, never a thrown error.
   */
  readonly evaluators?: Record<string, WorkerCriterionEvaluator> | undefined;
}

const LEGACY_WORKER_ID = "legacy";

function findOwningWorker(
  workers: WorkerRegistry,
  workflowId: string,
): WorkerManifest | undefined {
  return workers.listWorkers().find((worker) => worker.workflows.includes(workflowId));
}

function toResultStatus(overview: ExecutionOverview): "completed" | "failed" | "cancelled" {
  switch (overview.state) {
    case "ready":
      return "completed";
    case "failed":
      return "failed";
    case "running":
    case "needs_approval":
      throw new WorkerResultNotReadyError(overview.executionId, overview.state);
  }
}

function toOutputs(artifacts: readonly ArtifactSummary[]) {
  return artifacts.map((artifact) => ({
    id: artifact.artifactId,
    label: artifact.name,
    kind: artifact.type,
    summary:
      artifact.status === "reused"
        ? `${artifact.name} (reused from an earlier run)`
        : artifact.name,
  }));
}

export class WorkerResultService {
  private readonly execution: ProductExecutionService;
  private readonly workers: WorkerRegistry;
  private readonly listAll: ((limit?: number) => Promise<readonly ExecutionOverview[]>) | undefined;
  private readonly getArtifactPayload: ((artifactId: string) => Promise<unknown | undefined>) | undefined;
  private readonly evaluators: Record<string, WorkerCriterionEvaluator>;

  public constructor(options: WorkerResultServiceOptions) {
    this.execution = options.execution;
    this.workers = options.workers;
    this.listAll = options.listAllOverviews;
    this.getArtifactPayload = options.getArtifactPayload;
    this.evaluators = options.evaluators ?? {};
  }

  /** The one result a caller asked about. Throws if the run has not finished. */
  public async getWorkerResult(executionId: string) {
    const overview = await this.execution.getOverview(executionId);
    const artifacts = await this.execution.getArtifacts(executionId);

    return this.toWorkerResult(overview, artifacts);
  }

  /**
   * Every result, most recent first — runs still in progress or awaiting
   * approval are dropped rather than surfaced half-built; a "result" is a
   * finished outcome by definition.
   */
  public async listWorkerResults(options?: { readonly workerId?: string; readonly limit?: number }) {
    if (this.listAll === undefined) return [];

    const overviews = await this.listAll(options?.limit);
    const results = [];

    for (const overview of overviews) {
      let result;
      try {
        const artifacts = await this.execution.getArtifacts(overview.executionId);
        result = await this.toWorkerResult(overview, artifacts);
      } catch (error) {
        if (error instanceof WorkerResultNotReadyError) continue;
        throw error;
      }

      if (options?.workerId === undefined || result.workerId === options.workerId) {
        results.push(result);
      }
    }

    return results;
  }

  private async toWorkerResult(overview: ExecutionOverview, artifacts: readonly ArtifactSummary[]) {
    const worker = findOwningWorker(this.workers, overview.workflowId);
    const status = toResultStatus(overview);

    // Only a completed execution has artifacts worth evaluating — a failed or
    // cancelled run never reached the point of producing usable output, so
    // every criterion would trivially read as unsatisfied, which adds nothing
    // the `status` field does not already say.
    const evaluation =
      worker !== undefined && status === "completed"
        ? await this.evaluate(worker, overview, artifacts)
        : undefined;

    return workerResultSchema.parse({
      id: overview.executionId,
      workerId: worker?.id ?? LEGACY_WORKER_ID,
      status,
      startedAt: new Date(overview.startedAt).toISOString(),
      ...(overview.completedAt !== undefined
        ? { completedAt: new Date(overview.completedAt).toISOString() }
        : {}),
      summary: overview.summary,
      outputs: toOutputs(artifacts),
      executionId: overview.executionId,
      ...(evaluation !== undefined ? { evaluation } : {}),
      ...(worker === undefined ? { metadata: { legacy: true } } : {}),
    });
  }

  /**
   * Resolves every non-removed artifact's payload up front, then hands
   * `evaluateWorkerResult` a synchronous reader over that resolved data — the
   * evaluator itself stays a pure function with no I/O of its own.
   */
  private async evaluate(
    worker: WorkerManifest,
    overview: ExecutionOverview,
    artifacts: readonly ArtifactSummary[],
  ) {
    const payloads = new Map<string, unknown>();

    if (this.getArtifactPayload !== undefined) {
      for (const artifact of artifacts) {
        if (artifact.status === "removed") continue;

        const payload = await this.getArtifactPayload(artifact.artifactId);
        if (payload !== undefined) payloads.set(artifact.artifactId, payload);
      }
    }

    return evaluateWorkerResult(worker, artifacts, overview, this.evaluators, (artifactId) => payloads.get(artifactId));
  }
}
