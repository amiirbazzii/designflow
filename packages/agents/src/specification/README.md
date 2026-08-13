# Specification

**Purpose** — the compact evidence representation, the human-readable
projection of a Blueprint, and the legacy Specification path retained during
V2 migration.

**Not** — the canonical source of truth in V2. That is `../ui-blueprint`.

| Directory | Responsibility |
| --- | --- |
| `evidence/` | `SpecificationEvidenceBundle`: the compact, deterministic normalization of a `FigmaSourceSnapshot` that both the compiler and a model can read |
| `compatibility/` | deterministic projections of a Blueprint — the sectioned human document, and the legacy `DesignSpecification` V2 artifact today's Project Analysis and Implementation consumers still read |
| `legacy/` | the pre-V2 model-authored Specification agent and its wire normalizer. Still the flagship workflow's agent until V2 migration reaches dispatch; retained deliberately, with no deprecation behavior |

## Tests

Each sub-feature owns its tests locally: `evidence/test/`,
`compatibility/test/`, `legacy/test/`.
