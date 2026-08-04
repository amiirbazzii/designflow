// apps/designflow-cli/src/projects-memory.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatch } from "./cli";
import {
  createCliContext,
  type CliContext,
} from "./services/cli-runner";

import { ScriptedTerminal } from "./ui/terminal";
import { explainError } from "./ui/errors";
import { DesignFlowError } from "@designflow/sdk";
import { PROJECT_ERROR_CODES, MEMORY_ERROR_CODES } from "@designflow/product";

/**
 * `designflow projects` and `designflow memory` end to end, driven the way a
 * person would drive the binary — same harness `cli.test.ts` uses.
 */

const workspaces: string[] = [];
const contexts: CliContext[] = [];

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "designflow-cli-projmem-"));
  workspaces.push(dir);
  return dir;
}

function context(): CliContext {
  const home = workspace();
  process.env.DESIGNFLOW_HOME = home;

  const created = createCliContext({ databasePath: join(home, "runs.json") });
  contexts.push(created);
  return created;
}

function projectDirectory(): string {
  const dir = workspace();
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "sample", dependencies: { react: "^18.0.0" } }),
  );
  return dir;
}

afterEach(() => {
  for (const created of contexts.splice(0)) created.close();
  for (const dir of workspaces.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  delete process.env.DESIGNFLOW_HOME;
});

describe("designflow projects", () => {
  test("lists nothing registered yet", async () => {
    const terminal = new ScriptedTerminal([]);
    const code = await dispatch(["projects"], context(), terminal);

    expect(code).toBe(0);
    expect(terminal.transcript).toContain("No projects registered yet.");
  });

  test("add, then list, then show", async () => {
    const built = context();
    const root = projectDirectory();

    const add = new ScriptedTerminal([]);
    expect(await dispatch(["projects", "add", "--name", "Storefront", "--path", root], built, add)).toBe(0);
    expect(add.transcript).toContain("Project registered");
    expect(add.transcript).toContain("Storefront");

    const list = new ScriptedTerminal([]);
    await dispatch(["projects"], built, list);
    expect(list.transcript).toContain("Storefront");

    const projects = await built.projects.listProjects();
    const projectId = projects[0]?.id;
    expect(projectId).toBeDefined();

    const show = new ScriptedTerminal([]);
    await dispatch(["projects", "show", projectId as string], built, show);
    expect(show.transcript).toContain("No facts recorded yet.");
  });

  test("add --inspect records facts immediately", async () => {
    const built = context();
    const root = projectDirectory();

    const add = new ScriptedTerminal([]);
    await dispatch(["projects", "add", "--name", "Storefront", "--path", root, "--inspect"], built, add);
    expect(add.transcript).toContain("Found");

    const projectId = (await built.projects.listProjects())[0]?.id as string;
    const show = new ScriptedTerminal([]);
    await dispatch(["projects", "show", projectId], built, show);

    expect(show.transcript).toContain("project.frameworks");
    expect(show.transcript).toContain("react");
  });

  test("CLI inspect and show surface the complete disposable React fixture context", async () => {
    const built = context();
    const root = workspace();
    writeFileSync(join(root, "package.json"), JSON.stringify({
      name: "stage4-disposable",
      scripts: { build: "tsc -b && vite build", lint: "oxlint" },
      dependencies: { react: "^19.0.0" },
      devDependencies: { typescript: "^5.0.0" },
    }));
    writeFileSync(join(root, "package-lock.json"), "{}\n");
    writeFileSync(join(root, ".env"), "DESIGNFLOW_TEST_SECRET=must-never-leak\n");
    mkdirSync(join(root, "src", "components"), { recursive: true });
    mkdirSync(join(root, "src", "styles"), { recursive: true });
    writeFileSync(join(root, "src", "styles", "tokens.css"), ":root { --color-primary: #635bff; }\n");
    writeFileSync(join(root, "src", "components", "Button.tsx"), "export interface ButtonProps { children: React.ReactNode; variant?: string; disabled?: boolean; }\nexport function Button(props: ButtonProps) { return <button>{props.children}</button>; }\n");

    const add = new ScriptedTerminal([]);
    expect(await dispatch(["projects", "add", "--name", "Stage4", "--path", root], built, add)).toBe(0);
    const projectId = (await built.projects.listProjects())[0]!.id;
    const inspect = new ScriptedTerminal([]);
    expect(await dispatch(["projects", "inspect", projectId], built, inspect)).toBe(0);
    const show = new ScriptedTerminal([]);
    expect(await dispatch(["projects", "show", projectId], built, show)).toBe(0);
    for (const expected of [
      "project.frameworks: react",
      "project.language: typescript",
      "project.packageManager: npm",
      "project.sourceRoot: src",
      "project.styling: css",
      "project.commands: build, lint",
      "src/styles/tokens.css",
      "Button",
      "children",
      "variant",
      "disabled",
    ]) expect(show.transcript).toContain(expected);
    expect(show.transcript).not.toContain("must-never-leak");
  });

  test("inspect is available as its own command", async () => {
    const built = context();
    const root = projectDirectory();
    await dispatch(["projects", "add", "--name", "Storefront", "--path", root], built, new ScriptedTerminal([]));
    const projectId = (await built.projects.listProjects())[0]?.id as string;

    const inspect = new ScriptedTerminal([]);
    const code = await dispatch(["projects", "inspect", projectId], built, inspect);

    expect(code).toBe(0);
    expect(inspect.transcript).toContain("Inspected");
  });

  test("shows a friendly message for an unknown project id", async () => {
    const terminal = new ScriptedTerminal([]);
    const code = await dispatch(["projects", "show", "nope"], context(), terminal);

    expect(code).toBe(1);
    expect(terminal.transcript).toContain("No project with that id: nope");
  });

  test("two projects never cross-deliver facts", async () => {
    const built = context();
    const rootA = projectDirectory();
    const rootB = workspace();
    writeFileSync(join(rootB, "package.json"), JSON.stringify({ name: "b", dependencies: { vue: "^3.0.0" } }));

    await dispatch(["projects", "add", "--name", "A", "--path", rootA, "--inspect"], built, new ScriptedTerminal([]));
    await dispatch(["projects", "add", "--name", "B", "--path", rootB, "--inspect"], built, new ScriptedTerminal([]));

    const allProjects = await built.projects.listProjects();
    const projectA = allProjects.find((p) => p.name === "A") as { id: string };
    const projectB = allProjects.find((p) => p.name === "B") as { id: string };

    const showB = new ScriptedTerminal([]);
    await dispatch(["projects", "show", projectB.id], built, showB);
    expect(showB.transcript).toContain("vue");
    expect(showB.transcript).not.toContain("react");

    const showA = new ScriptedTerminal([]);
    await dispatch(["projects", "show", projectA.id], built, showA);
    expect(showA.transcript).toContain("react");
    expect(showA.transcript).not.toContain("vue");
  });
});

describe("designflow memory", () => {
  test("lists nothing remembered yet", async () => {
    const terminal = new ScriptedTerminal([]);
    const code = await dispatch(["memory"], context(), terminal);

    expect(code).toBe(0);
    expect(terminal.transcript).toContain("Nothing remembered yet.");
  });

  test("add with agent scope, then list, then revoke", async () => {
    const built = context();
    const agentName = built.agentDirectory[0]?.name;
    expect(agentName).toBeDefined();

    const add = new ScriptedTerminal([]);
    await dispatch(
      [
        "memory",
        "add",
        "--scope",
        "agent",
        "--agent",
        agentName as string,
        "--key",
        "prefer.existingComponents",
        "--value",
        "true",
      ],
      built,
      add,
    );
    expect(add.transcript).toContain("Remembered");

    const list = new ScriptedTerminal([]);
    await dispatch(["memory"], built, list);
    expect(list.transcript).toContain("prefer.existingComponents");

    const memories = await built.memory.listMemory({ status: "active" });
    const memoryId = memories[0]?.id as string;

    const revoke = new ScriptedTerminal([]);
    await dispatch(["memory", "revoke", memoryId], built, revoke);

    const afterRevoke = new ScriptedTerminal([]);
    await dispatch(["memory"], built, afterRevoke);
    expect(afterRevoke.transcript).toContain("Nothing remembered yet.");
  });

  test("rejects a secret-like value", async () => {
    const built = context();
    const agentName = built.agentDirectory[0]?.name as string;

    const terminal = new ScriptedTerminal([]);
    await expect(
      dispatch(
        ["memory", "add", "--scope", "agent", "--agent", agentName, "--key", "apiKey", "--value", "sk-abcdefghijk12345"],
        built,
        terminal,
      ),
    ).rejects.toThrow();
  });

  test("an unknown agent name is reported without listing internal ids", async () => {
    const terminal = new ScriptedTerminal([]);
    const code = await dispatch(
      ["memory", "add", "--scope", "agent", "--agent", "Nobody", "--key", "x", "--value", "1"],
      context(),
      terminal,
    );

    expect(code).toBe(1);
    expect(terminal.transcript).toContain('No agent named "Nobody".');
  });

  test("propose (via the service), then approve via the CLI", async () => {
    const built = context();
    const agentId = built.agentDirectory[0]?.id as string;

    const proposal = await built.memoryProposals.propose({
      proposedByAgentId: agentId,
      scope: "agent",
      key: "prefer.existingComponents",
      value: true,
      rationaleSummary: "Prefer existing design-system components.",
    });

    const listTerminal = new ScriptedTerminal([]);
    await dispatch(["memory", "proposals"], built, listTerminal);
    expect(listTerminal.transcript).toContain("suggests remembering");

    const approve = new ScriptedTerminal([]);
    const code = await dispatch(["memory", "approve", proposal.id], built, approve);

    expect(code).toBe(0);
    expect(approve.transcript).toContain("Approved");

    const memories = await built.memory.listMemory({ status: "active" });
    expect(memories.map((m) => m.key)).toContain("prefer.existingComponents");
  });

  test("reject creates no memory", async () => {
    const built = context();
    const agentId = built.agentDirectory[0]?.id as string;

    const proposal = await built.memoryProposals.propose({
      proposedByAgentId: agentId,
      scope: "agent",
      key: "prefer.existingComponents",
      value: true,
      rationaleSummary: "Prefer existing design-system components.",
    });

    const reject = new ScriptedTerminal([]);
    await dispatch(["memory", "reject", proposal.id], built, reject);

    expect(reject.transcript).toContain(`Rejected ${proposal.id}. Nothing was remembered.`);
    expect(await built.memory.listMemory()).toHaveLength(0);
  });

  test("an unknown proposal id is reported cleanly", async () => {
    const terminal = new ScriptedTerminal([]);
    const code = await dispatch(["memory", "approve", "nope"], context(), terminal);

    expect(code).toBe(1);
    expect(terminal.transcript).toContain("No proposal with that id: nope");
  });
});

describe("project and memory error codes are mapped", () => {
  test("every published code is mapped rather than falling through", () => {
    const published = [...PROJECT_ERROR_CODES, ...MEMORY_ERROR_CODES];
    expect(published.length).toBeGreaterThan(10);

    const unmapped = published.filter((code) => {
      const explained = explainError(new DesignFlowError(code, "raw internal text"));
      return explained.suggestion.includes("designflow --help");
    });

    expect(unmapped).toEqual([]);
  });

  test("no published code leaks an internal agent/project id vocabulary word", () => {
    for (const code of [...PROJECT_ERROR_CODES, ...MEMORY_ERROR_CODES]) {
      const explained = explainError(
        new DesignFlowError(code, "Agent design-engineer-agent may not do that"),
      );
      const shown = `${explained.problem} ${explained.suggestion}`.toLowerCase();
      expect(shown).not.toContain("design-engineer-agent");
    }
  });
});
