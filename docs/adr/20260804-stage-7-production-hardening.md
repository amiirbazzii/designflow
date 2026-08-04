# Stage 7 production hardening and release readiness

**Date:** 2026-08-04
**Status:** In progress

## Decision

Stage 7 hardens the completed local architecture at its existing boundaries.
It does not add a new agent capability or autonomous loop. Production claims
require separate evidence for deterministic fixtures, real Figma/MCP access,
live model-provider access, and installed-package behavior.

The CLI owns safe diagnostics; deterministic capabilities own Git inspection,
canonical-root enforcement, proposal hashes, snapshots, validation, rollback,
and browser limits. Agents and models receive bounded context and never gain
write, approval, or arbitrary shell authority.

## State and migration

The local JSON store remains schema v1. Additive collections are defaulted for
older supported documents. Future versions and malformed documents are not
silently interpreted. Runtime construction preserves corrupt bytes through
quarantine; `doctor` performs a separate read-only health check so diagnosis
does not mutate state.

## Git and concurrency

Git is advisory for clean/dirty status but mandatory as a safety block for a
dirty proposed target or an in-progress merge/rebase/cherry-pick. A non-Git
project remains valid. FileStore's atomic rename and exclusive lock continue to
protect the single-user local store; this is not a distributed multi-user
coordination service.

## Release status

The package stays at `0.1.1` until real Figma, live-provider, realistic
end-to-end, installed release-candidate, concurrency, and performance evidence
exists. No publish, tag, commit, or push is part of this stage's implementation.
