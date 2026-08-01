// packages/workers/src/registry.ts
import {
  DesignFlowError,
  workerManifestSchema,
  type WorkerManifest,
  type WorkerRegistry,
} from "@designflow/sdk";

/**
 * The worker catalogue.
 *
 * Metadata and composition only. It resolves a worker to the workflows it is
 * built from and stops there — nothing here executes, schedules or wraps a
 * workflow at runtime.
 *
 * `registerWorker` is the extension seam. A third-party worker ships a package
 * exporting a `WorkerManifest`, and a host registers it; the catalogue needs no
 * change to accommodate one. That is why workers are not each their own package
 * yet: the seam already exists, so packaging can wait until something actually
 * ships separately.
 */

export class WorkerNotFoundError extends DesignFlowError {
  public constructor(workerId: string, available: readonly string[]) {
    super("ERR_WORKER_NOT_FOUND", `No such worker: ${workerId}`, {
      workerId,
      available: [...available],
    });
    this.name = "WorkerNotFoundError";
    Object.setPrototypeOf(this, WorkerNotFoundError.prototype);
  }
}

export class DuplicateWorkerError extends DesignFlowError {
  public constructor(workerId: string) {
    super(
      "ERR_WORKER_ALREADY_REGISTERED",
      `A worker is already registered as: ${workerId}`,
      { workerId },
    );
    this.name = "DuplicateWorkerError";
    Object.setPrototypeOf(this, DuplicateWorkerError.prototype);
  }
}

export class InMemoryWorkerRegistry implements WorkerRegistry {
  private readonly workers = new Map<string, WorkerManifest>();

  public constructor(initial: readonly WorkerManifest[] = []) {
    for (const manifest of initial) this.registerWorker(manifest);
  }

  /**
   * Registration order is preserved, so a catalogue reads the way it was
   * assembled rather than in map-iteration order.
   */
  public listWorkers(): readonly WorkerManifest[] {
    return [...this.workers.values()];
  }

  public getWorker(id: string): WorkerManifest | undefined {
    return this.workers.get(id);
  }

  /** Like `getWorker`, but says what went wrong and what was available. */
  public requireWorker(id: string): WorkerManifest {
    const worker = this.getWorker(id);

    if (worker === undefined) {
      throw new WorkerNotFoundError(
        id,
        this.listWorkers().map((manifest) => manifest.id),
      );
    }

    return worker;
  }

  /**
   * Adds a worker, validating it at the boundary.
   *
   * A duplicate id is refused rather than overwritten: two workers answering
   * to one name means `designflow run <id>` silently does something other than
   * what the catalogue showed.
   */
  public registerWorker(manifest: WorkerManifest): void {
    const validated = workerManifestSchema.parse(manifest);

    if (this.workers.has(validated.id)) {
      throw new DuplicateWorkerError(validated.id);
    }

    this.workers.set(validated.id, validated);
  }

  /** Workers grouped by category, for a catalogue with headings. */
  public listByCategory(): ReadonlyMap<string, readonly WorkerManifest[]> {
    const grouped = new Map<string, WorkerManifest[]>();

    for (const worker of this.listWorkers()) {
      const existing = grouped.get(worker.category);

      if (existing === undefined) {
        grouped.set(worker.category, [worker]);
      } else {
        existing.push(worker);
      }
    }

    return grouped;
  }

  /** The worker that owns a workflow, if any does. */
  public findByWorkflow(workflowId: string): WorkerManifest | undefined {
    return this.listWorkers().find((worker) =>
      worker.workflows.includes(workflowId),
    );
  }
}
