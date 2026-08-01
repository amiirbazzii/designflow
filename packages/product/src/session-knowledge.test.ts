// packages/product/src/session-knowledge.test.ts
import { describe, expect, test } from "bun:test";
import {
  workerManifestSchema,
  type AgentDecision,
  type AgentDecisionService,
  type AgentExecutionResult,
  type AgentTask,
  type WorkerManifest,
  type WorkerRegistry,
} from "@designflow/sdk";

import { WorkerTaskRouter } from "./worker-task";
import { InMemorySessionStore } from "./session-store";
import { AgentSessionService } from "./session-service";
import type { AgentKnowledgeContext, AgentKnowledgeService, GetKnowledgeContextRequest } from "./context-assembly";
import type { ExecutionHandle, WorkflowLaunchRequest } from "./schemas";

/**
 * `AgentSessionService`'s Stage 40 addition: merging `AgentKnowledgeContext`
 * into the context a decision sees, on both the first turn and every resumed
 * one, scoped to the session's own snapshotted `projectId`.
 */

function worker(overrides: Partial<WorkerManifest> = {}): WorkerManifest {
  return workerManifestSchema.parse({
    id: "design-engineer",
    name: "Design Engineer",
    description: "Builds things",
    category: "testing",
    workflows: ["design-to-code"],
    agentId: "design-engineer-agent",
    ...overrides,
  });
}

function registry(workers: readonly WorkerManifest[]): WorkerRegistry {
  return {
    listWorkers: () => workers,
    getWorker: (id) => workers.find((candidate) => candidate.id === id),
    registerWorker: () => {
      throw new Error("not used");
    },
  };
}

function scriptedAgent(
  decisions: readonly AgentDecision[],
  seenTasks: AgentTask[] = [],
): AgentDecisionService {
  let index = 0;
  return {
    decide: (task): Promise<AgentExecutionResult> => {
      seenTasks.push(task);
      const decision = decisions[Math.min(index, decisions.length - 1)];
      index += 1;
      return Promise.resolve({
        agentId: task.agentId,
        workerId: task.workerId,
        decision: decision as AgentDecision,
        traceId: `trace-${index}`,
      });
    },
  };
}

function starter(): { start: (request: WorkflowLaunchRequest) => Promise<ExecutionHandle> } {
  let count = 0;
  return {
    start: async (request) => {
      count += 1;
      return {
        executionId: `exec-${count}`,
        workflowId: request.workflowId,
        workflowName: request.workflowId,
        state: "ready",
      };
    },
  };
}

/** Returns fixed, distinguishable knowledge per projectId — a stand-in for `ContextAssemblyService`. */
function fakeKnowledge(
  byProjectId: Record<string, AgentKnowledgeContext["project"]>,
  seen: GetKnowledgeContextRequest[] = [],
): AgentKnowledgeService {
  return {
    getContext: async (request) => {
      seen.push(request);
      const project = request.projectId !== undefined ? byProjectId[request.projectId] : undefined;
      return {
        session: request.sessionContext,
        ...(project !== undefined ? { project } : {}),
        memory: [],
      };
    },
  };
}

describe("AgentSessionService + AgentKnowledgeService", () => {
  test("the first decision receives project context for the session's projectId", async () => {
    const seenTasks: AgentTask[] = [];
    const agent = scriptedAgent([{ type: "run_workflow", workflowId: "design-to-code" }], seenTasks);
    const knowledge = fakeKnowledge({
      "project-a": { id: "project-a", name: "Project A", facts: [{ key: "project.framework", value: "react", source: "inspection" }] },
    });

    const service = new AgentSessionService({
      store: new InMemorySessionStore(),
      workers: registry([worker()]),
      router: new WorkerTaskRouter({ workers: registry([worker()]), agents: agent }),
      runner: starter(),
      knowledge,
    });

    await service.startSessionForWorker(worker(), { workerId: "design-engineer", request: "build it", projectId: "project-a" });

    expect(seenTasks[0]?.context?.["project"]).toMatchObject({ id: "project-a", name: "Project A" });
  });

  test("projectId persists on the session and is reused across answerSession", async () => {
    const seenTasks: AgentTask[] = [];
    const agent = scriptedAgent(
      [{ type: "request_clarification", question: "Which component?" }, { type: "run_workflow", workflowId: "design-to-code" }],
      seenTasks,
    );
    const knowledge = fakeKnowledge({
      "project-a": { id: "project-a", name: "Project A", facts: [] },
    });

    const service = new AgentSessionService({
      store: new InMemorySessionStore(),
      workers: registry([worker()]),
      router: new WorkerTaskRouter({ workers: registry([worker()]), agents: agent }),
      runner: starter(),
      knowledge,
    });

    const started = await service.startSessionForWorker(worker(), {
      workerId: "design-engineer",
      request: "build it",
      projectId: "project-a",
    });

    expect(started.session.projectId).toBe("project-a");

    await service.answerSession({ sessionId: started.session.id, answer: "the button" });

    expect(seenTasks).toHaveLength(2);
    expect(seenTasks[1]?.context?.["project"]).toMatchObject({ id: "project-a" });
  });

  test("two sessions in two different projects never cross-deliver context", async () => {
    const seenTasks: AgentTask[] = [];
    const agent = scriptedAgent([{ type: "run_workflow", workflowId: "design-to-code" }], seenTasks);
    const knowledge = fakeKnowledge({
      "project-a": { id: "project-a", name: "Project A", facts: [{ key: "project.framework", value: "react", source: "inspection" }] },
      "project-b": { id: "project-b", name: "Project B", facts: [{ key: "project.framework", value: "vue", source: "inspection" }] },
    });

    const service = new AgentSessionService({
      store: new InMemorySessionStore(),
      workers: registry([worker()]),
      router: new WorkerTaskRouter({ workers: registry([worker()]), agents: agent }),
      runner: starter(),
      knowledge,
    });

    await service.startSessionForWorker(worker(), { workerId: "design-engineer", request: "build it", projectId: "project-a" });
    await service.startSessionForWorker(worker(), { workerId: "design-engineer", request: "build it", projectId: "project-b" });

    expect(seenTasks[0]?.context?.["project"]).toMatchObject({ id: "project-a" });
    expect(seenTasks[1]?.context?.["project"]).toMatchObject({ id: "project-b" });
    expect(JSON.stringify(seenTasks[0]?.context)).not.toContain("project-b");
    expect(JSON.stringify(seenTasks[1]?.context)).not.toContain("project-a");
  });

  test("a session with no projectId gets no project field, and existing sessions are unaffected", async () => {
    const seenTasks: AgentTask[] = [];
    const agent = scriptedAgent([{ type: "run_workflow", workflowId: "design-to-code" }], seenTasks);

    const service = new AgentSessionService({
      store: new InMemorySessionStore(),
      workers: registry([worker()]),
      router: new WorkerTaskRouter({ workers: registry([worker()]), agents: agent }),
      runner: starter(),
      // No `knowledge` configured at all — the fully backward-compatible path.
    });

    await service.startSessionForWorker(worker(), { workerId: "design-engineer", request: "build it" });

    expect(seenTasks[0]?.context).toBeUndefined();
  });

  test("a knowledge assembly failure never breaks the session", async () => {
    const seenTasks: AgentTask[] = [];
    const agent = scriptedAgent([{ type: "run_workflow", workflowId: "design-to-code" }], seenTasks);
    const failingKnowledge: AgentKnowledgeService = {
      getContext: () => {
        throw new Error("boom");
      },
    };

    const service = new AgentSessionService({
      store: new InMemorySessionStore(),
      workers: registry([worker()]),
      router: new WorkerTaskRouter({ workers: registry([worker()]), agents: agent }),
      runner: starter(),
      knowledge: failingKnowledge,
    });

    const result = await service.startSessionForWorker(worker(), {
      workerId: "design-engineer",
      request: "build it",
      projectId: "project-a",
    });

    expect(result.session.status).toBe("completed");
  });
});
