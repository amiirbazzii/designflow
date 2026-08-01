// packages/product/src/worker-result-service.test.ts
import { describe, expect, test } from "bun:test";
import type {
  ExecutionEvent,
  ExecutionRecord,
  ExecutionRepository,
  WorkerManifest,
  WorkerRegistry,
} from "@designflow/sdk";
import { ProductExecutionService } from "./service";
import { WorkerResultNotReadyError, WorkerResultService } from "./worker-result-service";

class StubRepository implements ExecutionRepository {
  public readonly records = new Map<string, ExecutionRecord>();

  public add(record: ExecutionRecord): void {
    this.records.set(record.executionId, record);
  }
  public async create(record: ExecutionRecord): Promise<void> {
    this.records.set(record.executionId, record);
  }
  public async update(): Promise<void> {}
  public async get(executionId: string): Promise<ExecutionRecord | null> {
    return this.records.get(executionId) ?? null;
  }
  public async list(workflowId: string): Promise<readonly ExecutionRecord[]> {
    return [...this.records.values()].filter((r) => r.workflowId === workflowId);
  }
  public async listAll(): Promise<readonly ExecutionRecord[]> {
    return [...this.records.values()];
  }
  public async appendEvent(): Promise<void> {}
  public async listEvents(): Promise<readonly never[]> {
    return [];
  }
  public async saveCheckpoint(): Promise<void> {}
  public async getLatestCheckpoint(): Promise<null> {
    return null;
  }
}

class FakeEventSource {
  public async listEvents(): Promise<readonly ExecutionEvent[]> {
    return [];
  }
}

const worker = (overrides?: Partial<WorkerManifest>): WorkerManifest => ({
  id: "qa-reviewer",
  name: "QA Reviewer",
  description: "Reviews things",
  category: "quality",
  workflows: ["qa-review"],
  agentId: "qa-reviewer-agent",
  inputs: [],
  evaluationCriteria: [],
  ...overrides,
});

class FakeWorkerRegistry implements WorkerRegistry {
  public constructor(private readonly manifests: readonly WorkerManifest[]) {}
  public listWorkers(): readonly WorkerManifest[] {
    return this.manifests;
  }
  public getWorker(id: string): WorkerManifest | undefined {
    return this.manifests.find((m) => m.id === id);
  }
  public registerWorker(): void {
    throw new Error("not used");
  }
}

function buildService(repository: StubRepository, workers: WorkerRegistry) {
  const execution = new ProductExecutionService({
    executionRepository: repository,
    eventSource: new FakeEventSource(),
  });

  return new WorkerResultService({
    execution,
    workers,
    listAllOverviews: (limit) => execution.listAllOverviews(limit),
  });
}

describe("WorkerResultService", () => {
  test("maps a completed execution to a WorkerResult naming its worker, never its workflow id in a bare field", async () => {
    const repository = new StubRepository();
    repository.add({
      executionId: "exec-1",
      workflowId: "qa-review",
      status: "completed",
      startedAt: 1_000,
      completedAt: 2_000,
    });

    const service = buildService(repository, new FakeWorkerRegistry([worker()]));
    const result = await service.getWorkerResult("exec-1");

    expect(result.workerId).toBe("qa-reviewer");
    expect(result.status).toBe("completed");
    expect(result.executionId).toBe("exec-1");
    // No agent id, no raw workflow id, no prompt/reasoning field exists on the schema at all.
    expect(Object.keys(result)).not.toContain("agentId");
    expect(Object.keys(result)).not.toContain("workflowId");
  });

  test("maps a failed execution safely", async () => {
    const repository = new StubRepository();
    repository.add({
      executionId: "exec-2",
      workflowId: "qa-review",
      status: "failed",
      startedAt: 1_000,
      completedAt: 1_500,
    });

    const service = buildService(repository, new FakeWorkerRegistry([worker()]));
    const result = await service.getWorkerResult("exec-2");

    expect(result.status).toBe("failed");
  });

  test("an execution whose workflow no worker owns becomes a legacy task, not a guess", async () => {
    const repository = new StubRepository();
    repository.add({
      executionId: "exec-3",
      workflowId: "some-retired-workflow",
      status: "completed",
      startedAt: 1_000,
      completedAt: 1_200,
    });

    const service = buildService(repository, new FakeWorkerRegistry([worker()]));
    const result = await service.getWorkerResult("exec-3");

    expect(result.workerId).toBe("legacy");
    expect(result.metadata).toEqual({ legacy: true });
  });

  test("a still-running execution is not yet a result", async () => {
    const repository = new StubRepository();
    repository.add({
      executionId: "exec-4",
      workflowId: "qa-review",
      status: "running",
      startedAt: 1_000,
    });

    const service = buildService(repository, new FakeWorkerRegistry([worker()]));

    await expect(service.getWorkerResult("exec-4")).rejects.toBeInstanceOf(WorkerResultNotReadyError);
  });

  test("listWorkerResults drops in-progress runs and can filter by worker", async () => {
    const repository = new StubRepository();
    repository.add({ executionId: "a", workflowId: "qa-review", status: "completed", startedAt: 1, completedAt: 2 });
    repository.add({ executionId: "b", workflowId: "qa-review", status: "running", startedAt: 3 });
    repository.add({
      executionId: "c",
      workflowId: "design-to-code",
      status: "completed",
      startedAt: 4,
      completedAt: 5,
    });

    const service = buildService(
      repository,
      new FakeWorkerRegistry([
        worker(),
        worker({ id: "design-engineer", workflows: ["design-to-code"], agentId: "design-engineer-agent" }),
      ]),
    );

    const all = await service.listWorkerResults();
    expect(all.map((r) => r.id).sort()).toEqual(["a", "c"]);

    const onlyQa = await service.listWorkerResults({ workerId: "qa-reviewer" });
    expect(onlyQa.map((r) => r.id)).toEqual(["a"]);
  });
});
