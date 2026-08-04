import { afterEach, describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatch } from "./cli";
import { createCliContext, type CliContext } from "./services/cli-runner";
import { ScriptedTerminal } from "./ui/terminal";

const require = createRequire(import.meta.url);
const homes: string[] = [];
const projects: string[] = [];
const contexts: CliContext[] = [];

const FIGMA_FIXTURES = {
  tools: [
    { name: "get_document", description: "Reads the document" },
    { name: "get_variables", description: "Lists variables" },
    { name: "capture_screenshot", description: "Captures a screenshot" },
  ],
  toolResults: {
    get_document: {
      name: "Homepage",
      version: "1",
      document: {
        id: "0:0",
        name: "Page 1",
        type: "CANVAS",
        children: [{ id: "1:1", name: "Header", type: "FRAME", absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 96 } }],
      },
    },
    get_variables: { variables: [{ name: "color.brand", value: "#111827" }] },
    capture_screenshot: {
      data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64"),
      format: "png",
      width: 1440,
      height: 96,
    },
  },
};

function fakeServerPath(): string {
  const packageDir = fileURLToPath(new URL(".", `file://${require.resolve("@designflow/mcp/package.json")}`));
  return `${packageDir}src/fake-server-entry.ts`;
}

function context(flags: { implementation: boolean }): CliContext {
  const home = mkdtempSync(join(tmpdir(), "designflow-stage4-routing-home-"));
  homes.push(home);
  writeFileSync(join(home, "config.json"), JSON.stringify({
    firstRunCompleted: true,
    settings: {
      experimental: {
        designEngineerFigmaMcp: flags.implementation,
        designEngineerImplementation: flags.implementation,
      },
      figmaMcp: {
        command: "bun",
        args: ["run", fakeServerPath()],
        captureScreenshots: false,
      },
    },
  }));
  process.env.DESIGNFLOW_HOME = home;
  process.env.FAKE_MCP_FIXTURES = JSON.stringify(FIGMA_FIXTURES);
  const created = createCliContext({ databasePath: join(home, "runs.json"), requireApproval: true });
  contexts.push(created);
  return created;
}

async function registeredProject(created: CliContext): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "designflow-stage4-routing-project-"));
  projects.push(root);
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "routing-fixture", scripts: { build: "bun --version", lint: "bun --version" }, dependencies: { react: "^19.0.0" } }));
  writeFileSync(join(root, "src", "main.tsx"), "export {}\n");
  return (await created.projects.createProject({ name: "routing-fixture", rootPath: root })).id;
}

afterEach(() => {
  for (const created of contexts.splice(0)) created.close();
  for (const root of [...projects.splice(0)]) rmSync(root, { recursive: true, force: true });
  for (const home of [...homes.splice(0)]) rmSync(home, { recursive: true, force: true });
  delete process.env.DESIGNFLOW_HOME;
  delete process.env.FAKE_MCP_FIXTURES;
});

describe("installed-CLI Stage 4 routing", () => {
  test("experimental mode disabled keeps Design Engineer on design-to-code", () => {
    const created = context({ implementation: false });
    expect(created.resolve("design-engineer")?.workflowId).toBe("design-to-code");
    expect(created.resolve("design-to-code-implementation")).toBeNull();
  });

  test("experimental mode without a project fails clearly before starting a session", async () => {
    const created = context({ implementation: true });
    const terminal = new ScriptedTerminal([]);
    const code = await dispatch(["run", "design-engineer"], created, terminal);
    expect(code).toBe(1);
    expect(terminal.transcript).toContain("A registered project must be selected");
    expect(await created.runner.history()).toHaveLength(0);
  });

  test("the enabled bundle exposes the direct implementation workflow command", () => {
    const created = context({ implementation: true });
    expect(created.resolve("design-to-code-implementation")).toMatchObject({
      workflowId: "design-to-code-implementation",
      workflowInstalled: true,
    });
  });

  test("selected project routes the CLI session to implementation and shows a pre-approval proposal", async () => {
    const created = context({ implementation: true });
    const projectId = await registeredProject(created);
    await dispatch(["projects", "inspect", projectId], created, new ScriptedTerminal([]));
    const terminal = new ScriptedTerminal([
      "https://www.figma.com/design/E958ARSSBoJjblLhxZQVSU/Spendly?node-id=432-2906",
      "react",
      "Header",
      "reject",
    ]);

    const code = await dispatch(["run", "design-engineer", "--project", projectId], created, terminal);
    expect(code).toBe(1);
    const [run] = await created.runner.history();
    expect(run?.workflowId).toBe("design-to-code-implementation");
    expect(terminal.transcript).toContain("Files to create: 1");
    expect(terminal.transcript).toContain("No files have been changed yet");
    expect(terminal.transcript).not.toContain("Store the generated result as a DesignFlow artifact");
  }, 20_000);
});
