// packages/product/src/memory-proposal-store.ts
import { memoryProposalSchema, selectMemoryProposals } from "@designflow/sdk";
import type { MemoryProposal, MemoryProposalListFilter, MemoryProposalStore } from "@designflow/sdk";
import {
  MemoryProposalInvalidError,
  MemoryProposalNotFoundError,
  MemoryProposalStateInvalidError,
} from "./memory-errors";

/** Where proposals live, for tests and embedding. State-transition shape, like `ApprovalManager`. */
export class InMemoryMemoryProposalStore implements MemoryProposalStore {
  private readonly proposals = new Map<string, MemoryProposal>();

  public async create(proposal: MemoryProposal): Promise<void> {
    const validated = memoryProposalSchema.parse(proposal);
    if (this.proposals.has(validated.id)) {
      throw new MemoryProposalInvalidError(`a proposal already exists: ${validated.id}`);
    }

    this.proposals.set(validated.id, validated);
  }

  public async get(id: string): Promise<MemoryProposal | null> {
    return this.proposals.get(id) ?? null;
  }

  public async list(filters?: MemoryProposalListFilter): Promise<readonly MemoryProposal[]> {
    return selectMemoryProposals([...this.proposals.values()], filters);
  }

  public async approve(id: string, resolvedBy: string, resolvedAt: string): Promise<MemoryProposal> {
    return this.settle(id, "approved", resolvedBy, resolvedAt);
  }

  public async reject(id: string, resolvedBy: string, resolvedAt: string): Promise<MemoryProposal> {
    return this.settle(id, "rejected", resolvedBy, resolvedAt);
  }

  private async settle(
    id: string,
    status: "approved" | "rejected",
    resolvedBy: string,
    resolvedAt: string,
  ): Promise<MemoryProposal> {
    const existing = this.proposals.get(id);
    if (existing === undefined) throw new MemoryProposalNotFoundError(id);

    if (existing.status !== "pending") {
      throw new MemoryProposalStateInvalidError(id, existing.status);
    }

    const updated = memoryProposalSchema.parse({ ...existing, status, resolvedAt, resolvedBy });
    this.proposals.set(id, updated);
    return updated;
  }
}
