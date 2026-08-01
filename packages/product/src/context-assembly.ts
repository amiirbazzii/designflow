// packages/product/src/context-assembly.ts
import type { AgentMemory, MemoryListFilter, ProjectContext, ProjectFact, ProjectIdentity } from "@designflow/sdk";
import type { SessionContext } from "./session-context";

/**
 * The bounded, immutable knowledge a decision may see, beyond the session
 * itself.
 *
 * The product-level analogue of `SessionContext`: built for exactly one
 * purpose (informing one decision), JSON-serialisable, and carrying nothing a
 * raw store record does — no `version`, no `expiresAt`, no `status`, no
 * store handle. `source` is kept on a project fact (safe metadata, the same
 * reason `TraceModelCall` keeps a `model` slug); `confidence` is not, because
 * it exists only to help this module choose what survives truncation.
 */
export interface SelectedProjectFact {
  readonly key: string;
  readonly value: unknown;
  readonly source: ProjectFact["source"];
}

export interface SelectedMemory {
  readonly scope: AgentMemory["scope"];
  readonly key: string;
  readonly value: unknown;
}

export interface AgentKnowledgeContext {
  readonly session: SessionContext;
  readonly project?: {
    readonly id: string;
    readonly name: string;
    readonly summary?: string;
    readonly facts: readonly SelectedProjectFact[];
  };
  readonly memory: readonly SelectedMemory[];
}

export interface GetKnowledgeContextRequest {
  readonly sessionContext: SessionContext;
  readonly projectId?: string;
  readonly agentId: string;
}

export interface AgentKnowledgeService {
  getContext(request: GetKnowledgeContextRequest): Promise<AgentKnowledgeContext>;
}

/**
 * Narrow read ports `ContextAssemblyService` depends on.
 *
 * Satisfied structurally by `ProjectService`/`ProjectContextService` and
 * `AgentMemoryService` — no import of either concrete class is needed here,
 * the same "port in, concrete class wired at the composition root" rule
 * `SessionWorkflowStarter` follows.
 */
export interface ProjectContextReader {
  getProject(projectId: string): Promise<ProjectIdentity>;
  getContext(projectId: string): Promise<ProjectContext>;
}

export interface MemoryReader {
  listMemory(filters?: MemoryListFilter): Promise<readonly AgentMemory[]>;
}

export interface ContextAssemblyServiceOptions {
  readonly projectContext?: ProjectContextReader | undefined;
  readonly memory?: MemoryReader | undefined;
  readonly now?: (() => string) | undefined;
  readonly maxFacts?: number | undefined;
  readonly maxMemory?: number | undefined;
  readonly maxTotalChars?: number | undefined;
}

const DEFAULT_MAX_FACTS = 50;
const DEFAULT_MAX_MEMORY = 20;
const DEFAULT_MAX_TOTAL_CHARS = 8_000;

/** Ascending: applied in this order so the last one written wins a same-key collision. */
const MEMORY_SCOPE_PRECEDENCE: readonly AgentMemory["scope"][] = ["agent", "project", "project_agent"];

/** Explicit sources sort before derived ones when truncation has to choose. */
const FACT_SOURCE_RANK: Readonly<Record<ProjectFact["source"], number>> = {
  user: 0,
  config: 1,
  inspection: 2,
  inferred: 3,
};

/**
 * Assembles Session Context, Project Context and Agent Memory into one
 * bounded, frozen value for exactly one decision.
 *
 * What this class is careful never to do:
 *
 *   - reach outside the exact `projectId`/`agentId` given — no other
 *     project's facts, no other agent's memory, ever
 *   - let memory override the caller's own `sessionContext` — the two live in
 *     separate fields, and nothing here writes into `session`
 *   - hand back a raw `ProjectContext`/`AgentMemory` record, a store handle,
 *     a `version`, or a `confidence` — only what a decision needs
 */
export class ContextAssemblyService implements AgentKnowledgeService {
  private readonly projectContext: ProjectContextReader | undefined;
  private readonly memoryReader: MemoryReader | undefined;
  private readonly now: () => string;
  private readonly maxFacts: number;
  private readonly maxMemory: number;
  private readonly maxTotalChars: number;

  public constructor(options?: ContextAssemblyServiceOptions) {
    this.projectContext = options?.projectContext;
    this.memoryReader = options?.memory;
    this.now = options?.now ?? (() => new Date().toISOString());
    this.maxFacts = options?.maxFacts ?? DEFAULT_MAX_FACTS;
    this.maxMemory = options?.maxMemory ?? DEFAULT_MAX_MEMORY;
    this.maxTotalChars = options?.maxTotalChars ?? DEFAULT_MAX_TOTAL_CHARS;
  }

  public async getContext(request: GetKnowledgeContextRequest): Promise<AgentKnowledgeContext> {
    const project = await this.selectProject(request.projectId);
    const memory = await this.selectMemory(request.agentId, request.projectId);

    return deepFreeze({
      session: request.sessionContext,
      ...(project !== undefined ? { project } : {}),
      memory,
    });
  }

  private async selectProject(
    projectId: string | undefined,
  ): Promise<AgentKnowledgeContext["project"] | undefined> {
    if (projectId === undefined || this.projectContext === undefined) return undefined;

    let identity: ProjectIdentity;
    let context: ProjectContext;
    try {
      [identity, context] = await Promise.all([
        this.projectContext.getProject(projectId),
        this.projectContext.getContext(projectId),
      ]);
    } catch {
      // A project that no longer exists (or was never inspected) contributes
      // no knowledge rather than failing the decision it would otherwise
      // enrich.
      return undefined;
    }

    const now = this.now();
    const active = context.facts.filter((fact) => fact.expiresAt === undefined || fact.expiresAt > now);

    const ordered = [...active].sort((left, right) => {
      const rank = FACT_SOURCE_RANK[left.source] - FACT_SOURCE_RANK[right.source];
      return rank !== 0 ? rank : left.key.localeCompare(right.key);
    });

    const bounded = boundByChars(
      ordered.slice(0, this.maxFacts),
      (fact) => fact.key.length + JSON.stringify(fact.value ?? null).length,
      this.maxTotalChars,
    );

    return {
      id: identity.id,
      name: identity.name,
      ...(context.summary !== undefined ? { summary: context.summary } : {}),
      facts: bounded.map((fact) => ({ key: fact.key, value: fact.value, source: fact.source })),
    };
  }

  private async selectMemory(
    agentId: string,
    projectId: string | undefined,
  ): Promise<readonly SelectedMemory[]> {
    if (this.memoryReader === undefined) return [];

    const now = this.now();
    const byKey = new Map<string, AgentMemory>();

    for (const scope of MEMORY_SCOPE_PRECEDENCE) {
      if (scope !== "agent" && projectId === undefined) continue;

      const filters: MemoryListFilter =
        scope === "agent"
          ? { scope, agentId, status: "active" }
          : scope === "project"
            ? { scope, projectId: projectId as string, status: "active" }
            : { scope, agentId, projectId: projectId as string, status: "active" };

      const records = await this.memoryReader.listMemory(filters);
      for (const memory of records) {
        if (memory.expiresAt !== undefined && memory.expiresAt <= now) continue;
        // Later scopes in `MEMORY_SCOPE_PRECEDENCE` overwrite earlier ones —
        // this is the whole precedence rule, expressed as iteration order.
        byKey.set(memory.key, memory);
      }
    }

    const ordered = [...byKey.values()].sort((left, right) => {
      const rank =
        MEMORY_SCOPE_PRECEDENCE.indexOf(right.scope) - MEMORY_SCOPE_PRECEDENCE.indexOf(left.scope);
      return rank !== 0 ? rank : left.key.localeCompare(right.key);
    });

    const bounded = boundByChars(
      ordered.slice(0, this.maxMemory),
      (memory) => memory.key.length + JSON.stringify(memory.value ?? null).length,
      this.maxTotalChars,
    );

    return bounded.map((memory) => ({ scope: memory.scope, key: memory.key, value: memory.value }));
  }
}

/** Keeps items in order until the running character total would exceed the bound. */
function boundByChars<T>(items: readonly T[], sizeOf: (item: T) => number, maxChars: number): readonly T[] {
  const kept: T[] = [];
  let used = 0;

  for (const item of items) {
    const size = sizeOf(item);
    if (used + size > maxChars) break;
    kept.push(item);
    used += size;
  }

  return kept;
}

/** `Object.freeze`, recursively — arrays and plain objects only, which is all this module ever builds. */
function deepFreeze<T>(value: T): Readonly<T> {
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
    return Object.freeze(value) as Readonly<T>;
  }

  if (typeof value === "object" && value !== null) {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    return Object.freeze(value) as Readonly<T>;
  }

  return value;
}
