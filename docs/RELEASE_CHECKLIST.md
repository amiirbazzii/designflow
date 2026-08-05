# Release Checklist (`designflow-ai` npm package)

Manual steps for cutting and publishing a release of the `designflow-ai`
package — the npm package is `designflow-ai`, the installed command is
`designflow` — published from `apps/designflow-cli`, currently at version
`0.1.1`. Follow in order. Do not skip steps.

> **`npm publish` requires separate human confirmation.** This checklist
> documents the full process, but the publish step itself must be run
> deliberately by a human, not automated as part of routine agent work.

## 0. Preconditions

- [ ] Working tree is clean (`git status`) and you are on `main`, up to date
      with `origin/main`. Release-candidate validation must start from a
      clean Git state — the only permitted local noise is explicitly
      ignored local tooling state (e.g. `.claude-flow/`).
- [ ] You have npm publish rights for the `designflow-ai` package on the npm
      registry, and are logged in (`npm whoami`).

## 1. Bump the version

- [ ] The version lives **only** in `apps/designflow-cli/package.json`
      (`"version": "0.1.1"` today). The root `package.json` is
      `"private": true` and has no `version` field — there is nothing to keep
      in sync there.
- [ ] Bump it by hand, or with `npm version <patch|minor|major>` run from
      inside `apps/designflow-cli`. Follow semver based on the changes since
      the last tag.
- [ ] Update `CHANGELOG.md` (if/when one exists) with the new version's
      notable changes.

## 2. Run the full gate

From the repo root:

```bash
bun run build && bun run typecheck && bun run lint && bun test
```

- [ ] `build` succeeds (runs `turbo build`, which builds every workspace
      package including `apps/designflow-cli/dist/main.js`).
- [ ] `typecheck` succeeds with no errors.
- [ ] `lint` succeeds with no errors.
- [ ] `test` (via `bun test`) passes.

All four must pass before continuing.

## 3. Run the packaged install smoke test

```bash
bash scripts/cli-smoke-test.sh
```

This runs `npm pack` — whose `prepack` hook
(`scripts/prepare-cli-package.sh`) deletes all generated workspace `dist`
output and `tsc` incremental state, then force-rebuilds the entire
workspace graph from current source before bundling the CLI. That hook is
the canonical package-preparation path: it protects both `npm pack` and
`npm publish`, run from any directory. **`npm pack --ignore-scripts` is
not a valid release path** — it bypasses the freshness rebuild and can
package stale dependency output. The smoke test then installs the resulting tarball into a
throwaway global npm prefix, and exercises the CLI end-to-end under plain
`node` (not `bun`) against an empty `DESIGNFLOW_HOME`. It is the closest
local proxy to what a real `npm install -g designflow-ai` user experiences.

- [ ] Script prints `SMOKE TEST PASSED` at the end.
- [ ] If it fails, do not proceed — fix the underlying issue and re-run the
      full gate (step 2) and this smoke test before continuing.

## 4. Sanity-check package contents

From `apps/designflow-cli`:

```bash
npm pack --dry-run
```

- [ ] Confirm the file list only includes `dist/` (per the `files` field in
      `package.json`) plus npm's always-included files (`package.json`,
      `README.md`, `LICENSE`). No `src/`, tests, or other extraneous files
      should appear. Expected: exactly 4 files
      (`LICENSE`, `README.md`, `dist/main.js`, `package.json`).
- [ ] Confirm `dist/main.js` starts with `#!/usr/bin/env node` (so it runs
      under plain Node, not just Bun).
- [ ] `LICENSE` lives at `apps/designflow-cli/LICENSE`, a copy of the root
      `LICENSE` (npm only packs files inside the package directory being
      published, not the repo root). If the root `LICENSE` ever changes,
      copy it here again before publishing — it is not a symlink and will
      not update itself.
- [ ] Verify the isolated-install experience directly, not just the file
      list:
      ```bash
      npm pack
      mkdir -p /tmp/designflow-release-test && cd /tmp/designflow-release-test
      npm install -g --prefix ./npm-global <path-to-tarball>
      PATH="$PWD/npm-global/bin:$PATH" DESIGNFLOW_HOME=$PWD/df-home designflow --version
      PATH="$PWD/npm-global/bin:$PATH" DESIGNFLOW_HOME=$PWD/df-home designflow workers
      ```
      Confirm no `@designflow/*` or `workspace:*` resolution errors — the
      published bundle is dependency-free (verified: `bun build`'s
      `--target=node --format=esm` bundling already inlines every
      `@designflow/*` internal package into the one `dist/main.js` file; a
      plain `npm install -g` needs to fetch zero additional packages).

## 5. Commit and tag

- [ ] Commit the version bump (and changelog, if applicable):
      ```bash
      git add apps/designflow-cli/package.json
      git commit -m "release: designflow vX.Y.Z"
      ```
- [ ] Tag the release, matching the published version:
      ```bash
      git tag vX.Y.Z
      ```
- [ ] Push the commit and tag:
      ```bash
      git push origin main
      git push origin vX.Y.Z
      ```

## 6. Publish

> **Do not run this as part of routine/automated work.** This step requires
> explicit human confirmation, run manually, by someone with publish rights.

From `apps/designflow-cli` (the package with the `bin` entry — **not** the
repo root, which is a private, unpublishable workspace root):

```bash
cd apps/designflow-cli
npm publish
```

- [ ] `prepublishOnly` (`bun run build`) runs automatically and produces a
      fresh `dist/main.js` before the tarball is created.
- [ ] Confirm the published version on the npm registry:
      ```bash
      npm view designflow-ai version
      ```

## 7. Smoke-test the ACTUALLY PUBLISHED package

This is distinct from step 3 — step 3 tests a local tarball; this step tests
what a real user gets from the real registry, after publish has propagated.

```bash
npm install -g designflow-ai@latest
designflow --version
designflow list
npm uninstall -g designflow-ai
```

- [ ] `designflow@latest` installs cleanly with plain `npm`/`node` (no `bun`
      required on the machine doing this check).
- [ ] `designflow --version` reports the version just published.
- [ ] `designflow list` runs without error and shows onboarding / worker
      list as expected.
- [ ] Uninstall afterward to leave the test machine clean.

## 8. Post-publish

- [ ] Announce the release (release notes, changelog, wherever relevant).
- [ ] Open a follow-up issue for anything deferred during the release (e.g.
      known gaps surfaced during hardening).
