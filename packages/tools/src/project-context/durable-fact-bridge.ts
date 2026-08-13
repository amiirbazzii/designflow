// packages/tools/src/project-context/durable-fact-bridge.ts
//
// The bridge from a compiled Project Context to the durable `ProjectFact`
// store — and, deliberately, only in that direction.
//
// The rule this file exists to enforce:
//
//   fresh deterministic inspection  >  stored fact  >  unknown
//
// A durable fact is memory, never authority. Every fact written here records
// the project fingerprint and compiler version it was observed under, so a
// reader can tell a fact that still matches the repository from one that was
// true three commits ago. Nothing here reads the store to *replace*
// inspection: if validating a stored fact would cost as much as re-reading
// the file, the compiler just re-reads the file.
//
// Only facts that are stable across runs and cheap to describe are persisted.
// Run-specific selections, generated artifacts and volatile build state are
// not durable knowledge about a project and are never written.
import type { CanonicalProjectContext, ProjectFact, ProjectFactInput } from "@designflow/sdk";

/** Keys this bridge owns. Anything else in the store is somebody else's. */
export const DURABLE_FACT_KEYS = [
  "project.framework",
  "project.frameworkVersion",
  "project.language",
  "project.packageManager",
  "project.routingKind",
  "project.sourceRoots",
  "project.aliases",
  "project.designSystemPackages",
  "project.designSystemDirectories",
  "project.componentDirectories",
  "project.testFramework",
  "project.stylingStrategies",
  "context.observedFingerprint",
  "context.compilerVersion",
] as const;

export type DurableFactKey = (typeof DURABLE_FACT_KEYS)[number];

/**
 * The per-fact value ceiling `projectFactSchema` enforces.
 *
 * Mirrored here on purpose: the store rejects an oversized value by throwing,
 * and `applyProjectFactChanges` parses the whole change set at once — so one
 * project with sixty declared aliases would take down the entire durable
 * write, losing the framework and routing facts along with it. Memory is
 * optional; the canonical per-run context always carries the complete truth.
 */
const MAX_FACT_VALUE_CHARS = 4_000;

/**
 * Fits a value inside the store's per-fact bound.
 *
 * An oversized array is trimmed from the end (its order is deterministic, so
 * the retained prefix is stable across runs); anything still too large is
 * dropped rather than written, and the caller records nothing rather than
 * something false.
 */
function fitWithinFactBounds(value: unknown): unknown | undefined {
  const size = (candidate: unknown): number => JSON.stringify(candidate)?.length ?? Number.MAX_SAFE_INTEGER;
  if (size(value) <= MAX_FACT_VALUE_CHARS) return value;
  if (!Array.isArray(value)) return undefined;

  let retained = [...value];
  while (retained.length > 0 && size(retained) > MAX_FACT_VALUE_CHARS) {
    retained = retained.slice(0, Math.max(0, Math.floor(retained.length * 0.8) - 1));
  }
  return retained.length > 0 ? retained : undefined;
}

/**
 * Selects the durable subset of a compiled context.
 *
 * `source: "inspection"` throughout — every one of these was read from the
 * filesystem this run, not asserted by a person and not inferred by a model.
 * Heuristic evidence (a design-system directory guessed from its name) is
 * still recorded, but the underlying provenance already says so and the
 * compiler re-derives it every run anyway.
 */
export function selectDurableProjectFacts(context: CanonicalProjectContext): ProjectFactInput[] {
  const facts: ProjectFactInput[] = [];
  const add = (key: DurableFactKey, value: unknown): void => {
    if (value === undefined) return;
    if (Array.isArray(value) && value.length === 0) return;
    const fitted = fitWithinFactBounds(value);
    if (fitted === undefined) return;
    facts.push({ key, value: fitted, source: "inspection" });
  };

  add("project.framework", context.runtime.framework?.value);
  add("project.frameworkVersion", context.runtime.frameworkVersion?.value);
  add("project.language", context.runtime.language?.value);
  add("project.packageManager", context.runtime.packageManager?.value);
  add("project.routingKind", context.routing.kind === "unknown" ? undefined : context.routing.kind);
  add("project.sourceRoots", context.structure.sourceRoots);
  add(
    "project.aliases",
    context.structure.aliases.map((alias: CanonicalProjectContext["structure"]["aliases"][number]) => ({
      pattern: alias.pattern,
      targets: alias.targets,
    })),
  );
  type EvidencedString = { readonly value: string };
  add("project.designSystemPackages", context.designSystem.packages.map((entry: EvidencedString) => entry.value));
  add("project.designSystemDirectories", context.designSystem.directories.map((entry: EvidencedString) => entry.value));
  add("project.componentDirectories", context.structure.componentDirectories.slice(0, 24));
  add("project.testFramework", context.testing.framework?.value);
  add("project.stylingStrategies", context.styling.strategies);

  // Evidence identity: what the facts above were observed against. Without
  // this a reader cannot tell fresh memory from stale memory.
  if (context.project.contextFingerprint !== undefined) {
    add("context.observedFingerprint", context.project.contextFingerprint);
  }
  add("context.compilerVersion", context.provenance.compilerVersion);

  return facts;
}

/**
 * Whether stored facts still describe the project the context was compiled
 * from.
 *
 * Stale is the normal case after any repository change, and the honest answer
 * to "is this memory usable?" is usually "re-inspect" — which costs a
 * filesystem walk we are doing anyway. This exists so a reader can *say* the
 * memory is stale, not so anything can be skipped.
 */
export function durableFactsAreCurrent(
  facts: readonly ProjectFact[],
  context: CanonicalProjectContext,
): boolean {
  const observed = facts.find((fact) => fact.key === "context.observedFingerprint")?.value;
  const compiler = facts.find((fact) => fact.key === "context.compilerVersion")?.value;
  if (typeof observed !== "string" || typeof compiler !== "string") return false;
  if (compiler !== context.provenance.compilerVersion) return false;
  return context.project.contextFingerprint !== undefined && observed === context.project.contextFingerprint;
}

/**
 * The changes to apply so the store matches this compilation.
 *
 * Bridge-owned keys that the fresh context no longer supports are removed
 * rather than left behind: a design-system directory that was deleted must
 * not survive in memory as a fact about the project.
 */
export function durableFactChanges(
  existing: readonly ProjectFact[],
  context: CanonicalProjectContext,
): ({ op: "upsert"; fact: ProjectFactInput } | { op: "remove"; key: string })[] {
  const fresh = selectDurableProjectFacts(context);
  const freshKeys = new Set(fresh.map((fact) => fact.key));
  const removals = existing
    .filter((fact) => (DURABLE_FACT_KEYS as readonly string[]).includes(fact.key) && !freshKeys.has(fact.key))
    .map((fact) => ({ op: "remove" as const, key: fact.key }));

  return [...fresh.map((fact) => ({ op: "upsert" as const, fact })), ...removals];
}
