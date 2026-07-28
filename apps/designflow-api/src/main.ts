#!/usr/bin/env bun
// apps/designflow-api/src/main.ts
import { createApiHost } from "./host";
import { createRouter } from "./router";

/**
 * Server entry point.
 *
 * `Bun.serve` rather than a framework: the router is already a
 * `Request => Response` function, so nothing else is needed to put it on a
 * port.
 */
const port = Number(process.env.PORT ?? 4000);
const databasePath = process.env.DESIGNFLOW_DB ?? "designflow.sqlite";

const host = createApiHost({ databasePath });
const handle = createRouter(host);

Bun.serve({ port, fetch: handle });

process.stdout.write(
  `DesignFlow API listening on http://localhost:${port}\n` +
    `Database: ${databasePath}\n`,
);
