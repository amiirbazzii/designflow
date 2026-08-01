// packages/sdk/src/memory.ts
import { z } from "zod";
import { valueLooksSecretLike } from "./privacy";

/**
 * Agent Memory is durable, explicitly approved knowledge — a preference a
 * person signed off on, never something an agent wrote for itself.
 *
 * Every memory carries an explicit `scope`, and the scope's required
 * identifiers are enforced structurally: `"agent"` needs `agentId` and
 * forbids `projectId`, `"project"` is the mirror image, `"project_agent"`
 * needs both. There is no wildcard scope — `agentId`/`projectId` are always a
 * specific id, never `"*"` or absent-meaning-everywhere — so "which agent,
 * which project can see this?" is always answerable by reading the record.
 *
 *   what is recorded    a bounded key/value preference, its scope, who
 *                       approved it (`source`), and its lifecycle (`status`,
 *                       `expiresAt`)
 *
 *   what cannot be      a credential or anything `looksSecretLike` flags; a
 *                       prompt, a completion, or any private reasoning —
 *                       there is no field for any of them
 *
 * `status: "revoked"` is permanent — nothing here un-revokes a memory. A
 * revoked or expired memory must never reach an agent; enforcing that is the
 * job of whoever reads this store (`ContextAssemblyService`), not of the
 * schema, but the schema is what makes "still active" a question answerable
 * from two fields (`status`, `expiresAt`) rather than inferred from absence.
 */

export const memoryScopeSchema = z.enum(["agent", "project_agent", "project"]);

export type MemoryScope = z.infer<typeof memoryScopeSchema>;

export const memorySourceSchema = z.enum(["user_approved", "system_default", "imported"]);

export type MemorySource = z.infer<typeof memorySourceSchema>;

export const memoryStatusSchema = z.enum(["active", "revoked"]);

export type MemoryStatus = z.infer<typeof memoryStatusSchema>;

const MAX_MEMORY_VALUE_CHARS = 2_000;

function checkMemoryScope(
  input: { scope: MemoryScope; agentId?: string | undefined; projectId?: string | undefined },
  ctx: z.RefinementCtx,
): void {
  const { scope, agentId, projectId } = input;

  if (scope === "agent") {
    if (agentId === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "agent scope requires agentId", path: ["agentId"] });
    }
    if (projectId !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "agent scope must not carry projectId", path: ["projectId"] });
    }
  } else if (scope === "project") {
    if (projectId === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "project scope requires projectId", path: ["projectId"] });
    }
    if (agentId !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "project scope must not carry agentId", path: ["agentId"] });
    }
  } else {
    if (agentId === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "project_agent scope requires agentId", path: ["agentId"] });
    }
    if (projectId === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "project_agent scope requires projectId", path: ["projectId"] });
    }
  }
}

function checkMemoryValue(
  input: { key: string; value?: unknown },
  ctx: z.RefinementCtx,
): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(input.value) ?? "";
  } catch {
    serialized = "";
  }

  if (serialized.length > MAX_MEMORY_VALUE_CHARS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `memory value exceeds ${MAX_MEMORY_VALUE_CHARS} characters`,
      path: ["value"],
    });
  }

  if (valueLooksSecretLike(input.key, input.value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "memory key or value looks like a credential and cannot be stored",
      path: ["value"],
    });
  }
}

export const agentMemorySchema = z
  .object({
    id: z.string().min(1),
    scope: memoryScopeSchema,
    agentId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    key: z.string().min(1).max(200),
    value: z.unknown(),
    source: memorySourceSchema,
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    expiresAt: z.string().min(1).optional(),
    status: memoryStatusSchema,
  })
  .strict()
  .superRefine((memory, ctx) => {
    checkMemoryScope(memory, ctx);
    checkMemoryValue(memory, ctx);
  });

export type AgentMemory = z.infer<typeof agentMemorySchema>;

export const memoryListFilterSchema = z
  .object({
    scope: memoryScopeSchema.optional(),
    agentId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    status: memoryStatusSchema.optional(),
    key: z.string().min(1).optional(),
    limit: z.number().int().positive().optional(),
  })
  .strict();

export type MemoryListFilter = z.infer<typeof memoryListFilterSchema>;

/** Filtering and ordering, shared by every store implementation. Newest first. */
export function selectMemory(
  memories: readonly AgentMemory[],
  filters?: MemoryListFilter,
): readonly AgentMemory[] {
  const validated = filters === undefined ? {} : memoryListFilterSchema.parse(filters);

  const matched = memories.filter(
    (memory) =>
      (validated.scope === undefined || memory.scope === validated.scope) &&
      (validated.agentId === undefined || memory.agentId === validated.agentId) &&
      (validated.projectId === undefined || memory.projectId === validated.projectId) &&
      (validated.status === undefined || memory.status === validated.status) &&
      (validated.key === undefined || memory.key === validated.key),
  );

  const ordered = [...matched].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  return validated.limit === undefined ? ordered : ordered.slice(0, validated.limit);
}

/**
 * Where memory lives.
 *
 * No `delete` — a memory is either `active` or `revoked`, and revocation
 * (not deletion) is what keeps "why did the agent used to know this?"
 * answerable later. `update` is narrow on purpose: only what a person could
 * legitimately edit after the fact (`value`, `expiresAt`), never `scope`,
 * `agentId` or `projectId` — changing scope is "create a new memory",
 * expressed as a type rather than a runtime check.
 */
export interface AgentMemoryStore {
  create(memory: AgentMemory): Promise<void>;
  get(id: string): Promise<AgentMemory | null>;
  list(filters?: MemoryListFilter): Promise<readonly AgentMemory[]>;
  update(id: string, patch: { value?: unknown; expiresAt?: string; updatedAt: string }): Promise<AgentMemory>;
  revoke(id: string, updatedAt: string): Promise<AgentMemory>;
}

// ── Memory proposals ────────────────────────────────────────────

/**
 * What an agent may do instead of writing memory directly: propose it.
 *
 * A proposal is not memory — nothing reads a `pending` proposal as if it were
 * approved, and `ContextAssemblyService` never looks at this store at all.
 * `rationaleSummary` is the same "concise, user-safe explanation" discipline
 * `AgentDecision.reasoningSummary` already enforces: bounded length, and
 * structurally not a place for chain-of-thought.
 */
export const memoryProposalStatusSchema = z.enum(["pending", "approved", "rejected", "expired"]);

export type MemoryProposalStatus = z.infer<typeof memoryProposalStatusSchema>;

export const memoryProposalSchema = z
  .object({
    id: z.string().min(1),
    proposedByAgentId: z.string().min(1),
    scope: memoryScopeSchema,
    projectId: z.string().min(1).optional(),
    key: z.string().min(1).max(200),
    value: z.unknown(),
    rationaleSummary: z.string().min(1).max(500),
    createdAt: z.string().min(1),
    expiresAt: z.string().min(1),
    status: memoryProposalStatusSchema,
    resolvedAt: z.string().min(1).optional(),
    resolvedBy: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((proposal, ctx) => {
    // A proposal's implicit "agentId" for scope purposes is the agent that
    // made it — an agent can only ever propose memory about itself.
    checkMemoryScope(
      { scope: proposal.scope, agentId: proposal.proposedByAgentId, projectId: proposal.projectId },
      ctx,
    );
    checkMemoryValue(proposal, ctx);
  });

export type MemoryProposal = z.infer<typeof memoryProposalSchema>;

export const memoryProposalListFilterSchema = z
  .object({
    status: memoryProposalStatusSchema.optional(),
    proposedByAgentId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    limit: z.number().int().positive().optional(),
  })
  .strict();

export type MemoryProposalListFilter = z.infer<typeof memoryProposalListFilterSchema>;

export function selectMemoryProposals(
  proposals: readonly MemoryProposal[],
  filters?: MemoryProposalListFilter,
): readonly MemoryProposal[] {
  const validated = filters === undefined ? {} : memoryProposalListFilterSchema.parse(filters);

  const matched = proposals.filter(
    (proposal) =>
      (validated.status === undefined || proposal.status === validated.status) &&
      (validated.proposedByAgentId === undefined ||
        proposal.proposedByAgentId === validated.proposedByAgentId) &&
      (validated.projectId === undefined || proposal.projectId === validated.projectId),
  );

  const ordered = [...matched].sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  return validated.limit === undefined ? ordered : ordered.slice(0, validated.limit);
}

/**
 * Where proposals live, awaiting a person's decision.
 *
 * `approve`/`reject` are the only mutations — a state-transition store, the
 * same shape `ApprovalManager` already is for workflow approvals, deliberately
 * reused here rather than invented fresh: memory approval and workflow
 * approval are two different *decisions*, but "a proposal that can be
 * approved or rejected exactly once" is the same shape either way.
 */
export interface MemoryProposalStore {
  create(proposal: MemoryProposal): Promise<void>;
  get(id: string): Promise<MemoryProposal | null>;
  list(filters?: MemoryProposalListFilter): Promise<readonly MemoryProposal[]>;
  approve(id: string, resolvedBy: string, resolvedAt: string): Promise<MemoryProposal>;
  reject(id: string, resolvedBy: string, resolvedAt: string): Promise<MemoryProposal>;
}
