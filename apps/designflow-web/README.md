# DesignFlow Web

The MVP interface. Choose a workflow, describe the work, watch it run, approve
what needs approving, read the result, and come back later to find it still
there.

## Run it

Two processes:

```bash
# API + engine + SQLite
bun run --filter '@designflow/api' serve

# Web client (proxies /api to the API)
bun run --filter '@designflow/web' dev
```

Then open http://localhost:5173.

The database is `designflow.sqlite` in the working directory; set
`DESIGNFLOW_DB` to move it. Delete the file to start fresh.

## Architecture

```
@designflow/core → @designflow/product → apps/designflow-api → apps/designflow-web
                                          (composition root)     (browser)
```

The web app imports **no engine package** — only `@designflow/product` for
types and schemas, and its own API client. A test enforces this.

Full rationale: `docs/adr/20260728-mvp-application.md`.
