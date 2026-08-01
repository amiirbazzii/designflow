// packages/product/src/worker-catalog-service.ts
import { DesignFlowError } from "@designflow/sdk";
import type { WorkerManifest, WorkerRegistry } from "@designflow/sdk";

/**
 * The product-facing worker catalogue.
 *
 * `WorkerRegistry` already holds nothing an end user should not see except
 * two fields: `agentId` and `workflows`, both internal composition detail —
 * "how" a worker gets done, not "what" it does. This is the one place those
 * two fields are stripped before a manifest reaches a normal caller, so a
 * CLI/API/web surface reading through here can never accidentally forward
 * them; a debug caller opts in explicitly instead of a route quietly leaking
 * one workflow id it happened to touch.
 */

export interface WorkerCatalogOptions {
  /** Include `agentId`/`workflows` — for developer/debug surfaces only. */
  readonly debug?: boolean;
}

export type WorkerSummary = Omit<WorkerManifest, "agentId" | "workflows">;
export type WorkerDebugDetail = WorkerManifest;

export class WorkerNotFoundInCatalogError extends DesignFlowError {
  public constructor(workerId: string) {
    super("ERR_WORKER_NOT_FOUND", `No such worker: ${workerId}`, { workerId });
    this.name = "WorkerNotFoundInCatalogError";
    Object.setPrototypeOf(this, WorkerNotFoundInCatalogError.prototype);
  }
}

function toSummary(manifest: WorkerManifest): WorkerSummary {
  const { agentId: _agentId, workflows: _workflows, ...summary } = manifest;
  return summary;
}

export class WorkerCatalogService {
  private readonly workers: WorkerRegistry;

  public constructor(workers: WorkerRegistry) {
    this.workers = workers;
  }

  public listWorkers(options?: WorkerCatalogOptions): readonly (WorkerSummary | WorkerDebugDetail)[] {
    const manifests = this.workers.listWorkers();
    return options?.debug === true ? manifests : manifests.map(toSummary);
  }

  public getWorker(
    workerId: string,
    options?: WorkerCatalogOptions,
  ): WorkerSummary | WorkerDebugDetail {
    const manifest = this.workers.getWorker(workerId);
    if (manifest === undefined) throw new WorkerNotFoundInCatalogError(workerId);

    return options?.debug === true ? manifest : toSummary(manifest);
  }

  /**
   * The worker that owns a workflow, safely — never `agentId`/`workflows`.
   *
   * Exists so a legacy, workflow-keyed surface (the deprecated
   * `/api/workflows` route) can still enrich itself with a worker's own
   * `inputs`/`evaluationCriteria` without hand-duplicating them. The
   * *normal*, non-deprecated path for that information is `GET /workers` —
   * this is a bridge for the surface that predates it, not a second source
   * of truth.
   */
  public findByWorkflow(workflowId: string): WorkerSummary | undefined {
    const manifest = this.workers.listWorkers().find((worker) => worker.workflows.includes(workflowId));
    return manifest === undefined ? undefined : toSummary(manifest);
  }
}
