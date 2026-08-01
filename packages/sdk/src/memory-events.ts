// packages/sdk/src/memory-events.ts
import { z } from "zod";
import { memoryScopeSchema } from "./memory";

/**
 * What the product layer reports as memory is proposed, approved, rejected or
 * revoked.
 *
 * Same discipline as every other event schema in this package: identifiers,
 * scope, and timestamps only. Never the memory's own key or value, never a
 * proposal's `rationaleSummary` — those live in the proposal/memory record
 * itself, readable through the product's own service, not duplicated into an
 * event stream that might be logged or forwarded somewhere less careful.
 */
export const memoryEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("memory.proposed"),
      proposalId: z.string().min(1),
      scope: memoryScopeSchema,
      agentId: z.string().min(1),
      timestamp: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("memory.approved"),
      proposalId: z.string().min(1).optional(),
      memoryId: z.string().min(1),
      scope: memoryScopeSchema,
      timestamp: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("memory.rejected"),
      proposalId: z.string().min(1),
      timestamp: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("memory.revoked"),
      memoryId: z.string().min(1),
      scope: memoryScopeSchema,
      timestamp: z.string().min(1),
    })
    .strict(),
]);

export type MemoryEvent = z.infer<typeof memoryEventSchema>;

export interface MemoryObserver {
  onEvent(event: MemoryEvent): Promise<void>;
}

export const NOOP_MEMORY_OBSERVER: MemoryObserver = {
  onEvent: () => Promise.resolve(),
};
