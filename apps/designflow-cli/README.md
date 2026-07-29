# designflow

AI workflows that turn ideas into results, from your terminal.

## Install

```bash
npm install -g designflow
```

## Use

```bash
designflow                       # interactive
designflow list                  # what this installation can do
designflow run design-to-code    # run a workflow
designflow history               # previous runs
designflow --help
```

Scriptable too:

```bash
printf 'homepage.fig\nreact\nbrand/Header, brand/Footer\napprove\n' \
  | designflow run design-to-code
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
```

`src/services/cli-runner.ts` is the composition root and the only file that
imports the engine. Commands and rendering speak `@designflow/product` alone; a
test enforces that.

Full rationale: `docs/adr/20260728-designflow-cli.md`.
