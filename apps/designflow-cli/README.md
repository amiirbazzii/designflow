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

## Quick start

```bash
npm install -g designflow-ai
cd my-project          # a real frontend project (e.g. React + Vite)
designflow
```

That is the whole setup. On the first run DesignFlow:

1. **Detects your project** from the current directory — no project ids to
   register, no UUIDs to paste.
2. **Finds Figma Desktop** automatically — no MCP configuration to write.
   Keep the Figma desktop app running with your design file open.
3. **Asks you to sign in with Google** — one browser sign-in connects the
   managed DesignFlow AI service. There is no API key to obtain or configure.
   The session is stored locally and reused on later runs; `designflow logout`
   clears it.

After that, a run asks exactly two questions before work begins:

- **Which design?** Use your current Figma selection, or paste a Figma URL
  (the URL's node is authoritative).
- **Where should it go?** For example, a new page.

DesignFlow then reads the design, understands your project, and prepares an
implementation proposal. **Nothing is written to your project without your
approval**: you see a *Ready to apply* summary with exact per-file diffs, and
only approving those exact changes writes them — behind a snapshot, with the
project build validated afterwards. Rejecting leaves your project untouched.

When changes are applied, DesignFlow opens a preview, captures the rendered
result, compares it against the design, and shows a truthful **Visual
result**. When the findings are actionable it offers **Improve** — one
bounded correction iteration, whose exact diff again needs your approval.

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

Your project stays local. DesignFlow AI access uses secure Google sign-in.
```

It then continues straight into the application. Later runs skip the welcome.
Your project files stay on your machine: proposals and diffs are computed
locally, and only bounded design/model context is exchanged with the managed
AI service.

## Commands

```bash
designflow                        # interactive — the normal way to run
designflow doctor                 # check setup; see what is ready to run
designflow settings               # show configuration, agents, feature status
designflow logout                 # clear the local DesignFlow AI session
designflow history                # previous runs
designflow artifacts <run-id>     # what a run produced or reused
designflow traces                 # what past AI decisions did
designflow --version
designflow --help
```

Every run's output is stored as a DesignFlow artifact — proposals never touch
your project until approved. `designflow artifacts <run-id>` lists what a run
produced or reused; add an artifact id to see its content.

## When something fails

Failures are explained in plain language — what happened, whether your files
were changed, and what to try — with an optional bounded technical-details
view. Errors print no stack trace:

```
$ DESIGNFLOW_HOME=/some/file/home designflow list

DesignFlow's directory path runs through a file, not a folder.

Check DESIGNFLOW_HOME — one of the names in that path is a file.
```

`DESIGNFLOW_DEBUG=1` adds the full trace when you need to diagnose one.

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

Set `DESIGNFLOW_HOME` to move the whole directory.

No native modules, no database server — the CLI runs on any Node 18+.

## Advanced / development

Everything below is optional. The normal journey above needs none of it.

### Direct execution

`designflow run design-engineer` runs the worker non-interactively; workflow
ids are still accepted by `run`. Answers can be piped for scripting.

### Bring your own model (development)

Instead of the managed Google sign-in, a development setup may talk to
OpenRouter directly by exporting `OPENROUTER_API_KEY` in the shell
environment. It is never written to `config.json`, never printed, and never
stored. Model profiles for the five specialized agents can then be overridden
in `config.json`:

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

### Custom Figma MCP server (development)

Figma Desktop is discovered automatically. To point at a different MCP
server, add a `figmaMcp` block to `~/.designflow/config.json`. A server you
launch yourself:

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
server. It never holds a value. For a local HTTP endpoint instead:

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

`designflow doctor` distinguishes a block that is absent from one that is
present but unusable.

### Manual project registration (development)

Projects are detected from the working directory. `designflow projects add
--name my-app --path ./my-app` remains available for registering a project
explicitly.

## Architecture

```
designflow CLI → @designflow/product → workflows → engine
       ↑
  @designflow/workers   (the worker catalogue: metadata only)
```

A worker is a product-facing name wrapping one or more workflows. Workers are
shown by the interactive flow; workflow ids are still accepted by `run` so
nothing is unreachable.

`src/services/cli-runner.ts` is the composition root and the only file that
imports the engine. Commands and rendering speak `@designflow/product` alone; a
test enforces that. `src/services/home.ts` does the first-run filesystem work
and prints nothing — the onboarding text lives in `src/ui/terminal.ts`.

Full rationale: `docs/adr/20260728-designflow-cli.md` and
`docs/adr/20260730-first-run-experience.md`.
