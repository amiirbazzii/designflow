// packages/tools/src/catalog/project-summary.ts
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { toolManifestSchema } from "@designflow/sdk";
import type { Tool, ToolContext, ToolManifest } from "@designflow/sdk";
import { z } from "zod";

/**
 * Reports what kind of project a directory holds.
 *
 * The only tool in this stage that touches the outside world, and every
 * boundary it has is here rather than in the runtime — because "read-only and
 * bounded" is a property of *this* tool, not something a generic runtime could
 * enforce on an arbitrary one.
 *
 * The confinement is structural, not advisory:
 *
 *   **one approved root**, fixed at construction by whoever installed the
 *   tool. There is no way to widen it at call time, so the grant is visible in
 *   the composition root instead of implicit in a context.
 *
 *   **`realpath` before the containment check**, so `../` and a symlinked
 *   directory both resolve to where they actually point before being compared
 *   against the root — checking the literal string would let either escape.
 *
 *   **symlinks skipped entirely** during traversal. Following them means
 *   re-deriving containment per entry and getting it right every time; not
 *   following them means the question does not arise.
 *
 *   **names only, with one exception.** `package.json` is read because a
 *   project's framework cannot be known without it. Nothing else is opened, so
 *   a file's *contents* cannot leak even if its name is returned.
 *
 *   **anything that looks sensitive is skipped by name**, dotfiles included —
 *   that covers `.env` and `.git` in one rule — because even a filename can be
 *   something a person did not intend to hand to a decision-maker.
 *
 *   **hard caps on depth and entries**, so a symlink farm or a monorepo with
 *   fifty thousand files cannot turn a decision into a directory walk.
 *
 * Deterministic for a given tree: entries are sorted, so the same directory
 * produces the same summary every time.
 */

export const projectSummaryInputSchema = z
  .object({
    /** Relative to the approved root. Absolute paths must be inside it. */
    projectPath: z.string().optional(),
  })
  .strict();

export type ProjectSummaryInput = z.infer<typeof projectSummaryInputSchema>;

export const projectSummaryOutputSchema = z
  .object({
    projectName: z.string().optional(),
    packageManager: z.string().optional(),
    detectedFrameworks: z.array(z.string()).default([]),
    relevantFiles: z.array(z.string()).default([]),
  })
  .strict();

export type ProjectSummaryOutput = z.infer<typeof projectSummaryOutputSchema>;

export const projectSummaryManifest: ToolManifest = toolManifestSchema.parse({
  id: "project-summary",
  name: "Project summary",
  description: "Reports the name, package manager and frameworks of a project directory",
  version: "0.1.0",
  inputSchema: {
    description: "Which project to summarise",
    fields: [
      {
        name: "projectPath",
        type: "string",
        required: false,
        description: "Relative to the approved root. Defaults to the root itself.",
      },
    ],
  },
  outputSchema: {
    description: "Project metadata, derived from file names and package.json only",
    fields: [
      { name: "projectName", type: "string", required: false },
      { name: "packageManager", type: "string", required: false },
      { name: "detectedFrameworks", type: "string[]", required: true },
      { name: "relevantFiles", type: "string[]", required: true },
    ],
  },
  timeoutMs: 3_000,
  metadata: { author: "DesignFlow", deterministic: true, readOnly: true },
});

// ── Bounds ──────────────────────────────────────────────────────

const MAX_DEPTH = 3;
const MAX_ENTRIES = 400;
const MAX_REPORTED_FILES = 50;
/** package.json is the only file opened; a huge one is not a package.json. */
const MAX_MANIFEST_BYTES = 1_000_000;

/** Directories that are never interesting and are often enormous. */
const SKIPPED_DIRECTORIES = new Set([
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
const SENSITIVE = /secret|credential|password|token|private[-_.]?key|\.pem$|\.key$|\.p12$|\.pfx$/i;

/** Files worth reporting, because they say what kind of project this is. */
const INTERESTING = /^(package\.json|tsconfig\.json|README\.md|.*\.(tsx?|jsx?|vue|svelte|css|scss|fig|json)|Dockerfile|Makefile)$/;

const FRAMEWORK_MARKERS: readonly (readonly [string, string])[] = [
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

const LOCKFILES: readonly (readonly [string, string])[] = [
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
];

// ── Traversal ───────────────────────────────────────────────────

function skipped(name: string): boolean {
  return (
    name.startsWith(".") || SKIPPED_DIRECTORIES.has(name) || SENSITIVE.test(name)
  );
}

/**
 * File names under `root`, bounded and sorted.
 *
 * Sorted at each level so the result is stable across filesystems — readdir
 * order is not guaranteed, and an unstable summary would make the agent that
 * reads it non-deterministic for no reason.
 */
function walk(root: string, signal: AbortSignal): readonly string[] {
  const found: string[] = [];
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
      if (skipped(name)) continue;

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
        descend(full, depth + 1);
        continue;
      }

      if (stats.isFile() && INTERESTING.test(name) && found.length < MAX_REPORTED_FILES) {
        found.push(relative(root, full).split(sep).join("/"));
      }
    }
  };

  descend(root, 0);

  return found;
}

function readManifest(root: string): Record<string, unknown> | null {
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

function dependencyNames(manifest: Record<string, unknown>): readonly string[] {
  const names: string[] = [];

  for (const key of ["dependencies", "devDependencies", "peerDependencies"]) {
    const group = manifest[key];
    if (typeof group === "object" && group !== null && !Array.isArray(group)) {
      names.push(...Object.keys(group));
    }
  }

  return names;
}

function detectPackageManager(
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

// ── The tool ────────────────────────────────────────────────────

export interface ProjectSummaryToolOptions {
  /**
   * The only directory this tool may ever read.
   *
   * Required rather than defaulted to `process.cwd()`. A default would make
   * the grant invisible — whoever installs the tool has to say what it may
   * see, and that line is then reviewable in the composition root.
   */
  readonly root: string;
}

class ProjectSummaryTool implements Tool<ProjectSummaryInput, ProjectSummaryOutput> {
  public readonly manifest = projectSummaryManifest;
  public readonly inputSchema = projectSummaryInputSchema;
  public readonly outputSchema = projectSummaryOutputSchema;

  private readonly root: string;

  public constructor(options: ProjectSummaryToolOptions) {
    this.root = options.root;
  }

  /**
   * `async` rather than returning a constructed promise.
   *
   * `resolveWithin` throws, and a synchronous throw from something typed
   * `Promise<T>` escapes before a caller can attach a handler — the tool
   * runtime happens to evaluate it inside a `try`, but a contract that only
   * holds because of where the caller put its braces is not a contract.
   */
  public async execute(
    input: ProjectSummaryInput,
    context: ToolContext,
  ): Promise<ProjectSummaryOutput> {
    const root = this.resolveWithin(input.projectPath);
    const manifest = readManifest(root);

    const name = manifest?.["name"];
    const dependencies = manifest === null ? [] : dependencyNames(manifest);

    const detectedFrameworks = FRAMEWORK_MARKERS.filter(([dependency]) =>
      dependencies.includes(dependency),
    ).map(([, framework]) => framework);

    const packageManager = detectPackageManager(root, manifest);

    return projectSummaryOutputSchema.parse({
      ...(typeof name === "string" && name.length > 0 ? { projectName: name } : {}),
      ...(packageManager !== undefined ? { packageManager } : {}),
      detectedFrameworks,
      relevantFiles: walk(root, context.signal),
    });
  }

  /**
   * The requested path, proven to be inside the approved root.
   *
   * `realpath` first, on both sides, so `../` and symlinks are resolved before
   * the comparison — comparing the literal strings would let either escape.
   * The separator suffix matters too: without it, a root of `/srv/app` would
   * happily accept `/srv/application`.
   *
   * Errors never echo the attempted path. A tool failure message is surfaced
   * and observed, and a path a caller was not permitted to reach is not
   * something to repeat back to them.
   */
  private resolveWithin(projectPath: string | undefined): string {
    let approvedRoot: string;
    try {
      approvedRoot = realpathSync(this.root);
    } catch {
      throw new Error("The approved project root could not be read.");
    }

    if (projectPath === undefined || projectPath.length === 0) return approvedRoot;

    const candidate = isAbsolute(projectPath)
      ? projectPath
      : resolve(approvedRoot, projectPath);

    let resolved: string;
    try {
      resolved = realpathSync(candidate);
    } catch {
      throw new Error("That project directory could not be read.");
    }

    if (resolved !== approvedRoot && !resolved.startsWith(`${approvedRoot}${sep}`)) {
      throw new Error("That path is outside the approved project directory.");
    }

    return resolved;
  }
}

export function createProjectSummaryTool(
  options: ProjectSummaryToolOptions,
): Tool<ProjectSummaryInput, ProjectSummaryOutput> {
  return new ProjectSummaryTool(options);
}
