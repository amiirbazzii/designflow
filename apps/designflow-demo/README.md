# DesignFlow Demo

A minimal application demonstrating the full DesignFlow lifecycle: choose a
workflow, describe the work, watch it run, approve what needs approving, and
read what it produced.

## Run it

```bash
bun run --filter '@designflow/demo' demo
```

Or script it:

```bash
printf '1\n\n\n\napprove\n' | bun run apps/designflow-demo/src/main.ts
```

Blank answers take the placeholder, so pressing through the form produces a
working run.

## Architecture

The demo is a **consumer** of DesignFlow, not part of it.

```
@designflow/core → @designflow/product → apps/designflow-demo
```

`src/host.ts` is the composition root and the only file that imports
`@designflow/core`. Everything else — the journey and every screen — speaks
`@designflow/product` alone. A test enforces this.

Screens are pure `(product model) => string` functions, so a future web UI can
reuse the view layer by swapping the renderer for components.

Full rationale: `docs/adr/20260728-demo-application.md`.
