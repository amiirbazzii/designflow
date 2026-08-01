// packages/product/src/project-service.ts
import {
  NOOP_PROJECT_OBSERVER,
  createProjectRequestSchema,
  projectIdentitySchema,
  type CreateProjectRequest,
  type ProjectFactChange,
  type ProjectIdentity,
  type ProjectListFilter,
  type ProjectObserver,
  type ProjectPatch,
  type ProjectStore,
} from "@designflow/sdk";

import { ProjectContextService } from "./project-context-service";
import { ProjectInvalidError, ProjectNotFoundError, ProjectPathInvalidError } from "./project-errors";

/**
 * The port a project's directory is inspected through.
 *
 * Declared here rather than imported from `@designflow/tools` — the same
 * "port in, concrete implementation wired at the composition root" rule
 * `SessionWorkflowStarter` follows for `AgentSessionService`. `ProjectService`
 * never knows or cares that `@designflow/tools`' `createProjectInspector`
 * satisfies this; only the CLI's composition root does.
 */
export interface ProjectInspector {
  inspect(root: string, signal?: AbortSignal): Promise<{
    readonly facts: readonly {
      readonly key: string;
      readonly value: unknown;
      readonly source: "inspection" | "inferred";
      readonly confidence?: number;
    }[];
  }>;
}

export interface ProjectServiceOptions {
  readonly store: ProjectStore;
  readonly context: ProjectContextService;
  readonly inspector?: ProjectInspector | undefined;
  readonly observer?: ProjectObserver | undefined;
  readonly generateId?: (() => string) | undefined;
  readonly now?: (() => string) | undefined;
}

/**
 * The product surface over `ProjectStore`.
 *
 * This package has no runtime dependency beyond `@designflow/sdk` — no
 * `node:*` import, so it can be bundled for a browser tier the same as every
 * other file here. OS-specific path resolution (`path.resolve`, `realpath`)
 * is therefore the composition root's job, done before `createProject` is
 * ever called; what this class enforces is only what is true regardless of
 * platform — a `rootPath` is not blank and carries no redundant separators.
 */
export class ProjectService {
  private readonly store: ProjectStore;
  private readonly context: ProjectContextService;
  private readonly inspector: ProjectInspector | undefined;
  private readonly observer: ProjectObserver;
  private readonly generateId: () => string;
  private readonly now: () => string;

  public constructor(options: ProjectServiceOptions) {
    this.store = options.store;
    this.context = options.context;
    this.inspector = options.inspector;
    this.observer = options.observer ?? NOOP_PROJECT_OBSERVER;
    this.generateId = options.generateId ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => new Date().toISOString());
  }

  public async createProject(request: CreateProjectRequest): Promise<ProjectIdentity> {
    const validated = createProjectRequestSchema.parse(request);
    const now = this.now();

    const rootPath = validated.rootPath !== undefined ? normalizeRootPath(validated.rootPath) : undefined;

    const project = projectIdentitySchema.parse({
      id: this.generateId(),
      name: validated.name,
      ...(rootPath !== undefined ? { rootPath } : {}),
      createdAt: now,
      updatedAt: now,
      ...(validated.metadata !== undefined ? { metadata: validated.metadata } : {}),
    });

    await this.store.createProject(project);
    await this.emit({ type: "project.created", projectId: project.id, timestamp: now });

    return project;
  }

  public async getProject(projectId: string): Promise<ProjectIdentity> {
    const project = await this.store.getProject(projectId);
    if (project === null) throw new ProjectNotFoundError(projectId);
    return project;
  }

  public async listProjects(filters?: ProjectListFilter): Promise<readonly ProjectIdentity[]> {
    return this.store.listProjects(filters);
  }

  public async updateProject(projectId: string, patch: ProjectPatch): Promise<ProjectIdentity> {
    return this.store.updateProject(projectId, patch);
  }

  /**
   * Inspects a project's own, previously registered root — never a path
   * supplied at call time. Widening what may be inspected happens by
   * re-registering the project, not by an argument to this method; that is
   * what keeps the grant reviewable at the point a project was created.
   */
  public async inspectProject(projectId: string): Promise<readonly ProjectFactChange[]> {
    if (this.inspector === undefined) {
      throw new ProjectInvalidError("no project inspector is configured in this installation");
    }

    const project = await this.getProject(projectId);
    if (project.rootPath === undefined) {
      throw new ProjectInvalidError(`project ${projectId} has no rootPath to inspect`);
    }

    const { facts } = await this.inspector.inspect(project.rootPath).catch(() => {
      throw new ProjectPathInvalidError();
    });

    const changes: ProjectFactChange[] = facts.map((fact) => ({
      op: "upsert",
      fact: {
        key: fact.key,
        value: fact.value,
        source: fact.source,
        ...(fact.confidence !== undefined ? { confidence: fact.confidence } : {}),
      },
    }));

    await this.context.mergeFacts(projectId, changes);

    await this.emit({
      type: "project.inspected",
      projectId,
      factCount: facts.length,
      timestamp: this.now(),
    });

    return changes;
  }

  private async emit(event: Parameters<ProjectObserver["onEvent"]>[0]): Promise<void> {
    try {
      await this.observer.onEvent(event);
    } catch {
      // Observing must never break the project operation it observes.
    }
  }
}

/**
 * Platform-independent cleanup only: trims whitespace, collapses repeated
 * separators, and drops a trailing separator. Turning a relative path into an
 * absolute one needs `process.cwd()` or `path.resolve`, both Node-specific —
 * the composition root does that before this is ever called.
 */
function normalizeRootPath(rootPath: string): string {
  const trimmed = rootPath.trim().replace(/[/\\]{2,}/g, "/").replace(/(?<=.)[/\\]+$/, "");
  if (trimmed.length === 0) throw new ProjectPathInvalidError();

  return trimmed;
}
