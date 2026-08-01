// packages/sdk/src/project.ts
import { z } from "zod";

/**
 * A project is the thing Project Context and Agent Memory are scoped to.
 *
 * Deliberately thin: an identity, a name, and an optional local root. Nothing
 * here is a configuration surface — no executable settings, no credentials —
 * because a project record is the primary scope key `ProjectContextStore` and
 * `AgentMemoryStore` key off of, and a scope key that could carry executable
 * configuration would be a second, unreviewed place permissions could live.
 *
 * `rootPath` is optional because a future remote project (one DesignFlow
 * never inspects on this machine) still needs an identity and a scope key —
 * it just never gets a `project.inspected` fact.
 */

export const projectIdentitySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).max(200),
    rootPath: z.string().min(1).optional(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

export type ProjectIdentity = z.infer<typeof projectIdentitySchema>;

export const createProjectRequestSchema = z
  .object({
    name: z.string().min(1).max(200),
    rootPath: z.string().min(1).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

/** The fields a stored project may gain. `rootPath` and `id` are immutable once created. */
export const projectPatchSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    updatedAt: z.string().min(1),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

export type ProjectPatch = z.infer<typeof projectPatchSchema>;

export const projectListFilterSchema = z
  .object({
    limit: z.number().int().positive().optional(),
  })
  .strict();

export type ProjectListFilter = z.infer<typeof projectListFilterSchema>;

/**
 * Where projects live.
 *
 * The same shape discipline as `SessionStore`/`TraceStore`: an in-memory
 * implementation for tests, a file-backed one for the installed CLI, no
 * optimistic-concurrency version on the identity itself — a project's own
 * identity fields (name, metadata) are not the high-contention surface
 * `ProjectContextStore`'s facts are, so a last-write-wins `updateProject` is
 * enough here.
 */
export interface ProjectStore {
  createProject(project: ProjectIdentity): Promise<void>;
  getProject(projectId: string): Promise<ProjectIdentity | null>;
  updateProject(projectId: string, patch: ProjectPatch): Promise<ProjectIdentity>;
  listProjects(filters?: ProjectListFilter): Promise<readonly ProjectIdentity[]>;
}

/** Filtering and ordering, shared by every store implementation. Newest first. */
export function selectProjects(
  projects: readonly ProjectIdentity[],
  filters?: ProjectListFilter,
): readonly ProjectIdentity[] {
  const validated = filters === undefined ? {} : projectListFilterSchema.parse(filters);

  const ordered = [...projects].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );

  return validated.limit === undefined ? ordered : ordered.slice(0, validated.limit);
}
