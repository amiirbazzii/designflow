import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

describe("repository architecture boundaries", () => {
  test("keeps acceptance projects outside application source", () => {
    expect(existsSync(resolve(root, "apps/designflow-cli/tmp"))).toBe(false);
    expect(existsSync(resolve(root, "test-fixtures/designflow-stage7-preview/package.json"))).toBe(true);
  });

  test("keeps fake MCP infrastructure in package test fixtures", () => {
    expect(existsSync(resolve(root, "packages/mcp/src/fake-server-entry.ts"))).toBe(false);
    expect(existsSync(resolve(root, "packages/mcp/test/fixtures/fake-server/fake-server-entry.ts"))).toBe(true);
    expect(readFileSync(resolve(root, "packages/mcp/src/index.ts"), "utf8")).not.toContain("fake-server");
  });

  test("gives core execution an application ownership boundary", () => {
    expect(existsSync(resolve(root, "packages/core/src/application/execution/execution-service.ts"))).toBe(true);
    expect(existsSync(resolve(root, "packages/core/src/service/execution-service.ts"))).toBe(false);
    expect(readFileSync(resolve(root, "packages/core/src/service/index.ts"), "utf8")).toContain("Compatibility entry point");
  });

  test("does not leave test-support modules in production source trees", () => {
    const candidates = [
      "packages/capabilities/figma-mcp/src/in-memory-mcp-client.test-support.ts",
      "workflows/workflow-design-to-code/src/harness.test-support.ts",
    ];
    for (const candidate of candidates) expect(existsSync(resolve(root, candidate))).toBe(false);
  });
});
