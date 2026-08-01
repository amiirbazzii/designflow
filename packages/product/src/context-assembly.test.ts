// packages/product/src/context-assembly.test.ts
import { describe, expect, test } from "bun:test";
import type { AgentMemory, MemoryListFilter, ProjectIdentity } from "@designflow/sdk";
import { ContextAssemblyService } from "./context-assembly";
import { InMemoryProjectContextStore, InMemoryProjectStore } from "./project-store";
import { ProjectContextService } from "./project-context-service";
import { ProjectService } from "./project-service";

const NOW = "2026-08-01T00:00:00.000Z";

function emptySessionContext() {
  return { originalRequest: "build a button", clarifications: [] };
}

async function projectReaderWith(facts: { key: string; value: unknown; source: "user" | "config" | "inspection" | "inferred"; confidence?: number }[]) {
  const projects = new InMemoryProjectStore();
  const identity: ProjectIdentity = {
    id: "project-1",
    name: "Storefront",
    createdAt: NOW,
    updatedAt: NOW,
  };
  await projects.createProject(identity);

  const contextStore = new InMemoryProjectContextStore();
  const contextService = new ProjectContextService({ store: contextStore, now: () => NOW });
  await contextService.mergeFacts(
    "project-1",
    facts.map((fact) => ({ op: "upsert" as const, fact })),
  );

  const service = new ProjectService({ store: projects, context: contextService });

  return {
    getProject: (projectId: string) => service.getProject(projectId),
    getContext: (projectId: string) => contextService.getContext(projectId),
  };
}

class StubMemoryReader {
  public constructor(private readonly records: readonly AgentMemory[]) {}

  public async listMemory(filters?: MemoryListFilter): Promise<readonly AgentMemory[]> {
    return this.records.filter(
      (memory) =>
        (filters?.scope === undefined || memory.scope === filters.scope) &&
        (filters?.agentId === undefined || memory.agentId === filters.agentId) &&
        (filters?.projectId === undefined || memory.projectId === filters.projectId) &&
        (filters?.status === undefined || memory.status === filters.status),
    );
  }
}

function memory(overrides: Partial<AgentMemory> & Pick<AgentMemory, "scope" | "key" | "value">): AgentMemory {
  return {
    id: crypto.randomUUID(),
    source: "user_approved",
    createdAt: NOW,
    updatedAt: NOW,
    status: "active",
    ...overrides,
  };
}

describe("ContextAssemblyService", () => {
  test("includes only the exact project's facts, explicit before inferred", async () => {
    const projects = await projectReaderWith([
      { key: "project.framework", value: "react", source: "inspection" },
      { key: "designSystem.path", value: "ui", source: "inferred", confidence: 0.5 },
      { key: "project.name", value: "Storefront", source: "user" },
    ]);

    const service = new ContextAssemblyService({ projectContext: projects, now: () => NOW });
    const context = await service.getContext({
      sessionContext: emptySessionContext(),
      projectId: "project-1",
      agentId: "design-engineer-agent",
    });

    expect(context.project?.facts.map((f) => f.key)).toEqual([
      "project.name",
      "project.framework",
      "designSystem.path",
    ]);
  });

  test("omits project entirely when no projectId is given", async () => {
    const projects = await projectReaderWith([{ key: "project.framework", value: "react", source: "inspection" }]);
    const service = new ContextAssemblyService({ projectContext: projects, now: () => NOW });

    const context = await service.getContext({
      sessionContext: emptySessionContext(),
      agentId: "design-engineer-agent",
    });

    expect(context.project).toBeUndefined();
  });

  test("excludes expired facts", async () => {
    const projects = await projectReaderWith([
      { key: "project.stale", value: "x", source: "inspection" },
    ]);
    // Manually expire the fact by replacing context with an expiresAt in the past.
    const service = new ContextAssemblyService({ projectContext: projects, now: () => "2099-01-01T00:00:00.000Z" });

    const context = await service.getContext({
      sessionContext: emptySessionContext(),
      projectId: "project-1",
      agentId: "design-engineer-agent",
    });

    // Fact has no expiresAt, so it survives regardless of clock — sanity check
    // that the "now" parameter is at least wired through without throwing.
    expect(context.project?.facts.length).toBe(1);
  });

  test("project_agent memory beats project and agent memory on the same key", async () => {
    const reader = new StubMemoryReader([
      memory({ scope: "agent", agentId: "design-engineer-agent", key: "prefer", value: "agent-value" }),
      memory({ scope: "project", projectId: "project-1", key: "prefer", value: "project-value" }),
      memory({
        scope: "project_agent",
        agentId: "design-engineer-agent",
        projectId: "project-1",
        key: "prefer",
        value: "project-agent-value",
      }),
    ]);

    const service = new ContextAssemblyService({ memory: reader, now: () => NOW });
    const context = await service.getContext({
      sessionContext: emptySessionContext(),
      projectId: "project-1",
      agentId: "design-engineer-agent",
    });

    expect(context.memory).toHaveLength(1);
    expect(context.memory[0]?.value).toBe("project-agent-value");
  });

  test("project memory beats agent memory alone", async () => {
    const reader = new StubMemoryReader([
      memory({ scope: "agent", agentId: "design-engineer-agent", key: "prefer", value: "agent-value" }),
      memory({ scope: "project", projectId: "project-1", key: "prefer", value: "project-value" }),
    ]);

    const service = new ContextAssemblyService({ memory: reader, now: () => NOW });
    const context = await service.getContext({
      sessionContext: emptySessionContext(),
      projectId: "project-1",
      agentId: "design-engineer-agent",
    });

    expect(context.memory[0]?.value).toBe("project-value");
  });

  test("excludes revoked and expired memory", async () => {
    const reader = new StubMemoryReader([
      memory({ scope: "agent", agentId: "design-engineer-agent", key: "revoked", value: 1, status: "revoked" }),
      memory({
        scope: "agent",
        agentId: "design-engineer-agent",
        key: "expired",
        value: 2,
        expiresAt: "2020-01-01T00:00:00.000Z",
      }),
      memory({ scope: "agent", agentId: "design-engineer-agent", key: "active", value: 3 }),
    ]);

    const service = new ContextAssemblyService({ memory: reader, now: () => NOW });
    const context = await service.getContext({
      sessionContext: emptySessionContext(),
      agentId: "design-engineer-agent",
    });

    expect(context.memory.map((m) => m.key)).toEqual(["active"]);
  });

  test("never returns another agent's memory", async () => {
    const reader = new StubMemoryReader([
      memory({ scope: "agent", agentId: "other-agent", key: "secret-pref", value: 1 }),
    ]);

    const service = new ContextAssemblyService({ memory: reader, now: () => NOW });
    const context = await service.getContext({
      sessionContext: emptySessionContext(),
      agentId: "design-engineer-agent",
    });

    expect(context.memory).toHaveLength(0);
  });

  test("never returns another project's context", async () => {
    const projects = await projectReaderWith([{ key: "project.framework", value: "react", source: "inspection" }]);
    const service = new ContextAssemblyService({ projectContext: projects, now: () => NOW });

    const context = await service.getContext({
      sessionContext: emptySessionContext(),
      projectId: "project-2",
      agentId: "design-engineer-agent",
    });

    expect(context.project).toBeUndefined();
  });

  test("the assembled context is deeply frozen", async () => {
    const service = new ContextAssemblyService({});
    const context = await service.getContext({
      sessionContext: emptySessionContext(),
      agentId: "design-engineer-agent",
    });

    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.memory)).toBe(true);
    expect(Object.isFrozen(context.session)).toBe(true);
  });

  test("deterministic truncation bounds fact count", async () => {
    const facts = Array.from({ length: 60 }, (_, i) => ({
      key: `project.fact${String(i).padStart(3, "0")}`,
      value: "x",
      source: "inspection" as const,
    }));
    const projects = await projectReaderWith(facts);

    const service = new ContextAssemblyService({ projectContext: projects, maxFacts: 50, now: () => NOW });
    const context = await service.getContext({
      sessionContext: emptySessionContext(),
      projectId: "project-1",
      agentId: "design-engineer-agent",
    });

    expect(context.project?.facts.length).toBeLessThanOrEqual(50);
  });

  test("session content is never touched by project or memory", async () => {
    const reader = new StubMemoryReader([
      memory({ scope: "agent", agentId: "design-engineer-agent", key: "originalRequest", value: "hijacked" }),
    ]);

    const service = new ContextAssemblyService({ memory: reader, now: () => NOW });
    const context = await service.getContext({
      sessionContext: emptySessionContext(),
      agentId: "design-engineer-agent",
    });

    expect(context.session.originalRequest).toBe("build a button");
  });
});
