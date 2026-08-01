// packages/product/src/memory-errors.ts
import { DesignFlowError } from "@designflow/sdk";

/**
 * Agent Memory and Memory Proposal failures, each with a stable code.
 *
 * Same discipline as `project-errors.ts` and `session-errors.ts`. Some codes
 * are also raised directly by `@designflow/storage-file`'s adapters; the
 * product-layer classes below are what `AgentMemoryService`/
 * `MemoryProposalService` raise for failures the store itself cannot detect
 * (a scope violation, an approval-boundary violation, an expired proposal).
 */
export const MEMORY_ERROR_CODES = [
  "ERR_MEMORY_NOT_FOUND",
  "ERR_MEMORY_ALREADY_EXISTS",
  "ERR_MEMORY_INVALID",
  "ERR_MEMORY_CONFLICT",
  "ERR_MEMORY_SCOPE_INVALID",
  "ERR_MEMORY_EXPIRED",
  "ERR_MEMORY_REVOKED",
  "ERR_MEMORY_APPROVAL_REQUIRED",
  "ERR_MEMORY_PROPOSAL_NOT_FOUND",
  "ERR_MEMORY_PROPOSAL_INVALID",
  "ERR_MEMORY_PROPOSAL_EXPIRED",
  "ERR_MEMORY_PROPOSAL_STATE_INVALID",
] as const;

export type MemoryErrorCode = (typeof MEMORY_ERROR_CODES)[number];

export class MemoryNotFoundError extends DesignFlowError {
  public constructor(memoryId: string) {
    super("ERR_MEMORY_NOT_FOUND", `No such memory: ${memoryId}`, { memoryId });
    this.name = "MemoryNotFoundError";
    Object.setPrototypeOf(this, MemoryNotFoundError.prototype);
  }
}

export class MemoryAlreadyExistsError extends DesignFlowError {
  public constructor(memoryId: string) {
    super("ERR_MEMORY_ALREADY_EXISTS", `A memory already exists: ${memoryId}`, { memoryId });
    this.name = "MemoryAlreadyExistsError";
    Object.setPrototypeOf(this, MemoryAlreadyExistsError.prototype);
  }
}

/** A memory request did not match its schema — an oversized or secret-like value. */
export class MemoryInvalidError extends DesignFlowError {
  public constructor(detail: string) {
    super("ERR_MEMORY_INVALID", `Invalid memory request: ${detail}`, {});
    this.name = "MemoryInvalidError";
    Object.setPrototypeOf(this, MemoryInvalidError.prototype);
  }
}

export class MemoryConflictError extends DesignFlowError {
  public constructor(memoryId: string) {
    super("ERR_MEMORY_CONFLICT", `Memory ${memoryId} was modified concurrently`, { memoryId });
    this.name = "MemoryConflictError";
    Object.setPrototypeOf(this, MemoryConflictError.prototype);
  }
}

/** `scope` and its required identifiers disagreed — a wildcard, a missing agentId/projectId. */
export class MemoryScopeInvalidError extends DesignFlowError {
  public constructor(detail: string) {
    super("ERR_MEMORY_SCOPE_INVALID", `Invalid memory scope: ${detail}`, {});
    this.name = "MemoryScopeInvalidError";
    Object.setPrototypeOf(this, MemoryScopeInvalidError.prototype);
  }
}

/** A caller tried to use a memory whose `expiresAt` has passed. */
export class MemoryExpiredError extends DesignFlowError {
  public constructor(memoryId: string) {
    super("ERR_MEMORY_EXPIRED", `Memory ${memoryId} has expired`, { memoryId });
    this.name = "MemoryExpiredError";
    Object.setPrototypeOf(this, MemoryExpiredError.prototype);
  }
}

/** A caller tried to use a memory that has been revoked. */
export class MemoryRevokedError extends DesignFlowError {
  public constructor(memoryId: string) {
    super("ERR_MEMORY_REVOKED", `Memory ${memoryId} has been revoked`, { memoryId });
    this.name = "MemoryRevokedError";
    Object.setPrototypeOf(this, MemoryRevokedError.prototype);
  }
}

/**
 * Raised when a proposal is approved by the agent that proposed it.
 *
 * Defense in depth: architecturally, no agent ever holds a reference to
 * `MemoryProposalService` at all, so this should be unreachable in practice.
 * It exists so the approval boundary is enforced twice — once by the
 * architecture, once by a runtime check — rather than resting on the first
 * alone.
 */
export class MemoryApprovalRequiredError extends DesignFlowError {
  public constructor(proposalId: string) {
    super(
      "ERR_MEMORY_APPROVAL_REQUIRED",
      `Memory proposal ${proposalId} requires approval from someone other than the proposing agent`,
      { proposalId },
    );
    this.name = "MemoryApprovalRequiredError";
    Object.setPrototypeOf(this, MemoryApprovalRequiredError.prototype);
  }
}

export class MemoryProposalNotFoundError extends DesignFlowError {
  public constructor(proposalId: string) {
    super("ERR_MEMORY_PROPOSAL_NOT_FOUND", `No such memory proposal: ${proposalId}`, {
      proposalId,
    });
    this.name = "MemoryProposalNotFoundError";
    Object.setPrototypeOf(this, MemoryProposalNotFoundError.prototype);
  }
}

/** A proposal request did not match its schema — an overlong rationale, an invalid scope. */
export class MemoryProposalInvalidError extends DesignFlowError {
  public constructor(detail: string) {
    super("ERR_MEMORY_PROPOSAL_INVALID", `Invalid memory proposal: ${detail}`, {});
    this.name = "MemoryProposalInvalidError";
    Object.setPrototypeOf(this, MemoryProposalInvalidError.prototype);
  }
}

export class MemoryProposalExpiredError extends DesignFlowError {
  public constructor(proposalId: string) {
    super("ERR_MEMORY_PROPOSAL_EXPIRED", `Memory proposal ${proposalId} has expired`, {
      proposalId,
    });
    this.name = "MemoryProposalExpiredError";
    Object.setPrototypeOf(this, MemoryProposalExpiredError.prototype);
  }
}

/** A proposal that is not (or no longer) `pending` was approved or rejected again. */
export class MemoryProposalStateInvalidError extends DesignFlowError {
  public constructor(proposalId: string, status: string) {
    super(
      "ERR_MEMORY_PROPOSAL_STATE_INVALID",
      `Memory proposal ${proposalId} is ${status}, not pending`,
      { proposalId, status },
    );
    this.name = "MemoryProposalStateInvalidError";
    Object.setPrototypeOf(this, MemoryProposalStateInvalidError.prototype);
  }
}
