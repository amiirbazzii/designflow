# Proposal

**Purpose** — everything that decides whether a proposed change is *safe and
complete enough to show a person*.

**Owns** — the proposal contract helpers, deterministic coverage validation,
and proposed-state validation (the isolated workspace where the exact proposal
is materialized and compiled with the project's own build).

**Does not own** — approval (`../approval`), any write to the registered
project (`../project-mutation`), or project inspection
(`../project-inspection`).

**Tests** — `./test/`.
