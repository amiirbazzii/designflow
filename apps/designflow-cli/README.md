# designflow

Your AI workforce in the terminal.

## Install

```bash
npm install -g designflow-ai
```

The npm package is named `designflow-ai`; the installed command is
`designflow`. To run it without installing, use the package name:

```bash
npx --yes designflow-ai --help
```

(`npx designflow` would resolve a different, unrelated npm package.)

This package is a command-line application, not a JavaScript library:
it exposes the `designflow` binary and no importable API.
`import "designflow-ai"` is intentionally not supported.

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
designflow run design-engineer --visual-correction=once  # one beta iteration
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

Blank answers stay absent, so the coordinator can ask for missing information.

## Quick start: working from a Figma design

```bash
npm install -g designflow-ai      # or: npx --yes designflow-ai doctor
designflow doctor                 # what is configured, and what is ready to run
```

`doctor` ends with a **Design Engineer readiness** section: model mode, Figma
connection, registered projects, visual validation, and whether a
specification or an implementation proposal can run. It is read-only, and an
incomplete setup is reported rather than treated as a failure — it still
exits 0. Work through what it names:

**1. Optional — live model reasoning.** Without a credential DesignFlow runs
in a deterministic fallback; that mode is real and supported, not a stub. For
live reasoning, set the variable in your shell environment only:

```bash
export OPENROUTER_API_KEY=…
```

It is never written to `config.json`, never printed, and never stored.

**2. Connect Figma.** Add a `figmaMcp` block to `~/.designflow/config.json`.
A server you launch yourself:

```json
{
  "settings": {
    "figmaMcp": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "your-figma-mcp-server"],
      "envPassthrough": ["FIGMA_ACCESS_TOKEN"]
    }
  }
}
```

`envPassthrough` lists environment variable *names* to forward to that
server. It never holds a value. For a Figma Desktop local endpoint instead:

```json
{
  "settings": {
    "figmaMcp": {
      "transport": "http",
      "url": "http://127.0.0.1:3845/mcp"
    }
  }
}
```

Run `designflow doctor` again — a block that is present but unusable is
reported differently from one that is absent, so you can tell "not set up
yet" from "set up wrong".

**3. Register a project, if you want proposed code changes.**

```bash
designflow projects add --name my-app --path ./my-app
```

A specification runs without one. An implementation proposal needs one.

**4. Run it.**

```bash
designflow run design-engineer                 # specification only
designflow run design-engineer --project <id>  # may propose changes
```

Two separate gates, and neither implies the other: passing `--project` asks
for **journey consent** ("prepare changes for this project?"), and any actual
write then needs **approval of the exact proposed changes**. Declining
consent continues as a specification.

### Model profiles

`designflow settings` lists the five specialized agents behind the worker,
each with its profile id and whether a field is built-in or overridden.
Override any of them in `config.json`:

```json
{
  "settings": {
    "models": {
      "profiles": {
        "figma-specification-default": {
          "providerId": "openrouter",
          "model": "some/model-slug",
          "temperature": 0.2,
          "maxOutputTokens": 4096,
          "timeoutMs": 60000
        }
      }
    }
  }
}
```

Those five fields are the only ones an override may set; anything else is
ignored.

### What is supported today

| Capability | Status |
| --- | --- |
| Design specification from a connected Figma design | supported |
| Implementation proposal and apply | supported, always consent- and approval-gated |
| Visual correction (Beta) | off by default; offered only after actionable findings |
| Legacy scaffold workflow | compatibility only |

Known limitations of this milestone: the final canonical Journey 6 did not
obtain a product-owned CORRECTION_APPLIED_AND_IMPROVED result, and Coordinator
routing can safely stop after its bounded output-repair attempts. MVP-4
separately live-proved implementation generation, compile/coverage gates,
approval/apply, visual detection, correction preflight, mounted validation,
rollback, and root cancellation. Visual validation needs the optional
Playwright package *and* an installed Chromium; `doctor` distinguishes those
two.

Visual correction is a bounded beta continuation. It is offered only when the
completed implementation run has a valid applied baseline, visual evidence,
and actionable findings. It is off by default; `--visual-correction=once` or
one explicit interactive confirmation authorizes one iteration. The host
computes artifact references and hashes. Each exact correction proposal needs
its own approval, and a correction may stop as unavailable, inconclusive,
rejected, cancelled, stale, or rolled back. The internal correction JSON is
not a user input.

MVP-4 live evidence verified implementation generation, compile/coverage
gates, approval/apply, visual detection, correction preflight, mounted
validation, rollback, and root cancellation. The final canonical Journey 6
did not obtain a product-owned `CORRECTION_APPLIED_AND_IMPROVED` result.
Coordinator routing can also safely stop after its bounded output-repair
attempts. These are known limitations; invalid output cannot create a
workflow, approval, or project write.

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
