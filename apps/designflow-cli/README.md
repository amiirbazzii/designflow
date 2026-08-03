# designflow

Your AI workforce in the terminal.

## Install

```bash
npm install -g designflow-ai
```

## First run

The first invocation introduces itself and lays out its application directory:

```
$ designflow

Welcome to DesignFlow.

Your AI workforce in the terminal.

──────────────────────────────────────────────

Set up  ~/.designflow

  config.json    settings you can edit
  history/       your previous runs
  cache/         working space

Nothing leaves this machine. There is no account to create.
```

It then continues straight into the application. Later runs skip the welcome.

## Use

```bash
designflow                        # interactive
designflow list                   # available AI workers
designflow run design-engineer    # put a worker to work
designflow history                # previous runs
designflow artifacts <run-id>     # what a run produced or reused
designflow settings               # where things are kept
designflow --version
designflow --help
```

Every run's output is stored as a DesignFlow artifact — nothing is written
into your project. `designflow artifacts <run-id>` lists what a run produced
or reused; add an artifact id to see its content (generated files print with
their path and contents; everything else prints as formatted JSON).

Interactive mode is the main menu:

```
DesignFlow AI
──────────────────────────────────────────────

Options:

  1. Use an AI Worker
  2. View History
  3. Settings
  4. Exit
```

Option 1 reads the worker registry, so a worker package you install appears
without an upgrade. Scriptable too:

```bash
printf 'homepage.fig\nreact\nbrand/Header, brand/Footer\napprove\n' \
  | designflow run design-engineer
```

Blank answers take the placeholder, so you can press through the form.

## Configuration

`~/.designflow/config.json`, written on first run:

```json
{
  "version": 1,
  "firstRunCompleted": true,
  "environment": "local",
  "databasePath": "history/runs.json",
  "settings": {}
}
```

Edit it by hand — `settings` shows you the path. Three properties hold:

- **Safe reading.** A broken file never blocks a run. Values that parse are
  kept field by field, so one bad setting costs one setting.
- **Safe writing.** Written to a temp file and renamed, so an interrupted write
  leaves the previous config intact.
- **Migration-friendly.** `version` is an open integer, so a file from a newer
  CLI is read rather than discarded. Additive settings go in `settings`.

There is no account, no API key and no endpoint to configure. Set
`DESIGNFLOW_HOME` to move the whole directory.

No native modules, no database server — the CLI runs on any Node 18+.

## When something fails

Errors say what went wrong and what to try, and print no stack trace:

```
$ DESIGNFLOW_HOME=/some/file/home designflow list

DesignFlow's directory path runs through a file, not a folder.

Check DESIGNFLOW_HOME — one of the names in that path is a file.
```

`DESIGNFLOW_DEBUG=1` adds the full trace when you need to diagnose one.

## Architecture

```
designflow CLI → @designflow/product → workflows → engine
       ↑
  @designflow/workers   (the worker catalogue: metadata only)
```

A worker is a product-facing name wrapping one or more workflows. `designflow
list` shows workers; workflow ids are still accepted by `run` so nothing is
unreachable, but they are no longer part of the vocabulary.

`src/services/cli-runner.ts` is the composition root and the only file that
imports the engine. Commands and rendering speak `@designflow/product` alone; a
test enforces that. `src/services/home.ts` does the first-run filesystem work
and prints nothing — the onboarding text lives in `src/ui/terminal.ts`.

Full rationale: `docs/adr/20260728-designflow-cli.md` and
`docs/adr/20260730-first-run-experience.md`.
