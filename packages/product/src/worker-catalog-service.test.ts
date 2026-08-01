// packages/product/src/worker-catalog-service.test.ts
import { describe, expect, test } from "bun:test";
import type { WorkerManifest, WorkerRegistry } from "@designflow/sdk";
import { WorkerCatalogService, WorkerNotFoundInCatalogError } from "./worker-catalog-service";

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

describe("WorkerCatalogService", () => {
  test("strips agentId and workflows from a normal listing", () => {
    const service = new WorkerCatalogService(new FakeWorkerRegistry([worker()]));
    const [summary] = service.listWorkers();

    expect(summary).toBeDefined();
    expect((summary as Record<string, unknown>)["agentId"]).toBeUndefined();
    expect((summary as Record<string, unknown>)["workflows"]).toBeUndefined();
    expect(summary?.id).toBe("qa-reviewer");
  });

  test("debug mode includes agentId and workflows", () => {
    const service = new WorkerCatalogService(new FakeWorkerRegistry([worker()]));
    const [detail] = service.listWorkers({ debug: true });

    expect((detail as WorkerManifest).agentId).toBe("qa-reviewer-agent");
    expect((detail as WorkerManifest).workflows).toEqual(["qa-review"]);
  });

  test("getWorker mirrors the same stripping", () => {
    const service = new WorkerCatalogService(new FakeWorkerRegistry([worker()]));

    const summary = service.getWorker("qa-reviewer");
    expect((summary as Record<string, unknown>)["agentId"]).toBeUndefined();

    const detail = service.getWorker("qa-reviewer", { debug: true });
    expect((detail as WorkerManifest).agentId).toBe("qa-reviewer-agent");
  });

  test("throws a stable error for an unknown worker", () => {
    const service = new WorkerCatalogService(new FakeWorkerRegistry([]));

    expect(() => service.getWorker("nobody")).toThrow(WorkerNotFoundInCatalogError);
  });
});
