// packages/tools/src/catalog/project-inspection.ts
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * The pure, bounded directory-walking core shared by `project-summary` (the
 * agent-facing `Tool`, one approved root per install) and `ProjectInspector`
 * (the product-facing port behind `designflow projects inspect`, an approved
 * root per project). Both callers are responsible for their own containment
 * check — `realpath` before ever calling into this module — because
 * containment depends on *why* a root is trusted, which differs between them.
 * Everything below only cares that it has already been given a safe root to
 * walk.
 *
 *   **names only, with one exception.** `package.json` is read because a
 *   project's framework cannot be known without it. Nothing else is opened.
 *
 *   **anything that looks sensitive is skipped by name**, dotfiles included.
 *
 *   **hard caps on depth and entries**, so a symlink farm or an enormous
 *   monorepo cannot turn a summary into a directory walk.
 *
 *   **symlinks skipped entirely** during traversal, never followed.
 *
 * Deterministic for a given tree: entries are sorted.
 */

export const MAX_DEPTH = 3;
export const MAX_ENTRIES = 400;
export const MAX_REPORTED_FILES = 50;
/** package.json is the only file opened; a huge one is not a package.json. */
export const MAX_MANIFEST_BYTES = 1_000_000;

/** Directories that are never interesting and are often enormous. */
export const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  "vendor",
  "target",
  "tmp",
  "temp",
]);

/**
 * Names that may be sensitive even as names.
 *
 * Applied to files and directories alike. Dotfiles are excluded separately,
 * which is what actually catches `.env`, `.git`, `.npmrc` and `.ssh`.
 */
export const SENSITIVE =
  /secret|credential|password|token|private[-_.]?key|\.pem$|\.key$|\.p12$|\.pfx$/i;

/** Files worth reporting, because they say what kind of project this is. */
export const INTERESTING =
  /^(package\.json|tsconfig\.json|README\.md|.*\.(tsx?|jsx?|vue|svelte|css|scss|fig|json)|Dockerfile|Makefile)$/;

export const FRAMEWORK_MARKERS: readonly (readonly [string, string])[] = [
  ["next", "next"],
  ["nuxt", "nuxt"],
  ["astro", "astro"],
  ["@angular/core", "angular"],
  ["react", "react"],
  ["vue", "vue"],
  ["svelte", "svelte"],
  ["solid-js", "solid"],
  ["tailwindcss", "tailwind"],
];

export const LOCKFILES: readonly (readonly [string, string])[] = [
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
];

export const TEST_FRAMEWORK_MARKERS: readonly (readonly [string, string])[] = [
  ["vitest", "vitest"],
  ["jest", "jest"],
  ["mocha", "mocha"],
  ["@playwright/test", "playwright"],
  ["playwright", "playwright"],
  ["ava", "ava"],
];

/** A dependency name containing one of these suggests a design-system package. */
export const DESIGN_SYSTEM_MARKERS: readonly string[] = [
  "design-system",
  "ui-kit",
  "component-library",
];

/** A top-level directory named like one of these suggests where a design system lives. */
export const DESIGN_SYSTEM_DIRECTORY_NAMES = new Set([
  "design-system",
  "ui",
  "components",
]);

export const SOURCE_ROOT_DIRECTORY_NAMES = new Set(["src", "app", "source"]);

export function isSkippedName(name: string): boolean {
  return name.startsWith(".") || SKIPPED_DIRECTORIES.has(name) || SENSITIVE.test(name);
}

/**
 * File names under `root`, bounded and sorted.
 *
 * Sorted at each level so the result is stable across filesystems — readdir
 * order is not guaranteed, and an unstable summary would make whatever reads
 * it non-deterministic for no reason.
 */
export function walkProjectTree(
  root: string,
  signal: AbortSignal,
): {
  readonly relevantFiles: readonly string[];
  readonly topLevelDirectories: readonly string[];
  /**
   * Every directory encountered, at any depth, as a root-relative POSIX path.
   *
   * Bounded exactly the way `relevantFiles` already is — the same traversal,
   * the same `visited` counter — so a monorepo's `packages/ui` is
   * discoverable for design-system detection without a second walk or a
   * looser bound than everything else in this module already has.
   */
  readonly directories: readonly string[];
} {
  const found: string[] = [];
  const topLevelDirectories: string[] = [];
  const directories: string[] = [];
  let visited = 0;

  const descend = (directory: string, depth: number): void => {
    if (depth > MAX_DEPTH || visited >= MAX_ENTRIES || signal.aborted) return;

    let entries: readonly string[];
    try {
      entries = readdirSync(directory).sort();
    } catch {
      // An unreadable directory is not a failure of the summary — a project
      // with one restricted folder still has a name and a framework.
      return;
    }

    for (const name of entries) {
      if (visited >= MAX_ENTRIES || signal.aborted) return;
      if (isSkippedName(name)) continue;

      visited += 1;
      const full = join(directory, name);

      let stats;
      try {
        // `lstat`, not `stat`: a symlink must be identifiable as one so it can
        // be skipped rather than followed out of the root.
        stats = lstatSync(full);
      } catch {
        continue;
      }

      if (stats.isSymbolicLink()) continue;

      if (stats.isDirectory()) {
        if (depth === 0) topLevelDirectories.push(name);
        directories.push(relative(root, full).split(sep).join("/"));
        descend(full, depth + 1);
        continue;
      }

      if (stats.isFile() && INTERESTING.test(name) && found.length < MAX_REPORTED_FILES) {
        found.push(relative(root, full).split(sep).join("/"));
      }
    }
  };

  descend(root, 0);

  return {
    relevantFiles: found,
    topLevelDirectories: topLevelDirectories.sort(),
    directories: directories.sort(),
  };
}

export function readPackageManifest(root: string): Record<string, unknown> | null {
  const path = join(root, "package.json");

  try {
    if (lstatSync(path).size > MAX_MANIFEST_BYTES) return null;

    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));

    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    // No package.json, unreadable, or not JSON. All the same answer: this
    // project has no manifest worth reporting.
    return null;
  }
}

export function dependencyNames(manifest: Record<string, unknown>): readonly string[] {
  const names: string[] = [];

  for (const key of ["dependencies", "devDependencies", "peerDependencies"]) {
    const group = manifest[key];
    if (typeof group === "object" && group !== null && !Array.isArray(group)) {
      names.push(...Object.keys(group));
    }
  }

  return names;
}

export function detectFrameworks(dependencies: readonly string[]): readonly string[] {
  return FRAMEWORK_MARKERS.filter(([dependency]) => dependencies.includes(dependency)).map(
    ([, framework]) => framework,
  );
}

export function detectTestFramework(dependencies: readonly string[]): string | undefined {
  for (const [dependency, framework] of TEST_FRAMEWORK_MARKERS) {
    if (dependencies.includes(dependency)) return framework;
  }
  return undefined;
}

export function detectDesignSystemPackage(dependencies: readonly string[]): string | undefined {
  return dependencies.find((dependency) =>
    DESIGN_SYSTEM_MARKERS.some((marker) => dependency.toLowerCase().includes(marker)),
  );
}

/**
 * Any directory — not only a top-level one — whose own name matches a
 * design-system marker, shortest path first so `ui/` beats
 * `packages/some/nested/ui` when both exist. Catches the common monorepo
 * layout (`packages/ui`, `libs/design-system`) that a top-level-only check
 * would miss entirely.
 */
export function detectDesignSystemDirectory(directories: readonly string[]): string | undefined {
  const candidates = directories.filter((path) => {
    const base = path.split("/").at(-1) ?? path;
    return DESIGN_SYSTEM_DIRECTORY_NAMES.has(base.toLowerCase());
  });

  return [...candidates].sort((left, right) => left.split("/").length - right.split("/").length)[0];
}

export function detectSourceRoot(topLevelDirectories: readonly string[]): string | undefined {
  return topLevelDirectories.find((name) => SOURCE_ROOT_DIRECTORY_NAMES.has(name.toLowerCase()));
}

export function detectPackageManager(
  root: string,
  manifest: Record<string, unknown> | null,
): string | undefined {
  const declared = manifest?.["packageManager"];
  if (typeof declared === "string" && declared.length > 0) {
    // "bun@1.3.14" → "bun". The version is not what a decision turns on.
    return declared.split("@")[0];
  }

  for (const [file, name] of LOCKFILES) {
    try {
      if (lstatSync(join(root, file)).isFile()) return name;
    } catch {
      continue;
    }
  }

  return undefined;
}

export interface ProjectInspectionRaw {
  readonly projectName?: string;
  readonly packageManager?: string;
  readonly frameworks: readonly string[];
  readonly testFramework?: string;
  readonly designSystemPackage?: string;
  readonly designSystemDirectory?: string;
  readonly sourceRoot?: string;
  readonly relevantFiles: readonly string[];
}

/**
 * The one entry point both callers use: everything this module knows about a
 * directory, already validated to be a safe root to walk.
 */
export function inspectProjectDirectory(root: string, signal: AbortSignal): ProjectInspectionRaw {
  const manifest = readPackageManifest(root);
  const name = manifest?.["name"];
  const dependencies = manifest === null ? [] : dependencyNames(manifest);
  const { relevantFiles, topLevelDirectories, directories } = walkProjectTree(root, signal);

  const packageManager = detectPackageManager(root, manifest);
  const testFramework = detectTestFramework(dependencies);
  const designSystemPackage = detectDesignSystemPackage(dependencies);
  const designSystemDirectory = detectDesignSystemDirectory(directories);
  const sourceRoot = detectSourceRoot(topLevelDirectories);

  return {
    ...(typeof name === "string" && name.length > 0 ? { projectName: name } : {}),
    ...(packageManager !== undefined ? { packageManager } : {}),
    frameworks: detectFrameworks(dependencies),
    ...(testFramework !== undefined ? { testFramework } : {}),
    ...(designSystemPackage !== undefined ? { designSystemPackage } : {}),
    ...(designSystemDirectory !== undefined ? { designSystemDirectory } : {}),
    ...(sourceRoot !== undefined ? { sourceRoot } : {}),
    relevantFiles,
  };
}
