# UI Blueprint

**Purpose** — the canonical design source of truth. Everything downstream of
Figma reads this rather than re-interpreting a prose document.

**Owns** — deterministic design facts, compiled from normalized Figma
evidence: dimensions, layout, spacing, colors, borders, radii, effects,
typography, exact copy, component identity, instance property values, slots,
assets, provenance. Same evidence in, byte-identical Blueprint out.

**Does not own** — semantics (see `../design-interpreter`), project mapping,
framework or styling choices, file paths, or code generation. Nothing here
consults a model.

| File | Responsibility |
| --- | --- |
| `ui-blueprint-compiler.ts` | evidence bundle → Blueprint draft, plus size metrics |
| `ui-blueprint-validator.ts` | evidence-relative completeness of a compiled Blueprint |

The contracts themselves live in `@designflow/sdk` under `src/ui-blueprint/`.

## Tests

Runtime source: this directory.
Feature tests, fixtures and helpers: `./test/`.
