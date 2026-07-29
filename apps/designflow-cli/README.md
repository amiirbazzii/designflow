# designflow

AI workflows that turn ideas into results, from your terminal.

## Install

```bash
npm install -g designflow
```

## Use

```bash
designflow                        # interactive
designflow list                   # available AI workers
designflow run design-engineer    # put a worker to work
designflow history                # previous runs
designflow --help
```

Scriptable too:

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
  "environment": "local",
  "databasePath": "designflow.json",
  "settings": {}
}
```

Runs are stored in a JSON document beside it, which is why `designflow history`
still works tomorrow. Set `DESIGNFLOW_HOME` to move the whole directory.

No native modules, no database server — the CLI runs on any Node 18+.

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
test enforces that.

Full rationale: `docs/adr/20260728-designflow-cli.md`.
