# ADR: Canonical Project Context

Status: accepted for Agent Architecture V2, phase V2-2. The flagship workflow
is unchanged; nothing here is wired into `design-to-code-implementation`, and
the existing Project Analysis capability keeps running exactly as before.

## Decision

`CanonicalProjectContext` (`packages/sdk/src/project-context/`, schemaVersion 1)
becomes DesignFlow's deterministic understanding of a target project. It is
compiled once per run by `compileProjectContext`
(`packages/tools/src/project-context/`) and is the input the Project Mapper
(V2-3) will read, instead of an AI rediscovering the same filesystem facts on
every stage.

Seven commitments:

1. **No AI during compilation.** Zero model calls. The compiler package
   depends on `@designflow/sdk` and nothing else.
2. **Facts, not decisions.** "Next.js App Router", "`@/*` → `./src/*`",
   "`src/components/ui` looks like a design system", "`vitest` is available"
   are facts. "Reuse Button", "extend TextField", "create HistoryCard",
   "modify `page.tsx`" are decisions and belong to the Project Mapper.
3. **Fresh inspection outranks durable facts.** Always
   fresh inspection > stored fact > unknown. Nothing in this phase lets stored
   memory answer a question the filesystem can answer now; when validating a
   stored fact would cost as much as re-reading the file, the compiler re-reads.
4. **The per-run artifact is canonical.** One `CanonicalProjectContext` is the
   complete truth for one run, carrying provenance, bounds and warnings.
5. **`ProjectFact` is selected durable memory.** A small reusable subset —
   framework, language, package manager, routing kind, source roots, aliases,
   design-system locations, component directories, test framework, styling
   strategies — plus the fingerprint and compiler version it was observed
   under. Facts the fresh context no longer supports are removed, not left to
   rot.
6. **Bounds are explicit.** Every bounded collection records what it retained,
   the limit, and whether discovery was `exhaustive`. When a walk stops before
   the true total is knowable, `discoveredCount` is omitted and
   `exhaustive: false` says so — a made-up total would be worse than silence.
7. **Provenance and identity are retained.** Every meaningful fact carries a
   source (`package_manifest`, `lockfile`, `tsconfig`, `jsconfig`,
   `filesystem`, `route_convention`, `file_content`, `durable_fact`), the file
   it came from, and a confidence (`deterministic` | `high` | `heuristic`). The
   Stage-4 `contextFingerprint` is carried through unchanged so a compiled
   context can be checked against the project state an approval was bound to.
   Approval behavior itself is untouched in this phase.

## Why the naming is what it is

`ProjectContext` was already taken by the durable fact table
(`durable-project-facts.ts`), which is a different thing with different rules.
Renaming a public SDK type for a new phase's convenience would be a
compatibility break for no benefit, so the new contract is
`CanonicalProjectContext` and both now live in one `project-context/` module
whose barrel comment states which is which.

## Two inspectors, one canonical meaning

`packages/capabilities/implementation/src/inspection.ts` and
`packages/tools/src/catalog/project-inspection.ts` both walk the project and
overlap. Rather than concatenating them, the compiler resolves each fact to
one meaning with a stated precedence — declarations beat conventions, and
conventions beat name-matching — and records which inspectors contributed in
`provenance.inspectors`. The tools inspector remains the base (it reaches more
directories); the Stage-4 context is an optional adapter input, because
importing a capability package here would invert the dependency direction for
facts the caller already has.

Two deliberate divergences from the shared inspector, both because the
canonical context is consumed by a decision-maker rather than by a summary:

- **Design-system directories are stricter.** The shared inspector accepts a
  directory named `components`; the compiler does not. Every React project has
  one, and calling it a design system tells the Mapper that an app's one-off
  components are a shared library. `ui`, `design-system`, `ui-kit` and
  `component-library` qualify; `components` is recorded as a generic component
  directory instead.
- **Routing comes from declarations.** A router is recognized from a declared
  dependency, or from Next's own `app/`/`pages/` file convention — never from
  a file merely named "router", which is how a project without a router
  acquires one.

## Consequences

- Compiler changes must bump `PROJECT_CONTEXT_COMPILER_VERSION`; durable facts
  record it, so memory written by an older compiler is detectably not current.
- Alias discovery is now real (`tsconfig`/`jsconfig`, `baseUrl`, `paths`,
  bounded `extends` with cycle detection). A declared alias whose target does
  not exist stays visible with empty `resolvedTargets`, because
  "declared but missing" is a fact a mapper needs.
- No environment values, `.env` contents or credential-shaped strings enter
  the context or the durable store; the fact schema rejects secret-like values
  at its own boundary as well.
