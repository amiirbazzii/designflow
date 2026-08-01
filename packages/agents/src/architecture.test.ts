// packages/agents/src/architecture.test.ts
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The agent layer's dependency boundary.
 *
 * Agents decide; they do not execute, store or persist. That is a property of
 * what this package is *allowed to import*, not of how carefully it is
 * written, so it is checked mechanically. The day someone reaches for a
 * repository to "just look something up", this fails.
 */

function sources(dir: string): readonly string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);

    if (statSync(path).isDirectory()) {
      found.push(...sources(path));
      continue;
    }

    if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) found.push(path);
  }

  return found;
}

/**
 * A source file with its comments removed.
 *
 * The prose in this package names the things it must not touch — explaining
 * that the runtime does not call `WorkflowRunner` requires writing
 * `WorkflowRunner`. Scanning the code alone keeps the rule about what the
 * package *does* rather than about what it is allowed to discuss.
 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const FORBIDDEN = [
  "@designflow/core",
  "@designflow/artifacts",
  "@designflow/state",
  "@designflow/storage-file",
  "@designflow/storage-sqlite",
  "@designflow/product",
  "@designflow/workers",
  "@designflow/tools",
  "@designflow/models",
  "@designflow/model-provider-openrouter",
  "designflow-cli",
];

describe("the agents package depends on the SDK alone", () => {
  test("imports no engine, storage, product or CLI package", () => {
    const offenders: string[] = [];

    for (const path of sources(import.meta.dir)) {
      const contents = code(path);

      for (const pkg of FORBIDDEN) {
        if (contents.includes(pkg)) {
          offenders.push(`${path.split("/").slice(-2).join("/")} → ${pkg}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("declares only the SDK and Zod as dependencies", () => {
    const manifest: unknown = JSON.parse(
      readFileSync(join(import.meta.dir, "..", "package.json"), "utf8"),
    );

    const dependencies =
      typeof manifest === "object" && manifest !== null && "dependencies" in manifest
        ? manifest.dependencies
        : {};

    expect(Object.keys(dependencies as Record<string, string>).sort()).toEqual([
      "@designflow/sdk",
      "zod",
    ]);
  });

  test("names no repository, artifact store or execution service", () => {
    // The runtime creates a decision. Nothing it touches can run one.
    for (const path of sources(import.meta.dir)) {
      const contents = code(path);

      for (const forbidden of [
        "ExecutionService",
        "ExecutionRepository",
        "WorkflowRunner",
        "ArtifactStore",
        "ArtifactRegistry",
        "ApprovalManager",
        "EventPublisher",
      ]) {
        expect(contents).not.toContain(forbidden);
      }
    }
  });

  test("prints nothing", () => {
    // A library package logs through the SDK `Logger`, never to a terminal.
    for (const path of sources(import.meta.dir)) {
      const contents = code(path);

      expect(contents).not.toContain("console.");
      expect(contents).not.toContain("process.stdout");
    }
  });

  test("carries no LLM provider SDK dependency", () => {
    // Stage 38 makes this package model-capable, so "no LLM dependency" no
    // longer means "no mention of a model at all" — the Design Engineer's
    // default profile names a real model slug, and that slug legitimately
    // contains a vendor prefix (`openai/gpt-4o-mini`, routed through
    // OpenRouter). What must still be true is narrower and just as real: no
    // provider *SDK* is imported. Every model call goes through the
    // `ModelInvoker` port declared in `@designflow/sdk`, resolved by
    // `@designflow/models` — never a vendor's own client library, which is
    // exactly the coupling `ModelProvider` exists to keep one layer away.
    for (const path of sources(import.meta.dir)) {
      const contents = code(path);
      const imports = [...contents.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);

      for (const forbidden of [
        "@ai-sdk/",
        "openai",
        "@anthropic-ai/",
        "langchain",
        "@designflow/model-provider-openrouter",
      ]) {
        for (const specifier of imports) {
          expect(specifier?.toLowerCase().includes(forbidden)).toBe(false);
        }
      }
    }
  });

  test("never calls a provider endpoint directly", () => {
    // Every model call reaches a provider through `ModelInvoker.generate`,
    // resolved by whatever this package was constructed with — never a raw
    // HTTP call this package makes on its own. `fetch` appearing here at all
    // would mean a provider integration had leaked into the agent layer.
    for (const path of sources(import.meta.dir)) {
      expect(code(path)).not.toContain("fetch(");
    }
  });
});
