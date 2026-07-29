# First-Run Experience and Local Application Shell

**Date:** 2026-07-30
**Status:** Accepted
**Stage:** 34

## Context

Stage 32 made DesignFlow installable and Stage 33 gave it a vocabulary people
recognise. What it still lacked was the thing between those two: `npm install -g
designflow` put a binary on the path and said nothing, and the first invocation
behaved like a script someone had left lying around. It wrote a config file
silently, printed a menu of three actions, reported a bare version number, and
answered a permissions failure with a stack trace.

Stage 34 is about the twenty seconds after the install finishes.

## 1. The Installation Experience

```
$ npm install -g designflow
$ designflow

Welcome to DesignFlow.

Your AI workforce in the terminal.

──────────────────────────────────────────────

Set up  ~/.designflow

  config.json    settings you can edit
  history/       your previous runs
  cache/         working space

Nothing leaves this machine. There is no account to create.

DesignFlow AI
──────────────────────────────────────────────

Options:

  1. Use an AI Worker
  2. View History
  3. Settings
  4. Exit
```

Three decisions are in that output.

**Onboarding lists what was written.** An installed application that creates a
directory in someone's home and does not say so is asking to be distrusted. The
last line is there for the same reason: the most reasonable thing to wonder
about a new AI tool is what it sends where, and the answer is worth stating
before anyone has to ask.

**Onboarding is a preamble, not a wall.** There is no "press enter to continue"
and no setup wizard. `designflow list` on a fresh install prints the welcome and
then the workers — the command still runs. A first run that interrupts the thing
the user asked for trades one moment of polish for an obstacle.

**It shows on any first command**, not only on bare `designflow`. Someone whose
first instinct is `designflow list` deserves the introduction too.

### Where first-run state lives

The brief said to check whether the directory exists. That signal is one
half-finished run away from being wrong: a first invocation that dies after
`mkdir` but before writing the config leaves a directory that exists and an
installation that was never set up, and the directory check would skip setup
forever.

`firstRunCompleted` in the config is the authority instead. It subsumes the
directory check — a missing directory means a missing config, which loads as
`false` — and it is written last, so setup is either recorded as complete or
runs again. A test drives exactly that half-created state.

### `firstRun` is not the same as `newInstall`

Verification against a real pre-Stage-34 home found the flaw in using one flag
for both questions. A user upgrading from a CLI that predates
`firstRunCompleted` has a config *without* that key, so setup genuinely has work
to do — but they were shown the full onboarding, which told them DesignFlow had
"Set up ~/.designflow" and that `history/` held their previous runs. It set up
nothing; their runs were in the `databasePath` they already had. The product's
first impression after an upgrade was inaccurate.

`HomeState` now carries both:

| | Meaning | Drives |
|---|---|---|
| `firstRun` | setup had work to do | writing the flag, creating directories |
| `newInstall` | there was no config at all | whether onboarding prints |

`newInstall` is read *before* anything is created, because once the directories
exist there is no way left to tell the two cases apart. The cost is that an
interrupted first run leaves a config behind and so loses its welcome — a rare
crash, traded against a wrong greeting shown to every upgrading user, which is
the better way round.

## 2. Configuration Design

`~/.designflow/config.json`:

```json
{
  "version": 1,
  "firstRunCompleted": true,
  "environment": "local",
  "databasePath": "history/runs.json",
  "settings": {}
}
```

The brief asked for safe reading, safe writing, defaults and a
migration-friendly structure. Each of those is a specific change from what
Stage 32 shipped.

**Safe reading is field-wise, not all-or-nothing.** The previous
implementation parsed the whole file and fell back to defaults on any failure.
That throws away every good setting because of one bad one — and worse, it resets
`firstRunCompleted`, so a single hand-edited typo would replay onboarding and
re-introduce the CLI to someone who had used it for a month. `migrateConfig`
keeps every value that validates and defaults only the ones that do not.

**Safe writing is atomic.** Temp file plus `rename`, matching what `FileStore`
already does for run data. The CLI writes this file during startup, so a
truncated write would break the next launch — the worst possible moment.

**Migration-friendliness is `version` being an open integer.** It was
`z.literal(1)`, which meant a config written by a *newer* CLI failed validation
and got silently overwritten with defaults — the exact opposite of forward
compatibility. It is now `z.number().int().positive()`, preserved as read and
written back unchanged, so an older binary reads a newer file instead of
clobbering it. `CONFIG_VERSION` records what this CLI writes.

Nothing here authenticates, holds a key, or names a server, and the Settings
screen is tested for the absence of all three — that screen is where such a
promise would most easily get made by accident.

### `history/` and `cache/`

`history/` is real: the default `databasePath` moved from `designflow.json` to
`history/runs.json`, so the directory the brief asked for is where run history
actually lives rather than an empty folder beside it.

`cache/` is created and **nothing writes to it**. It is a reserved location, and
saying so is more honest than inventing a use for it. See Known Limitations.

## 3. The Shell

| | Before | After |
|---|---|---|
| Header | `Welcome to DesignFlow` + tagline | `DesignFlow AI` |
| Menu | 3 options | 4 — Settings added |
| Worker picker | auto-selected when one worker | always lists; blank picks the first |
| `--version` | `0.1.0` | `DesignFlow 0.1.0` |
| Errors | `error.message` | problem + suggested action |

**The welcome moved.** "Welcome to DesignFlow" is a first-run line now, so the
menu that appears every session says what the application is called rather than
greeting someone who has been here fifty times.

**The worker picker always lists.** Auto-selecting the only worker saved a
keystroke and hid the catalogue the menu exists to show — and made the registry's
dynamism invisible in the single-worker case that is every current install.
Pressing return still picks the first, so nothing got slower.

**Nothing in the shell names a worker.** A test strips comments from every
non-test source file and fails on `design-engineer`, `Design Engineer` or (for
every file but the composition root) `design-to-code`; another registers a worker
at runtime and finds it in the menu. A hardcoded name would work until the
catalogue changed, and then quietly lie.

That test began as a check on two likely files and passed. Widening it to all of
them during verification caught two it had not thought to look at: `cli.ts`
printed `designflow run design-engineer` when `run` was given no argument, and
`history.ts` printed it as the empty-state hint. Both now derive the example from
the registry via `runExample()`, falling back to `<worker>`. The composition root
keeps its exception because naming the workflow package it installs is its job.

**Settings reads; it does not write.** Editing a JSON file is something users
already know how to do, and a prompt-driven editor for four fields would be more
code and more ways to corrupt the file than the file is worth.

**`CLI_VERSION` moved to `version.ts`** and is asserted equal to
`package.json`'s. The duplication is unavoidable — the published entry point is a
bundled `dist/main.js` that cannot reliably resolve its own manifest — so the
test is what catches a release reporting a number it did not ship.

## 4. Error Handling

Every surfaced error answers two questions: what went wrong, in the user's terms,
and what to try next. Mapping is by error **code**, never by matching message
text, because codes are what `DesignFlowError` publishes as a contract and prose
is not.

```
DesignFlow's directory path runs through a file, not a folder.

Check DESIGNFLOW_HOME — one of the names in that path is a file.
```

Filesystem codes (`EACCES`, `EPERM`, `ENOSPC`, `EROFS`, `ENOTDIR`) are mapped
alongside the domain ones, because they are the most likely thing to go wrong on
a real machine and the least likely to explain themselves. An unmapped code
falls through to the error's own message plus a suggestion — a fallback, not a
gap, since domain messages are usually specific and it is the *suggestion* they
lack.

`DESIGNFLOW_DEBUG=1` restores the stack trace. "No stack traces by default" must
not become "no way to diagnose this"; the default serves the user and the flag
serves whoever has to fix it.

`createCliContext()` moved **inside** `main`'s try block. Preparing
`~/.designflow` is filesystem work, so it is precisely where a permissions
problem surfaces — and it was the one failure that could still escape as a raw
trace. A test spawns the real binary against a broken `DESIGNFLOW_HOME` and
asserts on what the process actually prints, in both modes.

## 5. Architecture

```
CLI  ──→  Product Layer  ──→  Workers  ──→  Workflows
```

Unchanged, and re-tested. `services/cli-runner.ts` remains the only file naming
the engine. Two new boundaries:

**`services/home.ts` does filesystem work and prints nothing.** It returns a
`HomeState`; `dispatch` renders `onboarding()` from `ui/terminal.ts`. That split
is what makes the first-run path assertable without a terminal, and a test
asserts `home.ts` contains no `console.`, no `process.stdout` and not even the
word "Welcome".

**`ui/errors.ts` maps; it does not print.** `formatError` returns a string.

`CliContextOptions` gained an optional `workers` registry. A host embedding the
CLI can supply a curated catalogue, and it is the only way to exercise "no
workers installed" without the shell hardcoding a name to check for.

No engine internal, repository or artifact store is reachable from any new file;
the existing import-boundary tests cover the new ones by construction, and a
Stage 34 test names each one explicitly.

## 6. Files Changed

**Created**

```
apps/designflow-cli/src/version.ts              CLI_VERSION
apps/designflow-cli/src/services/home.ts        directory layout + first-run/upgrade detection
apps/designflow-cli/src/commands/settings.ts    the Settings screen
apps/designflow-cli/src/ui/errors.ts            code → problem + suggestion
apps/designflow-cli/src/shell.test.ts           35 tests
docs/adr/20260730-first-run-experience.md       this document
```

**Modified**

```
services/config.ts        firstRunCompleted, field-wise recovery, atomic write,
                          open version, history/ default, updateConfig
services/cli-runner.ts    initializeHome; home + databasePath on the context;
                          optional workers override
cli.ts                    onboarding on newInstall, settings command,
                          versioned output, registry-derived run example
commands/interactive.ts   four options, always-listing worker picker
commands/history.ts       registry-derived empty-state hint (it named a
                          workflow id, then a hardcoded worker)
ui/terminal.ts            onboarding, banner, menu, workerMenu, settings,
                          usage, runExample
main.ts                   createCliContext inside the guard; formatError
index.ts                  exports
cli.test.ts               renumbered menu, versioned output, isolated home
scripts/cli-smoke-test.sh five new assertions
README.md                 first run, menu, configuration, error handling
```

`cli.test.ts`'s harness now sets `DESIGNFLOW_HOME` for **every** context, not
only the configuration tests. It did not before, which meant the suite was
reading and writing the developer's real `~/.designflow` — harmless while the
config was write-once, and a genuine problem now that first-run state lives
there, since the tests would have depended on whether anyone had ever run the
CLI on that machine.

## 7. Tests Added

**36 new**, plus 8 existing CLI tests updated for the renumbered menu and the
versioned output. Total: **917 passing, 0 failing** (from 881).

| Requirement | Coverage |
|---|---|
| First run creates `~/.designflow` | 6 — directory, all three entries, onboarding then the command, what it reports, resuming a half-created home, **an upgraded home is neither greeted nor repointed** |
| Config is persisted | 7 — shape, reload, defaults, newer version preserved, field-wise salvage, non-JSON, no temp file left behind |
| Second run skips onboarding | 2 — `firstRun` false with settings intact, and no welcome in a second invocation |
| Main menu appears | 4 — four options in order, Settings, no account/key/endpoint, History returns to the menu |
| Workers load dynamically | 4 — the catalogue is listed, a runtime registration appears, an empty registry empties the menu, **no worker id appears in any printable string across every source file** |
| Version command works | 3 — `--version`, `-v`, and equality with `package.json` |
| Errors are user-friendly | 8 — domain code, filesystem code, unmapped fallback, non-Error throws, trace hidden, trace under debug, **the real process in both modes**, entry point wiring |
| Architecture | 2 — the new files reach no further than the product layer; setup prints nothing |

The smoke test gained five steps and still passes end to end: `npm pack` → `npm
install -g` → first run creates the directory → `--version` names the product →
second run stays quiet → `settings` reports the home → a broken
`DESIGNFLOW_HOME` produces a suggestion and no trace → `list` → `run
design-engineer` → `history` in a separate process → the four-option menu.

The full flow was also driven by hand under Node from a packed tarball,
including a complete `run` with approval.

## 8. Known Limitations

**`cache/` is empty.** Created because the brief asked for it; nothing writes
there. The honest description is a reserved location. A real use — memoising
capability output across runs — belongs to whichever stage needs it, and would
want an eviction policy this stage has no basis to choose.

**The default database path moved**, but only for new installations.
`designflow.json` → `history/runs.json` changes the *default*; field-wise
migration preserves whatever `databasePath` an existing config already names, so
an upgrading user keeps reading the store they were reading before. Verified
against a real pre-Stage-34 home: `databasePath: "designflow.sqlite"` survived
the upgrade untouched, and `settings` reported that path as the live one.

An earlier draft of this document claimed such a user "will appear to have lost
their history". That was wrong — it assumed the default would override their
config, which is exactly what field-wise recovery prevents.

**An interrupted run leaves a stale entry with no way to clear it.** Found by
killing a real session mid-approval during verification: the execution stays at
`waiting_approval` forever, `designflow history` lists it indefinitely, and the
CLI offers no way to resume or discard it. Pre-existing — nothing in Stage 34
caused it — but Stage 34 is what made it visible, since History is now a menu
option a user will actually open. Resuming needs `runner.approve` against a
remembered execution id, which the CLI never surfaces; discarding needs a delete
the product layer does not expose.

**Settings cannot change anything.** It reports paths and points at
`config.json`. Fine while there are four fields, and the wrong shape the moment
there is a setting worth toggling from inside the app.

**Onboarding is one screen with nothing to do.** No sample run offered, no
worker walkthrough. A better first run would end by *doing* something rather
than by describing a menu — but a run costs a form's worth of answers, and
guessing them for someone is worse than showing them the menu.

**`environment` still means nothing.** `local` is the only value, and no code
branches on it. It is a field waiting for a reason.

**Unknown top-level config keys are dropped on write.** Forward compatibility
covers the `version` number and the `settings` bag, not arbitrary keys a future
CLI might add at the top level. `settings` is the documented place for those.

**Nothing carried over from earlier stages was fixed here.** The artifact graph
is still duplicated across three storage backends, only the CLI speaks "worker",
payload blobs still inflate artifact counts, and `resume` still makes an
execution its own predecessor. Stage 34 changed the shell, not the engine.
