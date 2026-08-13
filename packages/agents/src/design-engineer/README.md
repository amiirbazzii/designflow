# Design Engineer

**Purpose** — the public routing surface of the Design Engineer journey.

**Owns** — the coordinator agent that chooses which design-to-code workflow a
request runs, and the retained `design-engineer-agent` compatibility alias
that stored sessions and traces still reference.

**Does not own** — any design or project fact. It selects a workflow; the
specialized agents downstream do the work.

**Dependencies** — SDK contracts, the shared agent runtime, the
`classify-design-task` tool.

**Tests** — `./test/`.

**Migration status** — V2 will make the flagship path deterministic
(V2-8); the coordinator remains for free-text entry points.
