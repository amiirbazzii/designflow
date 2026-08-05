# MVP-2A — Distribution and Installed-Package Audit

- **Audit date:** 2026-08-05
- **Commit:** `0c0e488ec5d3bc858cc6a5e0533df509c8e77b86` (branch `main`; note: the
  task brief cited `60839b4`, but all accepted MVP-1 work — including the
  L1-02 removal and L1-03 cancellation — was committed at the operator's
  explicit request as `7b6dae5` and `0c0e488` before this audit began)
- **Working-tree baseline:** clean except local `.claude-flow/` daemon state
  (`daemon-state.json` modified, `daemon.pid` untracked) — untouched
- **Package:** `designflow-ai@0.1.1`
- **Environment:** macOS (darwin arm64), Bun 1.3.14, Node v22.23.1, npm 10.9.8
- **Mode:** audit only. **No distribution fix was implemented.** No
  production code, tests, manifests, lockfiles, or version changes.

## Classification table

| # | Area | Classification |
|---|---|---|
| 1 | Manifest correctness | BLOCKING (broken `main`/`types`/`exports`) |
| 2 | Build output | PASS |
| 3 | Tarball contents | PASS |
| 4 | Binary executable | PASS |
| 5 | Local isolated installation | PASS |
| 6 | Global isolated installation | PASS |
| 7 | npx execution | PASS_WITH_LIMITATION (name/binary mismatch) |
| 8 | Empty-state CLI commands | PASS_WITH_LIMITATION (EPIPE crash on early-closed pipes) |
| 9 | OpenRouter configuration behavior | PASS |
| 10 | Figma MCP configuration behavior | PASS |
| 11 | Project registration | PASS |
| 12 | Optional Playwright behavior | PASS_WITH_LIMITATION (browser-download path unverified) |
| 13 | Runtime agent/workflow registrations | PASS |
| 14 | State isolation | PASS |
| 15 | Turborepo/cache reliability | BLOCKING (stale-dist pack, unmitigated by `prepublishOnly`) |
| 16 | Existing smoke-test coverage | PASS_WITH_LIMITATION (currently failing on #8; journey gaps) |
| 17 | Security/privacy of package and state | PASS |

## 1. Package manifest (`apps/designflow-cli/package.json`)

- `bin: { designflow: "dist/main.js" }`, `files: ["dist"]`, MIT license,
  repository/directory metadata, `engines.node >= 18`,
  `optionalDependencies: { playwright: "1.62.1" }`, **no `dependencies`** —
  intentional and safe: the build (`bun build src/main.ts --target=node
  --format=esm`) emits one fully self-contained ESM bundle; verified below.
- **DEFECT (area 1, blocking):** `main`, `types`, and `exports` all point to
  `./dist/index.js` / `./dist/index.d.ts`, but the build produces **only
  `dist/main.js`**. The pack ships no `dist/index.js`; `import
  "designflow-ai"` fails immediately for any library consumer. CLI/bin use
  is unaffected. Fix: remove or repoint the library entry points.
- npm consumers cannot audit the bundled dependency graph (zod etc. are
  inlined with no `dependencies` record) — inherent to the bundling choice;
  worth a README note, not a blocker.
- Engines declares Node ≥ 18 only; the CLI genuinely runs under plain Node
  (verified) — Bun is a build-time requirement only. Accurate.
- Shebang `#!/usr/bin/env node` present in the emitted bundle; file mode
  `rwxr-xr-x` inside the tarball; npm creates the bin symlink correctly.
- Pack timestamps are npm-normalized (deterministic archive); content
  determinism is undermined only by finding #15.

## 2. Build output (`dist/main.js`, 1,226,679 bytes)

Scans of the forced-build bundle:
- `@designflow/` unresolved imports: **0**; non-`node:` externals: **0**
  (zod and all workspace code inlined).
- `/Users/`, `/home/`, absolute dev paths: **0**.
- Test fixtures / `FAKE_MCP_FIXTURES` / fake-server code: **0**.
- Playwright: resolved dynamically via `createRequire(import.meta.url)
  .resolve("playwright")` in two places (visual runtime + doctor) — safe
  intentional runtime external.
- `"src/components/Header.tsx"` literal: generated-code template data
  (safe bundled code). `DESIGNFLOW_STAGE6_FAILPOINT` checks are gated to
  `NODE_ENV test/development` — inert in production, classified safe.
- Runtime file reads are all against `DESIGNFLOW_HOME` or registered
  project roots — no reads from packaged-relative assets. No missing
  runtime assets found.

## 3. npm pack

- `npm pack --dry-run` and real pack: **designflow-ai-0.1.1.tgz**,
  package size **229.2 kB**, unpacked **1.2 MB**, **4 files**:
  `package/package.json`, `package/dist/main.js`, `package/LICENSE`,
  `package/README.md`. shasum `afb0f573…`.
- No tests, fixtures, source, local state, `.claude-flow/`, screenshots,
  git metadata, docs, or oversized assets. No missing runtime files (given
  the single-bundle design). The `.tgz` was produced with
  `--pack-destination` into the session scratchpad, outside the repository,
  and is removed with the other temp artifacts.

## 4–7. Installation matrix (all in temp dirs outside the repo, no symlinks)

| Scenario | Command | Result |
|---|---|---|
| Local install (no optional) | `npm i --omit=optional <tgz>` in fresh `npm init -y` project | exit 0; `node_modules/.bin/designflow` runs; no module-resolution errors |
| `--version` | installed bin, isolated `DESIGNFLOW_HOME` | exit 0, "DesignFlow 0.1.1" (first run also prints onboarding before the version — cosmetic) |
| Global install | `npm i -g --prefix <tmp> <tgz>` | exit 0; `<prefix>/bin/designflow` symlink → package `dist/main.js`; runs |
| npx (local tarball) | `npm exec --yes --package=<tgz> -- designflow --help` | exit 0 |
| Real home protection | compared `~/.designflow` mtimes before/after | untouched; all state written to the isolated home only |

**Name/binary mismatch (area 7):** package is `designflow-ai`, binary is
`designflow`. `npx designflow-ai` works (single-bin package). Plain
`npx designflow` would resolve a *different* npm package name — docs must
consistently say `npx designflow-ai` or instruct global install; verify
the `designflow` name on the registry is not squatted before launch.

## 8. Installed CLI command surface (isolated home)

`--help`, `doctor`, `settings`, `projects`, `history`, `sessions`,
`traces`, `artifacts`, `memory`, `cleanup`, `list/workers` — **all exit 0**
with clear empty-state text, no stack traces, no monorepo assumptions.
First run creates exactly `config.json` and `history/runs.json`.

**DEFECT (pipe handling):** `designflow list | grep -q "Design Engineer"`
crashes with an unhandled `write EPIPE` (`Emitted 'error' event on Socket`)
when the pipe consumer exits early — reproduced against the installed
package and it is what currently **fails the smoke script's own `list`
step**. The throwing write is inside `workersCommand` mid-dispatch, a path
identical before and after the recent `process.exitCode` change (the crash
occurs long before `main()` resolves), so this is assessed as a
pre-existing product bug surfaced by first running the smoke script during
this program; empirical bisect was not possible (a temporary worktree at
the prior commit could not `bun install` workspace links). Fix belongs in
MVP-2B: handle `EPIPE` on stdout/stderr (exit 0 silently, the Unix
convention).

## 9. OpenRouter behavior (no key / invalid key)

- No key: deterministic mode activates; `designflow run design-engineer`
  completes the placeholder deterministic path; `settings` shows
  per-worker `Credential: missing`; `doctor` reports
  `model-provider: unavailable` with a safe next step; no secret values
  printed anywhere; nothing falsely implies live AI (worker detail lists
  provider/model as *assignment*, credential separately as missing).
- Invalid key: not exercised against the network (constraint: no real
  provider contact). Unit-level handling is covered in-repo;
  live-invalid-key behavior remains for L5 real-environment validation.

## 10. Figma MCP behavior

- Not configured: general commands unaffected; `doctor` reports
  `figma: unavailable` with actionable setup guidance; experimental
  workflows correctly invisible (`resolve` returns null without the flag).
- Invalid transport value: rejected safely — treated as not-configured
  (matches `figma-mcp-config` fail-safe tests).
- Configured-but-unlaunchable command: honest `warning` ("doctor does not
  launch external MCP commands") with a bounded-verification next step. No
  secrets in any output.

## 11. Project registration

`projects add --name Fixture --path <tmp>` from the installed package:
registered, correct absolute path stored, `doctor` gains a healthy
per-project check ("accessible and is not a Git repository"), inspection
reads only the project fixture, and audit commands modified no project
files.

## 12. Optional Playwright

- Without: install `--omit=optional` succeeds; non-visual commands work;
  `doctor` → `browser: unavailable` with install instructions; the visual
  runtime's `renderer_unavailable` degradation is covered by workspace
  tests (not re-proven from the pack — would require running the
  experimental workflow to Stage 5).
- With: default install pulls `playwright@1.62.1` via
  `optionalDependencies`; the packed CLI's dynamic resolution finds the
  consumer-installed package outside the monorepo, and `doctor` reported
  `browser: healthy` (this machine already has Chromium-for-Testing).
  Package-absent vs browser-absent are distinguishable in `doctor`'s
  message paths. **Unverified:** fresh browser download
  (`npx playwright install chromium`) and capture on a machine with no
  pre-existing browsers.

## 13. Runtime registrations (from the installed package)

| Item | Status |
|---|---|
| Design Engineer worker | included, production-registered (list/run) |
| QA Reviewer / Research Analyst / Product Manager workers | included, production-registered |
| Routing coordinator + sessions | included, production-registered (run flow) |
| Independent per-worker model profiles | included (gpt-4o-mini / claude-3.5-haiku / perplexity-sonar / …), OpenRouter provider wired, credential-gated |
| Figma specification agent + Figma MCP capability | included, experimental-gated (`settings.experimental.designEngineerFigmaMcp`) |
| Implementation agent + 23-node implementation workflow | included, experimental-gated (`designEngineerImplementation` + registered project) |
| Visual-validation agent + Stage-5 runtime | included, experimental-gated; Playwright optional |
| Correction (feedback-loop) path | included, experimental-gated |
| Approval/snapshot/apply/validation/rollback capabilities | included; production-reachable only through the gated implementation path |
| Public `design-to-code` default | placeholder, artifacts-only — distinction preserved |

Agent-centric structure is intact in the shipped bundle (registries and
runtimes bundled as-is, no flattening).

## 14. State isolation

All writes land under the isolated `DESIGNFLOW_HOME`; the operator's real
`~/.designflow` was untouched (pre-existing mtimes). First-run inventory:
`config.json`, `history/runs.json` (SQLite store appears on demand).

## 15. Turborepo / stale-output — CONFIRMED RELEASE BLOCKER (procedure-fixable)

- Mechanism, verified: the CLI bundle resolves every `@designflow/*`
  workspace import through that package's **built `dist`** (each package's
  `main`/`exports` point at `dist/`). Controlled reproduction: with
  `packages/sdk/dist` temporarily moved aside, `bun run build` in the CLI
  fails with `Could not resolve: "@designflow/sdk"`; restored and rebuilt
  cleanly afterward (repo left exactly as found). Therefore a **stale**
  dep `dist` is silently **bundled and shipped**.
- `prepublishOnly` runs only the CLI's own `bun run build`; the smoke
  script likewise builds only the CLI. Neither rebuilds workspace deps →
  `npm pack` **can package stale workspace output**. This exact mechanism
  bit this program three times during L1 (tests observing stale SDK dist).
- `turbo.json`: `build` declares `dependsOn: ["^build"]` and
  `outputs: ["dist/**"]` — correct when the release goes through
  `bunx turbo build --force`. `test` depends only on own `build`
  (transitively ^build), fine under turbo; the hazard is any direct
  `bun test`/`npm pack` outside turbo.
- `docs/RELEASE_CHECKLIST.md` says "build succeeds (runs turbo build...)"
  but does **not** mandate `--force`/cache-bypass, and `prepublishOnly`
  provides no safety net. Clean-vs-warm-cache identical-hash verification
  was not performed (would require a second checkout); the mechanism
  finding stands without it.
- Classification: **confirmed release blocker**, fixable in MVP-2B by
  making `prepublishOnly`/pack flow force-build the workspace (or verify
  freshness) and updating the checklist. Also stale: the checklist calls
  the npm package `designflow` and version `0.1.0` — both outdated.

## 16. Existing smoke script (`scripts/cli-smoke-test.sh`)

- Genuinely installs the packed tarball into a temp global prefix, runs
  the real binary under Node with an isolated `DESIGNFLOW_HOME`, checks
  first-run/onboarding/version/settings/no-stack-trace behavior. Good
  journey coverage for install basics.
- **Currently fails** at its `designflow list | grep -q` step due to the
  EPIPE defect (#8) — exit 1, reproduced.
- Gaps: builds only the CLI (inherits blocker #15 — can smoke-test a
  stale bundle); no local-project install, no npx form, no doctor, no
  project registration, no runtime-registration assertions, no
  optional-Playwright matrix, no exit-130 interrupt journey.

## 17. Security/privacy

- Tarball scan: no key-shaped strings (OpenRouter/GitHub/AWS/private-key
  patterns), no `.env`, no absolute user paths, no `.claude-flow/`, no git
  metadata, no screenshots or local project content. The 24 pattern hits
  for "env" are all `process.env[...]` code references (safe). Fabricated
  test values exist only in test sources, which are not packed.
- Isolated state after audit: config + runs store only; no secrets
  persisted (config never stores credential values — verified behavior).

## Blockers (for MVP-2B)

1. **B1 — Manifest entry points:** `main`/`types`/`exports` reference
   nonexistent `dist/index.js`/`.d.ts` (area 1).
2. **B2 — Stale-dist packaging:** `prepublishOnly`/pack flow can bundle
   stale workspace `dist`; release checklist lacks a forced-build mandate
   and carries an outdated package name/version (area 15).
3. **B3 — EPIPE crash:** unhandled stdout `EPIPE` crashes piped commands
   and currently fails the repository's own smoke test (areas 8/16).

## Non-blocking limitations

- `npx designflow` vs `npx designflow-ai` naming mismatch — docs +
  registry-name check needed (area 7).
- `--version` on first run prints onboarding before the version line.
- Playwright browser-download journey and live invalid-credential behavior
  unverified (deferred to L5 real-environment validation; no
  real-environment validation is claimed by this audit).
- Smoke script journey gaps (see 16).
- Bundled dependency graph is not auditable via npm metadata (inherent to
  bundling; document it).

## Recommended MVP-2B implementation order

1. B3 (EPIPE handler — smallest, unblocks the smoke script).
2. B1 (manifest entry points — one-file metadata fix).
3. B2 (force-build in the pack/release flow + checklist correction).
4. Smoke-script extensions (local install, npx form, doctor, registration
   assertions), then re-run the full matrix from this audit.

## Commands executed (abridged; exit codes all recorded in session)

Forced build (`bunx turbo build --force`, 26/26); `npm pack --dry-run`;
`npm pack --pack-destination <scratchpad>`; tarball listing/extraction;
`npm install [--omit=optional]` in two fresh temp projects;
`npm install -g --prefix <tmp>`; `npm exec --yes --package=<tgz> --
designflow --help`; the full non-destructive command matrix; invalid
figma-config probes; deterministic `run design-engineer`;
`scripts/cli-smoke-test.sh` (exit 1 — EPIPE); bundle/tarball grep scans;
controlled `dist`-absence reproduction (restored); temp worktree attempt
for EPIPE bisect (removed; could not build). All temporary install
directories, homes, prefixes, extracted package, and the `.tgz` were
created outside the repository and removed after evidence collection.

**Confirmation:** no distribution fix was implemented; no production code,
tests, manifests, or lockfiles were modified; the repository tree is
unchanged except this document.

---

# Implementation status — MVP-2B-1: broken-pipe handling (2026-08-05)

**Blocker B3 is complete.** B1 (manifest entry points) and B2 (stale-dist
pack flow) remain open; MVP-2 is NOT complete.

- **Root cause:** the CLI installed no stdout/stderr `error` listener, so
  when a pipeline consumer closed the pipe early (`designflow workers |
  grep -q …`), the socket's asynchronous `EPIPE` became an unhandled
  `'error'` event and crashed with a stack trace. A second subtlety found
  during the fix: stdout writes are buffered, so the EPIPE for the final
  lines can arrive *after* `main()` returns while the event loop drains —
  the handler must remain installed through process exit (it is now
  removed early only on the exceptional path; one invocation per process,
  nothing leaks).
- **Mechanism:** one `BrokenPipeCoordinator`
  (`apps/designflow-cli/src/services/broken-pipe.ts`) recognizes exactly
  `code === "EPIPE"` on stdout and stderr (no platform-equivalent codes
  were added — no repository evidence required them), marks the stream
  broken, and fires a single callback regardless of how many streams or
  events break. Unrelated stream errors are rethrown and keep their
  normal crash-visible behavior. `print()` becomes a safe no-op for a
  broken stdout (plus a sync-EPIPE guard), so no caller catches EPIPE
  manually and nothing is ever written to a stream known closed —
  including never reporting a stderr EPIPE to stderr.
- **Exit code:** a broken stdout ends the invocation with **exit 0** —
  the consumer already got what it needed, and the repository's own smoke
  script runs under `set -o pipefail`, which would misreport any nonzero
  status as a pipeline failure. A real Ctrl+C still wins: interrupt exit
  130 takes precedence even if the pipe also broke.
- **Active operations:** the broken-pipe callback calls the
  SignalCoordinator's new `abortQuietly()` — the same root cancellation
  signal Ctrl+C uses, but counted as a host cancellation, not an
  interrupt: no notice line, no 130, no forced-exit escalation, no second
  cancellation architecture. All accepted L1-03 cleanup then runs
  (cancelled record, MCP child teardown, store close). The `interrupted`
  getter now reflects only real user interrupts.
- **Regression tests (8 new):** 6 coordinator unit tests (both streams,
  once-only cancellation, unrelated-error passthrough + default rethrow,
  idempotent install/uninstall with no listener accumulation across 20
  invocations) and 2 subprocess acceptance tests — an informational
  `workers` run whose consumer closes after the first chunk (exit 0, no
  stack trace, no EPIPE text) and an active fake-MCP-backed workflow whose
  stdout is severed mid-run (PIPE-BROKEN → quiet cancellation → persisted
  `cancelled` record, no `running` execution, MCP child pid dead, CLOSED
  cleanup marker on stderr, exit 0, and no interrupt notice). SIGINT
  acceptance re-run unchanged and green.
- **Smoke test:** `scripts/cli-smoke-test.sh` now passes end to end
  (exit 0, "SMOKE TEST PASSED") — previously failing at its
  `designflow list | grep -q` step. The script itself was not modified.
- **Validation:** build 26/26, typecheck 44/44, lint 26/26, tests
  2,320 pass / 1 skip / 0 fail, all `--force`, `Cached: 0`.
- **Limitation:** if a command had already failed for an unrelated reason
  *and* stdout then broke, the invocation still reports 0 — attribution
  of a failure that the consumer never saw is not attempted at MVP scope.
