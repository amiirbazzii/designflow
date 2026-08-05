#!/usr/bin/env bash
# scripts/prepare-cli-package.sh
#
# The canonical package-preparation step for the `designflow-ai` CLI.
# Invoked automatically by npm's `prepack` lifecycle (so both `npm pack`
# and `npm publish` run it, even from the package directory) and by the
# CLI smoke test. Consumers installing the packed tarball never run it.
#
# The published bundle inlines every workspace package THROUGH ITS BUILT
# `dist` OUTPUT, and `tsc -b` incremental state (package-root
# tsconfig.tsbuildinfo) can consider stale or hand-corrupted output
# up to date because it compares timestamps, not content. Release
# preparation therefore never trusts existing generated output:
#
#   1. remove the generated `dist` directories and tsbuildinfo state for
#      everything that can reach the bundle (packages/, workflows/, and
#      the CLI itself) — generated output only, never source, never user
#      state, never .claude-flow/;
#   2. rebuild the full workspace graph with the Turborepo cache bypassed.
#
# The full forced graph (26 packages) is deliberate: the bundle's runtime
# graph spans sdk, core, product, agents, models, mcp, tools, workers,
# artifacts, state, storage-*, capabilities/* and workflows/*, and a
# narrower filter would have to be re-proven every time a dependency is
# added. Fail-fast: any build failure aborts the pack.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "designflow-ai prepack: refreshing workspace build output from source"

# Generated-output hygiene (build products only).
find packages workflows apps/designflow-cli \
  -type d -name dist -not -path "*/node_modules/*" -prune -exec rm -rf {} + 2>/dev/null || true
find packages workflows apps/designflow-cli \
  -name "*.tsbuildinfo" -not -path "*/node_modules/*" -delete 2>/dev/null || true

# Forced rebuild from current source, in two explicit phases. The phases
# matter: designflow-ai deliberately declares no workspace dependencies
# (its bundle is self-contained), so Turbo has no graph edge ordering the
# CLI bundle after the packages it inlines — everything else must be
# provably built first, then the CLI bundle alone.
bunx turbo build --force --filter='!designflow-ai'
bunx turbo build --force --filter=designflow-ai

# The one file the tarball ships must exist and be non-trivial.
BUNDLE="$ROOT/apps/designflow-cli/dist/main.js"
if [ ! -s "$BUNDLE" ]; then
  echo "prepare-cli-package: dist/main.js was not produced" >&2
  exit 1
fi
head -c 19 "$BUNDLE" | grep -q "#!/usr/bin/env node" || {
  echo "prepare-cli-package: dist/main.js lost its shebang" >&2
  exit 1
}

echo "designflow-ai prepack: workspace output rebuilt (turbo build --force)"
