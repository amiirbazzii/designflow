# Design Interpreter

**Purpose** — adds semantic interpretation to an already-compiled Blueprint:
roles, purposes, interaction kinds, named regions, relationships,
uncertainties.

**Can** — annotate Blueprint entities that already exist, within the bounded
partition it was given.

**Cannot** — rewrite deterministic facts. The patch contract has no field able
to express a dimension, color, radius, typeface, variant or line of copy;
`semantic-patch-merge.ts` additionally refuses fact-shaped keys in raw input
and fingerprints every compiler-owned fact before and after the merge.

| File | Responsibility |
| --- | --- |
| `design-interpreter-agent.ts` | the agent: manifest, model profile, strategies |
| `semantic-partitioner.ts` | splits a Blueprint into bounded enrichment requests |
| `semantic-patch-merge.ts` | validates and merges patches; owns the fact-override guard |
| `semantic-patch-response-schema.ts` | the provider-facing wire shape for one patch |

Enrichment is allowed to fail: a Blueprint with no semantics is valid, and the
artifact records `semanticEnrichment.status` rather than pretending otherwise.

## Tests

Runtime source: this directory.
Feature tests, fixtures and helpers: `./test/`.
