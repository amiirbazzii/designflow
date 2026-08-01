// packages/product/src/project-context-service.ts
import {
  DesignFlowError,
  NOOP_PROJECT_OBSERVER,
  applyProjectFactChanges,
  projectContextSchema,
  type ProjectContext,
  type ProjectContextStore,
  type ProjectFactChange,
  type ProjectObserver,
} from "@designflow/sdk";

import { ProjectContextTooLargeError } from "./project-errors";

/**
 * The product surface over `ProjectContextStore`.
 *
 * `getContext` never throws "not found" for a project with no context yet —
 * an uninspected, unconfigured project is a normal state, not a failure, so
 * this returns a safe empty shape instead. `mergeFacts` is the one write:
 * read the current version, apply the caller's changes, retry once if a
 * concurrent write raced it (the same read-modify-write-with-retry a
 * single-user CLI needs, without pushing every caller of `ProjectService`
 * into hand-rolling version tracking the way the raw `ProjectContextStore`
 * port requires).
 */

export interface ProjectContextServiceOptions {
  readonly store: ProjectContextStore;
  readonly observer?: ProjectObserver | undefined;
  readonly now?: (() => string) | undefined;
}

const MAX_FACTS = 200;
const MAX_TOTAL_FACT_CHARS = 40_000;
const MAX_MERGE_RETRIES = 3;

export class ProjectContextService {
  private readonly store: ProjectContextStore;
  private readonly observer: ProjectObserver;
  private readonly now: () => string;

  public constructor(options: ProjectContextServiceOptions) {
    this.store = options.store;
    this.observer = options.observer ?? NOOP_PROJECT_OBSERVER;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  /** Never throws for "no context recorded yet" — returns an empty, version-0 shape instead. */
  public async getContext(projectId: string): Promise<ProjectContext> {
    const existing = await this.store.getContext(projectId);
    if (existing !== null) return existing;

    return projectContextSchema.parse({
      projectId,
      version: 0,
      updatedAt: this.now(),
      facts: [],
    });
  }

  public async mergeFacts(
    projectId: string,
    changes: readonly ProjectFactChange[],
  ): Promise<ProjectContext> {
    if (changes.length === 0) return this.getContext(projectId);

    for (let attempt = 0; attempt < MAX_MERGE_RETRIES; attempt += 1) {
      const current = await this.store.getContext(projectId);

      const updated =
        current === null
          ? await this.store.replaceContext(projectId, null, {
              projectId,
              version: 1,
              updatedAt: this.now(),
              facts: applyBounded(projectId, [], changes, this.now()),
            })
          : await this.tryPatch(projectId, current, changes);

      if (updated !== null) {
        await this.emit({
          type: "project.context.updated",
          projectId,
          version: updated.version,
          factKeys: changes.map((change) => (change.op === "upsert" ? change.fact.key : change.key)),
          timestamp: this.now(),
        });

        return updated;
      }
      // A conflict on this attempt: loop and retry against the fresh version.
    }

    throw new ProjectContextTooLargeError(projectId, "the maximum number of merge retries");
  }

  private async tryPatch(
    projectId: string,
    current: ProjectContext,
    changes: readonly ProjectFactChange[],
  ): Promise<ProjectContext | null> {
    assertBounded(projectId, current.facts.length + changes.length);

    try {
      return await this.store.patchFacts(projectId, current.version, changes);
    } catch (error) {
      if (error instanceof DesignFlowError && error.code === "ERR_PROJECT_CONTEXT_CONFLICT") {
        return null;
      }
      throw error;
    }
  }

  private async emit(event: Parameters<ProjectObserver["onEvent"]>[0]): Promise<void> {
    try {
      await this.observer.onEvent(event);
    } catch {
      // Observing must never break the context update it observes.
    }
  }
}

function assertBounded(projectId: string, factCount: number): void {
  if (factCount > MAX_FACTS) {
    throw new ProjectContextTooLargeError(projectId, `${MAX_FACTS} facts`);
  }
}

function applyBounded(
  projectId: string,
  existing: ProjectContext["facts"],
  changes: readonly ProjectFactChange[],
  now: string,
): ProjectContext["facts"] {
  assertBounded(projectId, existing.length + changes.length);

  const applied = applyProjectFactChanges(existing, changes, now);

  const totalChars = applied.reduce((sum, fact) => sum + JSON.stringify(fact.value ?? null).length, 0);
  if (totalChars > MAX_TOTAL_FACT_CHARS) {
    throw new ProjectContextTooLargeError(projectId, `${MAX_TOTAL_FACT_CHARS} characters of fact values`);
  }

  return [...applied];
}
