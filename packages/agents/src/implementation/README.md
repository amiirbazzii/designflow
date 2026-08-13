# Implementation (legacy)

**Purpose** — the pre-V2 Implementation Agent: it turns a Specification plus
project context into a proposed set of file changes.

**Owns** — `implementation-agent.ts` and its strategies.

**Does not own** — proposal validation, coverage, approval or any file write.
Those are deterministic and live in
`@designflow/capability-implementation`.

**Migration status** — **legacy relative to V2.** The UI Builder (V2-4) will
execute an `ImplementationMap` instead of re-planning from a Specification.
This module is retained and unchanged until that migration lands; nothing here
is the future UI Builder.

**Tests** — `./test/`.
