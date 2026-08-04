# DesignFlow user guide

## Install on macOS

Install Node 18 or newer, then install the CLI:

```bash
npm install -g designflow-ai
designflow --version
```

For browser-backed visual validation, install Chromium separately:

```bash
npx playwright install chromium
```

The browser is intentionally not bundled with DesignFlow.

## First run

Run `designflow doctor` to check the local installation. Register a project
explicitly; DesignFlow never scans an arbitrary folder supplied to a workflow:

```bash
designflow projects add --name storefront --path ./storefront
designflow projects
designflow projects show <project-id>
```

The local home is `~/.designflow`. Set `DESIGNFLOW_HOME` temporarily when you
need a separate installation or a disposable acceptance run.

## Figma and model providers

The Figma MCP path is experimental and off by default. Configure the approved
MCP command and the names of environment variables under `settings.figmaMcp`;
put credential values only in the process environment. Never paste a real
credential into `config.json`, a prompt, or an artifact.

OpenRouter is optional. Export `OPENROUTER_API_KEY` only for the process that
needs a live model call. `doctor` reports whether a credential is present but
never prints its value. Missing credentials and unavailable permissions stop
honestly; they do not produce synthetic success.

## Running and approving work

```bash
designflow list
designflow run design-engineer
```

The implementation and visual-correction paths show the exact files, hashes,
validation commands, and expected results before a write. Approve only the
proposal you inspected. Rejecting writes nothing. A required validation failure
restores the snapshot automatically.

## Resume and inspect

Use the existing run and artifact commands to inspect durable history. For the
Stage 6 feedback loop:

```bash
designflow feedback-loop show <parent-id>
designflow feedback-loop resume <parent-id>
designflow feedback-loop stop <parent-id>
designflow artifacts <parent-id>
```

Repeated resume of a completed parent is read-only and returns the same final
report. An approval is bound to the exact project fingerprint, report, files,
and proposal, so an external edit requires a new proposal.

## Safe cleanup

`designflow cleanup` expires stale transient sessions and approvals; it does
not remove completed history or project files. To remove local DesignFlow
state, first copy any artifacts you need, stop active runs, then move
`~/.designflow` to the macOS Trash or delete it deliberately. Do not remove a
project directory to clean DesignFlow state.

## Troubleshooting

- `browser: unavailable`: install Chromium with the command above.
- `model-provider: unavailable`: set a temporary provider credential or use
  deterministic mode.
- `figma: unavailable`: enable and configure the experimental MCP path, then
  verify account permissions and node IDs.
- `ERR_STORE_LOCKED`: wait for the other local process; only remove a stale
  lock after confirming no DesignFlow process is using the home.
- `ERR_STORE_CORRUPTED`: preserve the quarantined file and restore a compatible
  backup; do not overwrite it blindly.
- dirty proposal target or Git conflict: finish or save the user's work and
  generate a fresh proposal. DesignFlow never discards it.
