# Stage 7 production-readiness record

**Status:** hardening in progress; release candidate not ready
**Package:** `designflow-ai@0.1.1`

This record is intentionally honest about the release gate. The local
deterministic workflows and Stages 1–6 acceptance suites are green, but a
production release cannot be declared until an operator supplies an accessible
Figma design/MCP server and a temporary live model-provider credential for the
real integration scenarios. Synthetic MCP fixtures are not evidence of a real
Figma integration.

## Baseline

The baseline was captured before Stage 7 edits on the Stage 6 completion
revision. The environment was macOS arm64, Bun 1.3.14, Node 22.23.1, Git
2.50.1, npm 10.9.8, and `designflow-ai@0.1.1`. The prior full suite was 2,177
passing, 1 skipped, 0 failing across 2,178 tests. Playwright 1.62.1 resolved
from the workspace and Chromium was installed outside the npm package.
`OPENROUTER_API_KEY`, `FIGMA_ACCESS_TOKEN`, and `FIGMA_TOKEN` were absent, so
no real external acceptance call was attempted.

The package supports npm and Bun directly; pnpm and yarn are recognized by
project inspection. Chromium is an optional runtime dependency: install it
separately with `bunx playwright install chromium` or
`npx playwright install chromium`. Chromium is never bundled in the npm
package.

## Diagnostics

`designflow doctor` is read-only. It checks runtime/configuration, writable
state paths, persisted-state health, provider credential *presence* without
reading the value into output, Figma MCP configuration without launching it,
registered project accessibility and Git status, Playwright resolution, and a
headless Chromium launch. `designflow doctor --json` is suitable for bounded
local automation. A missing provider, Figma server, or Chromium is reported as
`unavailable`, not as a false success.

## Configuration and secrets

The effective precedence is: explicit CLI options; supported project
configuration; `~/.designflow/config.json` (or `DESIGNFLOW_HOME`); environment
variables for credentials and process-local overrides; then safe defaults.
Figma config may name variables under `settings.figmaMcp.envPassthrough`, but it
never stores their values. Provider and MCP output is bounded and existing
artifact inspection redacts credential-shaped keys. `DESIGNFLOW_DEBUG=1` is
for local diagnosis only and must not be used when collecting release evidence.

## Git-aware writes

Before a snapshot/write boundary, DesignFlow records repository status, branch
or detached state, staged target files, unrelated dirty files, and
merge/rebase state. Unrelated dirty work produces a warning and is preserved. A
dirty proposal target or an in-progress merge/rebase/cherry-pick blocks the
write. Non-Git projects remain supported because proposal hashes, canonical
roots, snapshots, and rollback still apply. DesignFlow never runs
`git reset --hard`, commits, or pushes.

## Persisted state and migration policy

The file store is schema version 1. Older documents may omit additive
collections; `FileStore` fills those collections with compatibility defaults on
read and the next normal atomic write materializes them. A future schema
version is rejected. Malformed JSON is preserved by `FileStore` quarantine for
normal runtime recovery; `doctor` uses a separate read-only inspector and does
not quarantine or rewrite it. Incomplete documents, missing artifact payloads,
and future versions are warnings/failures, never silent reinterpretations.

State writes use a sibling lock and atomic temporary-file rename. A live lock
returns `ERR_STORE_LOCKED`; a lock older than the bounded stale threshold may
be reclaimed. This is a single-user local-store guarantee, not a distributed
lock service.

## Failure taxonomy

Stable codes cover configuration and state (`ERR_STORE_CORRUPTED`,
`ERR_STORE_LOCKED`), authentication/provider (`ERR_MODEL_*`, `ERR_MCP_*`),
Figma (`ERR_FIGMA_*`), project/file safety (`ERR_UNSAFE_PATH`,
`ERR_TARGET_FILE_CHANGED`, `ERR_GIT_*`), validation and rollback
(`ERR_REQUIRED_VALIDATION_FAILED`, `ERR_ROLLBACK_FAILED`), browser and visual
validation, approvals, and correction-loop stop reasons. The CLI maps public
codes to a short problem, next action, and safe-started/not-started message;
raw stacks require `DESIGNFLOW_DEBUG=1`.

## Release gate still outstanding

- A real accessible Figma MCP run, including a denied/missing-node case.
- A live provider run for the configured agent boundaries, with a temporary
  credential and provider request/usage evidence.
- A realistic disposable React/TypeScript repository using real Figma evidence
  through implementation, validation, browser comparison, and correction.
- Installed release-candidate acceptance for those integrations, plus
  concurrency and restart checks against that release candidate.
- Performance measurements on representative repositories and a final package
  audit after the release-candidate version is selected.

Until these are supplied and pass, the correct release status is **not ready**;
the installed CLI may be used for deterministic/local acceptance only.
