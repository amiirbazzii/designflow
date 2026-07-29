# DesignFlow CLI

**Date:** 2026-07-28
**Status:** Accepted
**Stage:** 32

## Context

The product direction is a terminal-based tool a person installs with
`npm install -g designflow` and runs by typing `designflow`. Stage 30's demo
proved the interaction model; Stage 31 made runs durable. Neither is
installable.

Stage 32 builds the CLI foundation: the binary, its commands, its config, and
the tiering that will still hold when workers replace workflows.

## 1. CLI Architecture

```
User
  ↓
designflow CLI              apps/designflow-cli
  │  main.ts                stdin/stdout, process.exit — nothing else
  │  cli.ts                 argv parsing and dispatch
  │  commands/              list · run · history · interactive
  │  ui/terminal.ts         rendering + the Terminal port
  │  services/config.ts     ~/.designflow/config.json
  │  services/cli-runner.ts ← composition root. The ONLY engine import.
  ↓
@designflow/product         WorkflowRunner
  ↓
workflow packages → engine
```

Four separations, each earning its place:

**`main.ts` owns the process.** It is the only file touching stdin, stdout or
`process.exit`, so every command is testable by calling `dispatch` with a
scripted terminal.

**`ui/terminal.ts` owns rendering.** It knows how to format a heading and pick
a `✓`; it does not know what a workflow is.

**`commands/` own product logic** and speak `@designflow/product` alone.

**`services/cli-runner.ts` is the allowed exception.** `WorkflowRunner` takes
an `ExecutionContract`, and only the engine satisfies it. Wiring has to happen
somewhere; confining it to one file is what keeps "the CLI consumes DesignFlow"
a property of the application rather than a slogan. A test walks the sources
and fails if any other file names `@designflow/core` or a storage backend.

### The naming collision

`apps/cli` already held the npm name `designflow` with a `wf` binary. Two
workspace packages cannot share a name, and `npm install -g designflow` has to
resolve to *this* CLI.

Nothing depended on the old package, so it was renamed to
`@designflow/cli-legacy`, keeping its `wf` bin. That is the only change outside
the new package, and it is a rename rather than a behaviour change.

### Storage is not optional

Every CLI invocation is a new process. History and approvals kept in memory
would vanish between commands, which makes `designflow history` structurally
unable to work. The CLI therefore uses Stage 31's SQLite adapters against
`~/.designflow/designflow.sqlite` — one connection, shared by every adapter.

## 2. Installation

```bash
npm install -g designflow
```

The package publishes `dist` only, and declares `designflow` as its bin.

## 3. Example Usage

```
$ designflow
Welcome to DesignFlow

AI workflows that turn ideas into results.

Available actions:

  1. Run workflow
  2. View history
  3. Exit

Choose an action [1 / 2 / 3]: 1

$ designflow run design-to-code
Design file (homepage.fig): homepage.fig
Framework (react) [react / vue / svelte]: react
Frames (comma separated) (...): brand/Header, brand/Footer

  ✓ Analyze design
  ✓ Extract design tokens
  → Create component structure
  ○ Generate code
  ○ Validate output

Approval required
──────────────────────────────────────────────
DesignFlow wants permission to:

  Generate production files

Reason: Approval required by policy rule "approve-code-generation"

Approve? [approve / reject]: approve

Complete
──────────────────────────────────────────────
Design → Code finished — created 5 artifacts.
Took 19 ms.

  Created  5
  Reused   0

Artifacts
  Design analysis  (created)
  Design tokens  (created)
     from Design analysis
  ...
  5 stored payloads not listed.

Run id: 1c211114-daf9-4d44-a221-b09f333b8604
```

`designflow history` in a *later* process still lists that run.

## 4. Files Created

```
apps/designflow-cli/
  package.json               name: designflow, bin: designflow
  tsconfig.json
  README.md
  src/main.ts                process entry (interactive + piped stdin)
  src/cli.ts                 argv parsing and dispatch
  src/index.ts               barrel
  src/commands/list.ts
  src/commands/run.ts
  src/commands/history.ts
  src/commands/interactive.ts
  src/ui/terminal.ts         rendering, Terminal port, ScriptedTerminal
  src/services/config.ts     ~/.designflow/config.json
  src/services/cli-runner.ts composition root
  src/cli.test.ts            33 tests
```

Modified: `apps/cli/package.json` (renamed to `@designflow/cli-legacy`).

## 5. Tests Added

33, all driving `dispatch` against a real SQLite file:

| Requirement | Coverage |
|---|---|
| CLI starts successfully | 4 — banner, menu, clean exit, bad choice |
| `list` returns workflows | 2 |
| `run` starts through product APIs | 8 — including approval, rejection, blank answers |
| `history` displays previous executions | 4 — including one that closes the context and reopens the file |
| No forbidden engine imports | 3 |
| Command parsing | 5 — help, aliases, version, unknown command, no-args |
| Configuration | 6 |

The binary was also exercised by hand: `--help`, `list`, a full gated run with
approval, then `history` from a **separate process** against the same
`~/.designflow`, which listed the earlier run.

## 6. Known Limitations

**Workflows are still workflows.** The brief says the worker abstraction comes
later, so `list` and `run` name workflows by id. Inventing worker vocabulary
now would mean renaming it when the abstraction actually arrives.

**Input field descriptors live in the CLI.** `WorkflowManifest` carries no
field metadata, so `run.ts` holds a map from workflow id to fields. The form is
*generated* from that map rather than written per workflow, so a second
workflow is an entry rather than a new prompt sequence — but the descriptors
belong on the manifest. This is now the third consumer carrying the same map
(demo, web, CLI), which is the clearest argument yet for moving it.

**No live progress on a fresh terminal draw.** The checklist reprints rather
than redrawing in place; there is no cursor control or spinner. Adding one
means either a TUI dependency or ANSI handling, and neither is foundation work.

**Piped and interactive input are handled separately.** `readline/promises`
stalls after its first read on a non-TTY, so scripted input is drained up
front. Only the prompting commands read stdin — draining it for
`designflow list` would block on a pipe that never closes.

**Single user, single machine.** No auth, no remote host, no sync. The
`environment` config key exists so a later stage has somewhere to put a remote,
and does nothing today.

**The old CLI still ships.** `@designflow/cli-legacy` retains its `wf` binary
and its commands. Removing it is a separate decision; this stage only freed the
name.
