// packages/sdk/src/project-context.ts
import { z } from "zod";
import { valueLooksSecretLike } from "./privacy";

/**
 * Durable facts about one project — a description of what a codebase *is*,
 * not a transcript of what anyone said about it.
 *
 * Bounded and namespaced on purpose. `ProjectFact.key` is a dotted path
 * (`project.framework`, `designSystem.path`) rather than a free-form string,
 * so a project's context reads as a small, reviewable table rather than an
 * uncontrolled dumping ground — the same discipline `AgentManifest`'s
 * allow-lists apply to *behaviour*, applied here to *knowledge*.
 *
 *   what is recorded    a bounded set of named facts, each with a recorded
 *                       source (who or what asserted it) and, for anything
 *                       not explicitly asserted, a confidence
 *
 *   what cannot be      an API key, a token, a password, or anything else
 *                       `looksSecretLike` flags — rejected at the schema
 *                       boundary; a raw file's contents; an unbounded blob
 *
 * An inferred fact is always distinguishable from an explicit one: `source`
 * says who asserted it, and `confidence` is *required* when `source` is
 * `"inferred"` — there is no way to write a fact that merely *looks* certain.
 */

const FACT_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*)*$/;
const MAX_FACT_VALUE_CHARS = 4_000;

export const projectFactSourceSchema = z.enum(["user", "config", "inspection", "inferred"]);

export type ProjectFactSource = z.infer<typeof projectFactSourceSchema>;

export const projectFactSchema = z
  .object({
    key: z.string().min(1).max(200).regex(FACT_KEY_PATTERN, {
      message: "fact keys must be dotted identifiers, e.g. project.framework",
    }),
    value: z.unknown(),
    source: projectFactSourceSchema,
    /** Required when `source` is `"inferred"`; optional (but permitted) otherwise. */
    confidence: z.number().min(0).max(1).optional(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    expiresAt: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((fact, ctx) => {
    if (fact.source === "inferred" && fact.confidence === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "an inferred fact must carry a confidence",
        path: ["confidence"],
      });
    }

    let serialized: string;
    try {
      serialized = JSON.stringify(fact.value) ?? "";
    } catch {
      serialized = "";
    }

    if (serialized.length > MAX_FACT_VALUE_CHARS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `fact value exceeds ${MAX_FACT_VALUE_CHARS} characters`,
        path: ["value"],
      });
    }

    if (valueLooksSecretLike(fact.key, fact.value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "fact key or value looks like a credential and cannot be stored",
        path: ["value"],
      });
    }
  });

export type ProjectFact = z.infer<typeof projectFactSchema>;

/** What a caller supplies for one fact; the service stamps timestamps. */
export const projectFactInputSchema = projectFactSchema
  .innerType()
  .omit({ createdAt: true, updatedAt: true })
  .extend({
    createdAt: z.string().min(1).optional(),
    updatedAt: z.string().min(1).optional(),
  })
  .strict();

export type ProjectFactInput = z.infer<typeof projectFactInputSchema>;

export const projectFactChangeSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("upsert"), fact: projectFactInputSchema }).strict(),
  z.object({ op: z.literal("remove"), key: z.string().min(1) }).strict(),
]);

export type ProjectFactChange = z.infer<typeof projectFactChangeSchema>;

export const projectContextSourceMetadataSchema = z
  .object({
    inspectedAt: z.string().min(1).optional(),
    sourceKinds: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const projectContextSchema = z
  .object({
    projectId: z.string().min(1),
    /**
     * `0` is reserved for "no context has ever been stored" — the safe empty
     * shape `ProjectContextService.getContext` returns for an uninspected
     * project, never written to a store. A persisted context is always `1`
     * or higher.
     */
    version: z.number().int().nonnegative(),
    updatedAt: z.string().min(1),
    facts: z
      .array(projectFactSchema)
      .default([])
      .superRefine((facts, ctx) => {
        const seen = new Set<string>();
        for (const [index, fact] of facts.entries()) {
          if (seen.has(fact.key)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `duplicate fact key: ${fact.key}`,
              path: [index, "key"],
            });
          }
          seen.add(fact.key);
        }
      }),
    summary: z.string().max(2_000).optional(),
    sourceMetadata: projectContextSourceMetadataSchema.optional(),
  })
  .strict();

export type ProjectContext = z.infer<typeof projectContextSchema>;

/**
 * Applies a batch of fact changes to a context's fact list.
 *
 * Shared by every store implementation, the same reason `applySessionPatch`
 * is: an `upsert` replaces a same-keyed fact outright (explicit replacement,
 * never a silent duplicate) while preserving the original `createdAt`; a
 * `remove` drops the fact entirely. Pure — the caller stamps `updatedAt`/
 * `version` on the returned context.
 */
export function applyProjectFactChanges(
  existingFacts: readonly ProjectFact[],
  changes: readonly ProjectFactChange[],
  now: string,
): readonly ProjectFact[] {
  const byKey = new Map(existingFacts.map((fact) => [fact.key, fact]));

  for (const change of changes) {
    if (change.op === "remove") {
      byKey.delete(change.key);
      continue;
    }

    const existing = byKey.get(change.fact.key);
    const fact = projectFactSchema.parse({
      ...change.fact,
      createdAt: existing?.createdAt ?? change.fact.createdAt ?? now,
      updatedAt: now,
    });

    byKey.set(fact.key, fact);
  }

  return [...byKey.values()].sort((left, right) => left.key.localeCompare(right.key));
}

/**
 * Where a project's context lives.
 *
 * `expectedVersion` is required on every write, the same optimistic-
 * concurrency discipline `SessionStore.update` uses — two racing writers
 * (a person editing a fact while `inspectProject` runs) must not silently
 * last-write-wins.
 */
export interface ProjectContextStore {
  getContext(projectId: string): Promise<ProjectContext | null>;
  replaceContext(
    projectId: string,
    expectedVersion: number | null,
    context: ProjectContext,
  ): Promise<ProjectContext>;
  patchFacts(
    projectId: string,
    expectedVersion: number,
    changes: readonly ProjectFactChange[],
  ): Promise<ProjectContext>;
}
