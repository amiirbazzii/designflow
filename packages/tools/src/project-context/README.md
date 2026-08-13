# Project Context

**Purpose** — DesignFlow's canonical, deterministic understanding of the
target project, compiled once per run and consumed by later V2 stages instead
of being rediscovered.

1. **No AI during compilation.** Zero model calls; this package depends on
   `@designflow/sdk` and nothing else.
2. **Facts, not decisions.** "Next.js App Router", "alias `@/*` → `src/*`",
   "`src/components/ui` looks like a design system" are facts. "Reuse Button",
   "create HistoryCard", "modify `page.tsx`" are decisions, and belong to the
   Project Mapper (V2-3).
3. **Fresh inspection outranks durable facts.** The order is always
   fresh inspection > stored fact > unknown. A stored fact is memory; it never
   overrides what the repository says right now.
4. **The per-run artifact is canonical.** `CanonicalProjectContext` is the
   complete truth for one run.
5. **`ProjectFact` is selected durable memory.** A small, reusable subset —
   framework, language, routing kind, source roots, aliases, design-system
   locations, test framework — plus the fingerprint and compiler version it
   was observed under. Never the whole context, never run-specific selections.
6. **Bounds are explicit.** Every bounded collection records what it kept,
   what the limit was, and whether the discovery was exhaustive. When a walk
   stops before the total is knowable, `exhaustive: false` says so rather than
   reporting a made-up total.
7. **Provenance is retained.** Every meaningful fact records its source
   (`package_manifest`, `tsconfig`, `route_convention`, …), the file it came
   from, and a confidence (`deterministic` | `high` | `heuristic`). The project
   fingerprint from the Stage-4 implementation context is carried through
   unchanged, so a context can be checked against the state an approval was
   bound to.

| File | Responsibility |
| --- | --- |
| `project-context-compiler.ts` | orchestrates the deterministic inspectors into one canonical context |
| `alias-inspector.ts` | tsconfig/jsconfig `baseUrl` + `paths`, bounded `extends` chain, cycle detection |
| `durable-fact-bridge.ts` | selects the durable subset, and says when stored memory is stale |

Contracts live in `@designflow/sdk` under `src/project-context/`.
