#!/usr/bin/env bun
// packages/mcp/src/fake-server-entry.ts
//
// A protocol-faithful fake MCP server, run as a real, separate process over
// real stdio pipes — the same transport `McpRuntime` speaks to a real
// server. Not part of this package's public API (see `index.ts`); tests
// spawn this file directly via `bun run` to prove the stdio transport
// itself, not merely a mocked-out client method.
//
// Configured entirely through one environment variable, `FAKE_MCP_FIXTURES`,
// a JSON-encoded `FakeMcpFixtures` (see `fake-server-fixtures.ts`) — so one
// script serves every test in this package and in `@designflow/capability-figma-mcp`
// without hand-writing a new server for each scenario.

import { createInterface } from "node:readline";
import { fakeMcpFixturesSchema } from "./fake-server-fixtures";

const raw = process.env["FAKE_MCP_FIXTURES"];
const fixtures = fakeMcpFixturesSchema.parse(raw !== undefined ? JSON.parse(raw) : {});

function reply(id: string | number, result: unknown): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function replyError(id: string | number, code: number, message: string): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}

const rl = createInterface({ input: process.stdin });

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (trimmed.length === 0) return;

  let request: { id: string | number; method: string; params?: unknown };
  try {
    request = JSON.parse(trimmed);
  } catch {
    return;
  }

  const { id, method, params } = request;

  if (method === "initialize") {
    reply(id, { protocolVersion: "2024-11-05", serverInfo: { name: "fake-mcp-server" } });
    return;
  }

  if (method === "tools/list") {
    reply(id, { tools: fixtures.tools });
    return;
  }

  if (method === "tools/call") {
    const toolName = (params as { name?: string } | undefined)?.name ?? "";

    if (fixtures.unknownTools.includes(toolName)) {
      replyError(id, -32601, `Method not found: ${toolName}`);
      return;
    }

    const delay = fixtures.delayMs[toolName];
    const respond = (): void => {
      if (fixtures.errorTools.includes(toolName)) {
        reply(id, { isError: true, content: fixtures.toolResults[toolName] ?? "tool failed" });
        return;
      }

      if (fixtures.oversizedTools.includes(toolName)) {
        reply(id, { content: "x".repeat(fixtures.oversizedByteCount) });
        return;
      }

      reply(id, { content: fixtures.toolResults[toolName] ?? null });
    };

    if (delay !== undefined && delay > 0) {
      setTimeout(respond, delay);
    } else {
      respond();
    }
    return;
  }

  replyError(id, -32601, `Method not found: ${method}`);
});
