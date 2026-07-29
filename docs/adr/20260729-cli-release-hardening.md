# CLI Release Hardening

**Date:** 2026-07-29
**Status:** Accepted
**Stage:** 32.5

## Context

Stage 32 built the CLI's architecture, commands, config and tests, all of which
held up. What it did not do was verify the thing it claimed: that
`npm install -g designflow` works. Verification found three independent
blockers, each fatal on its own.

```
$ npm pack && npm install ./designflow-0.1.0.tgz
npm error code EUNSUPPORTEDPROTOCOL
npm error Unsupported URL Type "workspace:": workspace:*

$ node dist/main.js --help
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../dist/cli'
```

1. **`workspace:*` dependencies.** Five unpublished `@designflow/*` packages.
   npm rejects the protocol outright.
2. **Extensionless ESM imports.** `moduleResolution: "bundler"` emits
   `from "./cli"`; Node's resolver requires `./cli.js`.
3. **`bun:sqlite`.** The dependency chain needed a Bun-only builtin, so the
   `#!/usr/bin/env node` shebang was a lie.

Plus no `prepublishOnly`, with `dist/` gitignored — publishing from a clean
checkout would have shipped an empty package.

## Decision

### 1. Node-compatible, not Bun-only

A tool installed with `npm install -g` must run wherever Node runs. Requiring
Bun would make the install instruction wrong for most of the people it is
aimed at.

### 2. A file-backed store, so there is no native module either

`bun:sqlite` had to go. The alternatives were weighed:

| Option | Rejected because |
|---|---|
| `node:sqlite` | Experimental behind a flag until Node 24; requiring Node 24 for a CLI is worse than the problem |
| `better-sqlite3` | Native module. Needs a compiler wherever there is no prebuild — a global CLI that sometimes fails to install is a bad CLI |
| **JSON document** | **Chosen** |

`@designflow/storage-file` implements the same four contracts against
`node:fs` and `node:crypto`. Nothing but Node, no compilation step, works on
Node 18+.

It rewrites the whole document on every mutation, which is O(document) per
write and would be wrong for a server. `@designflow/storage-sqlite` remains
the API tier's backend, unchanged. This is exactly what having contracts is
for: two backends, chosen per tier, and the engine cannot tell them apart.

Writes go to a sibling file and are then `rename`d over the target, so an
interrupted write leaves the previous document intact rather than a truncated
one.

### 3. Bundle the CLI

`bun build --target=node --format=esm` produces one 0.33 MB `dist/main.js`.
That resolves blockers 1 and 2 together:

- Workspace packages are **compiled in**, so `dependencies` is empty and npm
  has nothing to resolve.
- A single file has no relative imports left to mis-resolve.

Bundling also makes the published artifact self-contained: a user installs one
file, and its behaviour cannot drift with a transitive update.

`prepublishOnly: bun run build` guarantees the bundle is current, since `dist`
is not committed.

### 4. `WorkflowRunner.history()` without a workflow id

`ExecutionRepository` gained an **optional** `listAll`, so no existing
implementation breaks. `ProductExecutionService.listAllOverviews` uses it when
present and returns an empty list when absent — reporting one workflow's runs
would be worse than reporting none.

`history()` now takes an optional id. Both consumers that had hand-rolled the
fan-out lost it: the CLI's `history` command and the API's history route are
each one call again.

## Evidence

The smoke test is the literal sequence from the brief, run against a temporary
npm prefix and a temporary `DESIGNFLOW_HOME` so it exercises what a real user
gets:

```
== Build
== npm pack                    packed designflow-0.1.0.tgz
== npm install -g ./designflow-0.1.0.tgz
                               installed at .../npm-global/bin/designflow
== designflow --version        0.1.0
== designflow list             ok
== designflow run design-to-code   ok
== designflow history (separate process)   ok
== designflow (interactive)    ok

SMOKE TEST PASSED — the published package installs and runs under Node.
```

`scripts/cli-smoke-test.sh`, wired as `npm run smoke` in the CLI package.

Full suite: **846 passing, 0 failing** across 14 packages. Typecheck 25/25,
lint 15/15.

## Consequences

- `packages/storage-file` is new (27 tests).
- The CLI publishes with **zero runtime dependencies**; its five
  `@designflow/*` packages plus zod are devDependencies, bundled at build.
- `engines: { node: ">=18" }` is declared and honest.
- `@designflow/storage-sqlite` is untouched and still backs the API.
- The engine, workflows and product semantics are unchanged. The only product
  change is the additive `history()` overload and its optional repository
  method.

## Known Limitations

**The file store rewrites everything on every write.** Fine for a local CLI
whose history is hundreds of rows; wrong above that. The contract boundary
means swapping it is a one-line change in the composition root.

**No concurrency control.** Two `designflow` processes writing at once will
have one overwrite the other's document. Single-user local use is the assumed
model; a lock file is the obvious fix if that stops holding.

**The artifact graph logic now exists in three places** — core's in-memory
store, storage-sqlite and storage-file. The cycle rules and lineage traversal
are subtle enough that this is a real correctness risk. Extracting them into
`@designflow/sdk` is the right fix and was deliberately left out of a hardening
stage; each copy is covered by its own suite meanwhile.

**Nothing is published.** The tarball installs correctly from disk, which is
what was verifiable here. Actually publishing needs a registry account, a
version policy and a decision about whether the `@designflow/*` packages
publish alongside it.

**The old CLI still ships** as `@designflow/cli-legacy` with its `wf` binary.
