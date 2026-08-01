// packages/product/src/project-errors.ts
import { DesignFlowError } from "@designflow/sdk";

/**
 * Project and Project Context failures, each with a stable code.
 *
 * The same discipline `session-errors.ts` established: a caller matches on
 * `code`, never on English. Some of these codes are also raised directly by
 * `@designflow/storage-file`'s adapters (the same code, a different class) —
 * `ProjectService`/`ProjectContextService` pass a `DesignFlowError` from the
 * store straight through rather than re-wrapping it, the same rule
 * `AgentSessionService.normalizeStoreError` follows.
 */
export const PROJECT_ERROR_CODES = [
  "ERR_PROJECT_NOT_FOUND",
  "ERR_PROJECT_ALREADY_EXISTS",
  "ERR_PROJECT_INVALID",
  "ERR_PROJECT_CONFLICT",
  "ERR_PROJECT_PATH_INVALID",
  "ERR_PROJECT_CONTEXT_NOT_FOUND",
  "ERR_PROJECT_CONTEXT_INVALID",
  "ERR_PROJECT_CONTEXT_CONFLICT",
  "ERR_PROJECT_CONTEXT_TOO_LARGE",
  "ERR_PROJECT_FACT_INVALID",
] as const;

export type ProjectErrorCode = (typeof PROJECT_ERROR_CODES)[number];

export class ProjectNotFoundError extends DesignFlowError {
  public constructor(projectId: string) {
    super("ERR_PROJECT_NOT_FOUND", `No such project: ${projectId}`, { projectId });
    this.name = "ProjectNotFoundError";
    Object.setPrototypeOf(this, ProjectNotFoundError.prototype);
  }
}

export class ProjectAlreadyExistsError extends DesignFlowError {
  public constructor(projectId: string) {
    super("ERR_PROJECT_ALREADY_EXISTS", `A project already exists: ${projectId}`, { projectId });
    this.name = "ProjectAlreadyExistsError";
    Object.setPrototypeOf(this, ProjectAlreadyExistsError.prototype);
  }
}

/** A `CreateProjectRequest`/`ProjectPatch` did not match its schema. */
export class ProjectInvalidError extends DesignFlowError {
  public constructor(detail: string) {
    super("ERR_PROJECT_INVALID", `Invalid project request: ${detail}`, {});
    this.name = "ProjectInvalidError";
    Object.setPrototypeOf(this, ProjectInvalidError.prototype);
  }
}

export class ProjectConflictError extends DesignFlowError {
  public constructor(projectId: string) {
    super("ERR_PROJECT_CONFLICT", `Project ${projectId} was modified concurrently`, { projectId });
    this.name = "ProjectConflictError";
    Object.setPrototypeOf(this, ProjectConflictError.prototype);
  }
}

/** A `rootPath` could not be normalised, does not exist, or could not be read. Never echoes the path. */
export class ProjectPathInvalidError extends DesignFlowError {
  public constructor() {
    super("ERR_PROJECT_PATH_INVALID", "That project path could not be used.", {});
    this.name = "ProjectPathInvalidError";
    Object.setPrototypeOf(this, ProjectPathInvalidError.prototype);
  }
}

export class ProjectContextNotFoundError extends DesignFlowError {
  public constructor(projectId: string) {
    super("ERR_PROJECT_CONTEXT_NOT_FOUND", `No context recorded for project: ${projectId}`, {
      projectId,
    });
    this.name = "ProjectContextNotFoundError";
    Object.setPrototypeOf(this, ProjectContextNotFoundError.prototype);
  }
}

/** A `ProjectFactChange` batch did not match its schema — an invalid key, a secret-like value. */
export class ProjectContextInvalidError extends DesignFlowError {
  public constructor(detail: string) {
    super("ERR_PROJECT_CONTEXT_INVALID", `Invalid project context change: ${detail}`, {});
    this.name = "ProjectContextInvalidError";
    Object.setPrototypeOf(this, ProjectContextInvalidError.prototype);
  }
}

export class ProjectContextConflictError extends DesignFlowError {
  public constructor(projectId: string) {
    super("ERR_PROJECT_CONTEXT_CONFLICT", `Project ${projectId}'s context was modified concurrently`, {
      projectId,
    });
    this.name = "ProjectContextConflictError";
    Object.setPrototypeOf(this, ProjectContextConflictError.prototype);
  }
}

/** A context would exceed the bounded fact count or serialized size. */
export class ProjectContextTooLargeError extends DesignFlowError {
  public constructor(projectId: string, limit: string) {
    super("ERR_PROJECT_CONTEXT_TOO_LARGE", `Project ${projectId}'s context would exceed ${limit}`, {
      projectId,
    });
    this.name = "ProjectContextTooLargeError";
    Object.setPrototypeOf(this, ProjectContextTooLargeError.prototype);
  }
}

export class ProjectFactInvalidError extends DesignFlowError {
  public constructor(key: string, detail: string) {
    super("ERR_PROJECT_FACT_INVALID", `Fact ${key} is invalid: ${detail}`, { key });
    this.name = "ProjectFactInvalidError";
    Object.setPrototypeOf(this, ProjectFactInvalidError.prototype);
  }
}
