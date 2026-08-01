// packages/tools/src/catalog/project-summary.ts
import { realpathSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";
import { toolManifestSchema } from "@designflow/sdk";
import type { Tool, ToolContext, ToolManifest } from "@designflow/sdk";
import { z } from "zod";
import { inspectProjectDirectory } from "./project-inspection";

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

// ── The tool ────────────────────────────────────────────────────
//
// Traversal, manifest-reading and detection logic live in
// `./project-inspection`, shared with the product-facing `ProjectInspector`
// behind `designflow projects inspect`. This file keeps only what is
// specific to being a `Tool`: the manifest, the schemas, and the one-approved-
// root containment check.

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
    const inspected = inspectProjectDirectory(root, context.signal);

    return projectSummaryOutputSchema.parse({
      ...(inspected.projectName !== undefined ? { projectName: inspected.projectName } : {}),
      ...(inspected.packageManager !== undefined
        ? { packageManager: inspected.packageManager }
        : {}),
      detectedFrameworks: inspected.frameworks,
      relevantFiles: inspected.relevantFiles,
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
