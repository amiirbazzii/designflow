# Project Inspection (legacy)

**Purpose** — the Stage-4 deterministic read of a registered project, plus the
name-similarity design-system mapping the legacy Implementation path uses.

**Owns** — `inspection.ts` (framework, language, components, tokens, commands,
`contextFingerprint`) and `design-system-mapping.ts`.

**Migration status** — **superseded in V2** by the Project Context compiler
(`@designflow/tools` → `src/project-context/`) and the Project Mapper. Retained
because the flagship workflow and the approval fingerprint still depend on it.

**Tests** — `./test/`.
