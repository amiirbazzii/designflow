// packages/product/src/project-store.ts
import {
  applyProjectFactChanges,
  projectContextSchema,
  projectIdentitySchema,
  projectPatchSchema,
  selectProjects,
} from "@designflow/sdk";
import type {
  ProjectContext,
  ProjectContextStore,
  ProjectFactChange,
  ProjectIdentity,
  ProjectListFilter,
  ProjectPatch,
  ProjectStore,
} from "@designflow/sdk";
import {
  ProjectAlreadyExistsError,
  ProjectContextConflictError,
  ProjectContextNotFoundError,
  ProjectNotFoundError,
} from "./project-errors";

/**
 * Where projects and their context live, for tests and embedding.
 *
 * The same shape `InMemorySessionStore` is: plain `Map`s, every write
 * validated, optimistic concurrency on the context store enforced the same
 * way the file-backed one enforces it on disk.
 */
export class InMemoryProjectStore implements ProjectStore {
  private readonly projects = new Map<string, ProjectIdentity>();

  public async createProject(project: ProjectIdentity): Promise<void> {
    const validated = projectIdentitySchema.parse(project);
    if (this.projects.has(validated.id)) throw new ProjectAlreadyExistsError(validated.id);

    this.projects.set(validated.id, validated);
  }

  public async getProject(projectId: string): Promise<ProjectIdentity | null> {
    return this.projects.get(projectId) ?? null;
  }

  public async updateProject(projectId: string, patch: ProjectPatch): Promise<ProjectIdentity> {
    const existing = this.projects.get(projectId);
    if (existing === undefined) throw new ProjectNotFoundError(projectId);

    const validatedPatch = projectPatchSchema.parse(patch);
    const updated = projectIdentitySchema.parse({ ...existing, ...validatedPatch });

    this.projects.set(projectId, updated);
    return updated;
  }

  public async listProjects(filters?: ProjectListFilter): Promise<readonly ProjectIdentity[]> {
    return selectProjects([...this.projects.values()], filters);
  }
}

export class InMemoryProjectContextStore implements ProjectContextStore {
  private readonly contexts = new Map<string, ProjectContext>();

  public async getContext(projectId: string): Promise<ProjectContext | null> {
    return this.contexts.get(projectId) ?? null;
  }

  public async replaceContext(
    projectId: string,
    expectedVersion: number | null,
    context: ProjectContext,
  ): Promise<ProjectContext> {
    const existing = this.contexts.get(projectId);
    const actualVersion = existing?.version ?? null;

    if (actualVersion !== expectedVersion) {
      throw new ProjectContextConflictError(projectId);
    }

    const validated = projectContextSchema.parse(context);
    this.contexts.set(projectId, validated);
    return validated;
  }

  public async patchFacts(
    projectId: string,
    expectedVersion: number,
    changes: readonly ProjectFactChange[],
  ): Promise<ProjectContext> {
    const existing = this.contexts.get(projectId);
    if (existing === undefined) throw new ProjectContextNotFoundError(projectId);

    if (existing.version !== expectedVersion) {
      throw new ProjectContextConflictError(projectId);
    }

    const now = new Date().toISOString();
    const updated = projectContextSchema.parse({
      projectId,
      version: existing.version + 1,
      updatedAt: now,
      facts: applyProjectFactChanges(existing.facts, changes, now),
      ...(existing.summary !== undefined ? { summary: existing.summary } : {}),
      ...(existing.sourceMetadata !== undefined ? { sourceMetadata: existing.sourceMetadata } : {}),
    });

    this.contexts.set(projectId, updated);
    return updated;
  }
}
