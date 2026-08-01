// apps/designflow-cli/src/legacy-compat.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createCliContext,
  type CliContext,
} from "./services/cli-runner";

import { ProductExecutionService, WorkerResultService } from "@designflow/product";
import {
  FileArtifactStore,
  FileExecutionEventStore,
  FileExecutionRepository,
  FileStore,
} from "@designflow/storage-file";

/**
 * Builds a `WorkerResultService` the way a real host (e.g. the API tier)
 * would: its own `ProductExecutionService`, wired to the *same* on-disk
 * document `createCliContext` just opened, not to any internal of
 * `CliContext` (which does not expose one). This is exactly the boundary
 * `GET /results/:id` would sit behind.
 */
function workerResultServiceFor(dbPath: string, ctx: CliContext): WorkerResultService {
  const store = new FileStore(dbPath);
  const repository = new FileExecutionRepository(store);
  const eventStore = new FileExecutionEventStore(store);
  const artifactStore = new FileArtifactStore(store);

  const execution = new ProductExecutionService({
    executionRepository: repository,
    eventSource: eventStore,
    artifactRegistry: artifactStore,
  });

  return new WorkerResultService({ execution, workers: ctx.workers });
}

/**
 * ADVERSARIAL backward-compatibility check for Stage 41.
 *
 * Constructs pre-Stage-41-shaped fixtures by hand-writing the exact JSON
 * `FileStore` shape (see packages/storage-file/src/store.ts's
 * `StoreDocument`/`emptyDocument`), *before* any CliContext ever touches the
 * file, then opens a fresh CliContext against that file and proves the data
 * still loads, classifies correctly, and is never rewritten.
 */

const workspaces: string[] = [];
const contexts: CliContext[] = [];

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "designflow-cli-legacy-"));
  workspaces.push(dir);
  return dir;
}

afterEach(() => {
  for (const created of contexts.splice(0)) created.close();
  for (const dir of workspaces.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  delete process.env.DESIGNFLOW_HOME;
});

function openContext(databasePath: string): CliContext {
  const created = createCliContext({ databasePath });
  contexts.push(created);
  return created;
}

describe("pre-Stage-41 backward compatibility", () => {
  test("1: design-to-code execution with no session predates sessions and maps to a real worker", async () => {
    const home = workspace();
    process.env.DESIGNFLOW_HOME = home;
    const dbPath = join(home, "runs.json");

    // Hand-write a pre-Stage-41-shaped document: only the fields that existed
    // then. No `traces`, `sessions`, `projects`, etc. collections at all —
    // proving `FileStore.read`'s `{ ...emptyDocument(), ...parsed }` fill-in
    // actually works, not just that the type says it should.
    const legacyExecutionId = "legacy-exec-design-to-code-1";
    const preStage41Doc = {
      version: 1,
      executions: {
        [legacyExecutionId]: {
          executionId: legacyExecutionId,
          workflowId: "design-to-code",
          status: "completed",
          startedAt: 1_700_000_000_000,
          completedAt: 1_700_000_060_000,
        },
      },
      lifecycleEvents: [],
      checkpoints: [],
      approvals: {},
      events: [],
      artifacts: {},
      versions: [],
      relations: [],
      payloads: {},
      // Deliberately no traces/sessions/projects/projectContexts/agentMemories/memoryProposals keys.
    };
    writeFileSync(dbPath, `${JSON.stringify(preStage41Doc, null, 2)}\n`);
    const rawBefore = readFileSync(dbPath, "utf8");

    // Fresh context: the current, Stage-41 build (4 workers, 4 workflows).
    const ctx = openContext(dbPath);

    const history = await ctx.runner.history();
    expect(history.some((h) => h.executionId === legacyExecutionId)).toBe(true);

    const results = workerResultServiceFor(dbPath, ctx);

    const result = await results.getWorkerResult(legacyExecutionId);
    expect(result.workerId).toBe("design-engineer");
    expect(result.metadata).toBeUndefined();

    // No silent rewrite: the raw file, byte-for-byte through the original record.
    const rawAfter = readFileSync(dbPath, "utf8");
    const parsedAfter = JSON.parse(rawAfter);
    expect(parsedAfter.executions[legacyExecutionId]).toEqual(
      preStage41Doc.executions[legacyExecutionId],
    );
    // Stronger than structural equality: opening a fresh CliContext and reading
    // through it triggers no write at all until something mutates, so the file
    // is byte-for-byte identical to what was hand-written.
    expect(rawAfter).toBe(rawBefore);
  });

  test("2: orphaned execution for a retired workflow is marked legacy, never guessed", async () => {
    const home = workspace();
    process.env.DESIGNFLOW_HOME = home;
    const dbPath = join(home, "runs.json");

    const orphanId = "legacy-exec-retired-workflow-1";
    const doc = {
      version: 1,
      executions: {
        [orphanId]: {
          executionId: orphanId,
          workflowId: "some-retired-workflow-nobody-owns",
          status: "completed",
          startedAt: 1_650_000_000_000,
          completedAt: 1_650_000_030_000,
        },
      },
      lifecycleEvents: [],
      checkpoints: [],
      approvals: {},
      events: [],
      artifacts: {},
      versions: [],
      relations: [],
      payloads: {},
    };
    writeFileSync(dbPath, `${JSON.stringify(doc, null, 2)}\n`);

    const ctx = openContext(dbPath);

    const history = await ctx.runner.history();
    expect(history.some((h) => h.executionId === orphanId)).toBe(true);

    const results = workerResultServiceFor(dbPath, ctx);

    // Must not crash.
    const result = await results.getWorkerResult(orphanId);
    expect(result.workerId).toBe("legacy");
    expect(result.metadata).toEqual({ legacy: true });
  });

  test("3: a sessionless trace (pre-Stage-40 shape) still lists via TraceService", async () => {
    const home = workspace();
    process.env.DESIGNFLOW_HOME = home;
    const dbPath = join(home, "runs.json");

    const traceId = "legacy-trace-1";
    const doc = {
      version: 1,
      executions: {},
      lifecycleEvents: [],
      checkpoints: [],
      approvals: {},
      events: [],
      artifacts: {},
      versions: [],
      relations: [],
      payloads: {},
      traces: {
        [traceId]: {
          id: traceId,
          // No executionId: a clarification/decline trace, or simply a trace
          // whose run was never correlated — the schema allows this via
          // `.optional()`.
          workerId: "design-engineer",
          agentId: "design-engineer-agent",
          startedAt: "2025-01-01T00:00:00.000Z",
          completedAt: "2025-01-01T00:00:01.000Z",
          status: "completed",
          decisionType: "decline",
          toolCalls: [],
          modelCalls: [],
        },
      },
    };
    writeFileSync(dbPath, `${JSON.stringify(doc, null, 2)}\n`);
    const rawBefore = readFileSync(dbPath, "utf8");

    const ctx = openContext(dbPath);

    const traces = await ctx.traces.listTraces({ limit: 20 });
    expect(traces.some((t) => t.id === traceId)).toBe(true);

    const single = await ctx.traces.getTrace(traceId);
    expect(single?.id).toBe(traceId);
    expect(single?.executionId).toBeUndefined();

    const rawAfter = readFileSync(dbPath, "utf8");
    expect(JSON.parse(rawAfter).traces[traceId]).toEqual(doc.traces[traceId]);
    void rawBefore;
  });

  test("4: pre-Stage-41 project + design-engineer-agent-scoped memory still list/show", async () => {
    const home = workspace();
    process.env.DESIGNFLOW_HOME = home;
    const dbPath = join(home, "runs.json");

    const projectId = "legacy-project-1";
    const memoryId = "legacy-memory-1";
    const doc = {
      version: 1,
      executions: {},
      lifecycleEvents: [],
      checkpoints: [],
      approvals: {},
      events: [],
      artifacts: {},
      versions: [],
      relations: [],
      payloads: {},
      projects: {
        [projectId]: {
          id: projectId,
          name: "Legacy Storefront",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        },
      },
      agentMemories: {
        [memoryId]: {
          id: memoryId,
          scope: "agent",
          agentId: "design-engineer-agent", // the only agent that existed pre-Stage-41
          key: "componentPlacement",
          value: "Place new components under src/components",
          source: "user_approved",
          status: "active",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        },
      },
    };
    writeFileSync(dbPath, `${JSON.stringify(doc, null, 2)}\n`);

    const ctx = openContext(dbPath);

    const projects = await ctx.projects.listProjects();
    expect(projects.some((p) => p.id === projectId)).toBe(true);

    const memories = await ctx.memory.listMemory({ agentId: "design-engineer-agent" });
    expect(memories.some((m) => m.id === memoryId)).toBe(true);

    const rawAfter = JSON.parse(readFileSync(dbPath, "utf8"));
    expect(rawAfter.projects[projectId]).toEqual(doc.projects[projectId]);
    expect(rawAfter.agentMemories[memoryId]).toEqual(doc.agentMemories[memoryId]);
  });
});
