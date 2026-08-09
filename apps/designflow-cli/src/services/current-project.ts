import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import type { ProjectIdentity } from "@designflow/sdk";
import type { CliContext } from "./cli-runner";

const MAX_PARENT_LEVELS = 12;

export interface DetectedProject {
  readonly name: string;
  readonly rootPath: string;
}

/**
 * Finds the nearest useful project without crawling outside a short ancestor
 * chain. Git roots win over package markers so a package inside a repository
 * is still associated with the repository's project identity.
 */
export function detectCurrentProject(startDirectory = process.cwd()): DetectedProject | null {
  const start = canonicalDirectory(startDirectory);
  if (start === null) return null;

  const home = canonicalDirectory(homedir());
  let current = start;
  let packageProject: DetectedProject | undefined;

  for (let level = 0; level <= MAX_PARENT_LEVELS; level++) {
    const isUserHome = home !== null && current === home;
    if (!isUserHome) {
      const packageName = readPackageName(current);
      const hasPackageMarker = existsSync(join(current, "package.json"));
      if (existsSync(join(current, ".git"))) {
        return {
          name: packageName ?? basename(current),
          rootPath: current,
        };
      }

      if (packageProject === undefined && hasPackageMarker) {
        packageProject = {
          name: packageName ?? basename(current),
          rootPath: current,
        };
      }
    }

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return packageProject ?? null;
}

/**
 * Reuses a project record by canonical root, or creates the equivalent record
 * through the existing product project service. No project id is surfaced to
 * the interactive user.
 */
export async function ensureCurrentProject(
  context: CliContext,
  detected: DetectedProject | null,
): Promise<ProjectIdentity | null> {
  if (detected === null) return null;

  const projects = await context.projects.listProjects();
  const existing = projects.find(
    (project) =>
      project.rootPath !== undefined &&
      canonicalProjectPath(project.rootPath) === detected.rootPath,
  );
  if (existing !== undefined) return existing;

  return context.projects.createProject({
    name: detected.name,
    rootPath: detected.rootPath,
  });
}

export function canonicalProjectPath(path: string): string | null {
  return canonicalDirectory(path);
}

function canonicalDirectory(path: string): string | null {
  try {
    const candidate = realpathSync(resolve(path));
    return statSync(candidate).isDirectory() ? candidate : null;
  } catch {
    return null;
  }
}

function readPackageName(rootPath: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(join(rootPath, "package.json"), "utf8"),
    );
    if (typeof parsed !== "object" || parsed === null || !("name" in parsed)) {
      return undefined;
    }

    const name = (parsed as { name?: unknown }).name;
    return typeof name === "string" && name.trim().length > 0
      ? name.trim()
      : undefined;
  } catch {
    return undefined;
  }
}
