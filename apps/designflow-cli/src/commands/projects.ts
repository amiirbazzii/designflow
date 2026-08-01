// apps/designflow-cli/src/commands/projects.ts
import { resolve } from "node:path";
import {
  heading,
  type Terminal,
} from "../ui/terminal";

import type { CliContext } from "../services/cli-runner";
import {
  DesignFlowError,
  type ProjectIdentity,
} from "@designflow/sdk";

/**
 * `designflow projects`, `projects add`, `projects inspect` and `projects
 * show`.
 *
 * A project is durable, inspectable state — never a directory a command
 * reaches into on its own. Every path shown here came from a person
 * registering it with `projects add`; nothing in this file names a directory
 * that was not already approved that way.
 */

export async function projectsCommand(context: CliContext, terminal: Terminal): Promise<number> {
  const projects = await context.projects.listProjects();

  terminal.print(heading("Projects"));

  if (projects.length === 0) {
    terminal.print("No projects registered yet.");
    terminal.print();
    terminal.print("Register one with  designflow projects add --name <name> --path <path>");
    return 0;
  }

  for (const project of projects) {
    terminal.print();
    printSummary(terminal, project);
  }

  terminal.print();
  return 0;
}

export interface ProjectsAddOptions {
  readonly name?: string;
  readonly path?: string;
  readonly inspect?: boolean;
}

export async function projectsAddCommand(
  context: CliContext,
  terminal: Terminal,
  options: ProjectsAddOptions,
): Promise<number> {
  if (options.name === undefined) {
    terminal.print("A project needs a name. For example:");
    terminal.print();
    terminal.print("  designflow projects add --name Storefront --path ./storefront");
    return 1;
  }

  const project = await context.projects.createProject({
    name: options.name,
    // Absolute, `resolve`d against the CLI's own cwd — the composition
    // root's job, since it is the one Node-hosted layer here; `ProjectService`
    // itself has no `node:path` dependency so it can be bundled anywhere.
    ...(options.path !== undefined ? { rootPath: resolve(options.path) } : {}),
  });

  terminal.print(heading("Project registered"));
  printSummary(terminal, project);

  if (options.inspect === true) {
    terminal.print();
    return inspectAndReport(context, terminal, project.id);
  }

  terminal.print();
  terminal.print(`Inspect it any time with  designflow projects inspect ${project.id}`);
  return 0;
}

export async function projectsInspectCommand(
  context: CliContext,
  terminal: Terminal,
  projectId: string,
): Promise<number> {
  return inspectAndReport(context, terminal, projectId);
}

async function inspectAndReport(
  context: CliContext,
  terminal: Terminal,
  projectId: string,
): Promise<number> {
  try {
    const changes = await context.projects.inspectProject(projectId);
    terminal.print(heading("Inspected"));
    terminal.print(`Found ${changes.length} fact${changes.length === 1 ? "" : "s"}.`);
    terminal.print();
    terminal.print(`See them with  designflow projects show ${projectId}`);
    return 0;
  } catch (error) {
    return reportProjectError(terminal, projectId, error);
  }
}

export async function projectsShowCommand(
  context: CliContext,
  terminal: Terminal,
  projectId: string,
): Promise<number> {
  let project: ProjectIdentity;
  try {
    project = await context.projects.getProject(projectId);
  } catch (error) {
    return reportProjectError(terminal, projectId, error);
  }

  terminal.print(heading(project.name));
  printSummary(terminal, project);

  const contextRecord = await context.projectContext.getContext(projectId);

  if (contextRecord.facts.length === 0) {
    terminal.print();
    terminal.print("No facts recorded yet.");
    terminal.print(`Inspect it with  designflow projects inspect ${projectId}`);
    return 0;
  }

  terminal.print();
  terminal.print("Facts");
  for (const fact of [...contextRecord.facts].sort((a, b) => a.key.localeCompare(b.key))) {
    terminal.print(`  ${fact.key}: ${renderFactValue(fact.value)}  (${fact.source})`);
  }

  terminal.print();
  return 0;
}

function printSummary(terminal: Terminal, project: ProjectIdentity): void {
  terminal.print(`  ${project.name}`);
  if (project.rootPath !== undefined) terminal.print(`    Path: ${project.rootPath}`);
  terminal.print(`    Project: ${project.id}`);
}

function renderFactValue(value: unknown): string {
  return Array.isArray(value) ? value.join(", ") : String(value);
}

function reportProjectError(terminal: Terminal, projectId: string, error: unknown): number {
  if (error instanceof DesignFlowError && error.code === "ERR_PROJECT_NOT_FOUND") {
    terminal.print(`No project with that id: ${projectId}`);
    terminal.print();
    terminal.print("Run  designflow projects  to see the ones that do exist.");
    return 1;
  }

  throw error;
}
