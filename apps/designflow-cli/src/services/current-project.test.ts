import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ProjectIdentity } from "@designflow/sdk";
import {
  canonicalProjectPath,
  detectCurrentProject,
  ensureCurrentProject,
} from "./current-project";
import {
  createCliContext,
  type CliContext,
} from "./cli-runner";
import { interactiveRunOptions } from "../commands/interactive";
import { describeRequest } from "../commands/run";
import { menu } from "../ui/terminal";

const temporaryDirectories: string[] = [];
const contexts: CliContext[] = [];

function temporaryDirectory(prefix = "designflow-current-project-"): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function projectDirectory(name = "spendly"): string {
  const root = temporaryDirectory();
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name }));
  return root;
}

function context(): CliContext {
  const home = temporaryDirectory("designflow-current-project-home-");
  process.env.DESIGNFLOW_HOME = home;
  const created = createCliContext({ databasePath: join(home, "runs.json") });
  contexts.push(created);
  return created;
}

afterEach(() => {
  for (const created of contexts.splice(0)) created.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
  delete process.env.DESIGNFLOW_HOME;
});

describe("current interactive project", () => {
  test("detects a recognized project from its root", () => {
    const root = projectDirectory();

    expect(detectCurrentProject(root)).toEqual({
      name: "spendly",
      rootPath: canonicalProjectPath(root),
    });
  });

  test("resolves a child directory to the same repository root", () => {
    const root = projectDirectory();
    const child = join(root, "packages", "web");
    mkdirSync(child, { recursive: true });

    expect(detectCurrentProject(child)?.rootPath).toBe(canonicalProjectPath(root));
  });

  test("reuses an existing project record for the canonical root", async () => {
    const built = context();
    const root = projectDirectory();
    const existing = await built.projects.createProject({
      name: "Existing Spendly",
      rootPath: root,
    });

    const detected = await ensureCurrentProject(
      built,
      detectCurrentProject(root),
    );

    expect(detected?.id).toBe(existing.id);
    expect(detected?.name).toBe("Existing Spendly");
    expect(await built.projects.listProjects()).toHaveLength(1);
  });

  test("creates and then reuses one internal record on repeated launches", async () => {
    const built = context();
    const root = projectDirectory();

    const first = await ensureCurrentProject(built, detectCurrentProject(root));
    const second = await ensureCurrentProject(built, detectCurrentProject(root));

    expect(first?.id).toBeDefined();
    expect(second?.id).toBe(first?.id);
    expect(await built.projects.listProjects()).toHaveLength(1);
  });

  test("passes the detected project id through the existing run path options", () => {
    const project = {
      id: "project-spendly",
      name: "Spendly",
      rootPath: "/tmp/spendly",
      createdAt: "2026-08-09T00:00:00.000Z",
      updatedAt: "2026-08-09T00:00:00.000Z",
    } satisfies ProjectIdentity;

    const destination = {
      label: "/dashboard",
      kind: "page" as const,
      path: "/dashboard",
      sourcePath: "src/app/dashboard/page.tsx",
    };

    expect(interactiveRunOptions(project, destination)).toMatchObject({
      interactive: true,
      productExperience: true,
      projectId: "project-spendly",
      destination,
    });
    expect(describeRequest({ designFile: "homepage.fig" }, destination)).toContain(
      "destination: /dashboard",
    );
    expect(interactiveRunOptions(project, destination)).not.toHaveProperty(
      "projectWriteConsent",
    );
    expect(interactiveRunOptions(project, destination)).not.toHaveProperty("approval");
    expect(interactiveRunOptions(null)).not.toHaveProperty("projectId");
  });

  test("renders a bounded no-project state without registering a directory", async () => {
    const built = context();
    const empty = temporaryDirectory("designflow-no-project-");

    expect(detectCurrentProject(empty)).toBeNull();
    expect(await ensureCurrentProject(built, null)).toBeNull();
    expect(await built.projects.listProjects()).toHaveLength(0);
    expect(menu(null)).toContain("No project detected");
    expect(menu(null)).toContain(
      "Run DesignFlow from your project directory.",
    );
  });

  test("renders connected and unavailable Figma states without technical details", () => {
    expect(menu(null, { status: "connected" })).toContain("  Connected");
    expect(menu(null, { status: "connected" })).not.toContain("3845");

    const unavailable = menu(null, { status: "unavailable" });
    expect(unavailable).toContain("Not connected");
    expect(unavailable).toContain("Open Figma Desktop and enable Dev Mode.");
    expect(unavailable).not.toContain("MCP");
  });
});
