// packages/product/src/worker-result-service.ts
import {
  DesignFlowError,
  workerResultSchema,
} from "@designflow/sdk";
import type { WorkerManifest, WorkerRegistry } from "@designflow/sdk";
import type { ProductExecutionService } from "./service";
import type { ArtifactSummary, ExecutionOverview } from "./schemas";

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

  public constructor(options: WorkerResultServiceOptions) {
    this.execution = options.execution;
    this.workers = options.workers;
    this.listAll = options.listAllOverviews;
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
        result = this.toWorkerResult(overview, artifacts);
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

  private toWorkerResult(overview: ExecutionOverview, artifacts: readonly ArtifactSummary[]) {
    const worker = findOwningWorker(this.workers, overview.workflowId);
    const status = toResultStatus(overview);

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
      ...(worker === undefined ? { metadata: { legacy: true } } : {}),
    });
  }
}
