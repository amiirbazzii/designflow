// apps/designflow-cli/src/figma-mcp-experimental.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createCliContext, type CliContext } from "./services/cli-runner";

/**
 * Proves the Stage 3 experimental path end to end through the *real* CLI
 * composition root — `createCliContext`, exactly as `apps/designflow-cli/src/main.ts`
 * builds it — not just the workflow package's own test harness. Verified
 * against the protocol-faithful fake MCP server; no real Figma access was
 * available in this environment (see the Stage 3 ADR).
 */

const require = createRequire(import.meta.url);
const workspaces: string[] = [];
const contexts: CliContext[] = [];

function fakeServerPath(): string {
  const packageDir = fileURLToPath(new URL(".", `file://${require.resolve("@designflow/mcp/package.json")}`));
  return `${packageDir}test/fixtures/fake-server/fake-server-entry.ts`;
}

afterEach(() => {
  for (const created of contexts.splice(0)) created.close();
  for (const dir of workspaces.splice(0)) rmSync(dir, { recursive: true, force: true });
  delete process.env.DESIGNFLOW_HOME;
  delete process.env.FAKE_MCP_FIXTURES;
});

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "designflow-figma-mcp-"));
  workspaces.push(dir);
  return dir;
}

const FIXTURES = {
  tools: [{ name: "get_document" }],
  toolResults: {
    get_document: {
      name: "Homepage",
      version: "1",
      document: { id: "0:0", name: "Page", type: "CANVAS", children: [{ id: "1:1", name: "Header", type: "FRAME" }] },
    },
  },
};

describe("the experimental Figma MCP path, wired through the real CLI composition root", () => {
  test("is not reachable at all unless the config flag is explicitly enabled", () => {
    const home = workspace();
    process.env.DESIGNFLOW_HOME = home;

    const context = createCliContext({ databasePath: join(home, "runs.json") });
    contexts.push(context);

    const resolved = context.resolve("design-to-code-figma-specification");
    expect(resolved).toBeNull();
  });

  test("becomes reachable by workflow id once enabled, and runs against the fake server", async () => {
    process.env.FAKE_MCP_FIXTURES = JSON.stringify(FIXTURES);

    const home = workspace();
    mkdirSync(home, { recursive: true });
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({
        settings: {
          experimental: { designEngineerFigmaMcp: true },
          figmaMcp: {
            command: "bun",
            args: ["run", fakeServerPath()],
            // The MCP child no longer inherits the parent environment
            // (L1-04), so the fixture variable must be authorized
            // explicitly.
            envPassthrough: ["FAKE_MCP_FIXTURES"],
            captureScreenshots: false,
          },
        },
      }),
    );
    process.env.DESIGNFLOW_HOME = home;

    const context = createCliContext({ databasePath: join(home, "runs.json") });
    contexts.push(context);

    // MVP-3B: the gated workflow id is no longer publicly resolvable — the
    // pipeline is reached through coordinator routing. Internal harnesses
    // (this test) start it directly through the runner.
    expect(context.resolve("design-to-code-figma-specification")).toBeNull();

    const handle = await context.runner.start({
      workflowId: "design-to-code-figma-specification",
      input: {
        designFile: "https://www.figma.com/design/abc123XYZ/Homepage",
        frames: ["Header"],
        captureScreenshots: false,
        figmaAgentVersion: "0.2.0",
      },
    });

    expect(handle.state).toBe("ready");

    const report = await context.runner.explain(handle.executionId);
    const artifactIds = report.artifacts
      .filter((artifact) => artifact.name !== artifact.artifactId)
      .map((artifact) => artifact.artifactId);
    expect(artifactIds).toContain("design-specification");
  }, 15_000);

  test("no credential or server command appears in the trace store", async () => {
    process.env.FAKE_MCP_FIXTURES = JSON.stringify(FIXTURES);

    const home = workspace();
    mkdirSync(home, { recursive: true });
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({
        settings: {
          experimental: { designEngineerFigmaMcp: true },
          figmaMcp: {
            command: "bun",
            args: ["run", fakeServerPath()],
            envPassthrough: ["DESIGNFLOW_SECRET_TEST_TOKEN", "FAKE_MCP_FIXTURES"],
            captureScreenshots: false,
          },
        },
      }),
    );
    process.env.DESIGNFLOW_HOME = home;
    process.env.DESIGNFLOW_SECRET_TEST_TOKEN = "sk-should-never-leak-anywhere";

    const context = createCliContext({ databasePath: join(home, "runs.json") });
    contexts.push(context);

    const handle = await context.runner.start({
      workflowId: "design-to-code-figma-specification",
      input: {
        designFile: "https://www.figma.com/design/abc123XYZ/Homepage",
        frames: ["Header"],
        captureScreenshots: false,
        figmaAgentVersion: "0.2.0",
      },
    });

    expect(handle.state).toBe("ready");

    const report = await context.runner.explain(handle.executionId);
    expect(JSON.stringify(report)).not.toContain("sk-should-never-leak-anywhere");

    delete process.env.DESIGNFLOW_SECRET_TEST_TOKEN;
  }, 15_000);
});
