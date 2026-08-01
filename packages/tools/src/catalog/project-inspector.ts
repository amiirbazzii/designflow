// packages/tools/src/catalog/project-inspector.ts
import { realpathSync } from "node:fs";
import { inspectProjectDirectory } from "./project-inspection";

/**
 * The product-facing port behind `designflow projects inspect`.
 *
 * Unlike `project-summary` (a `Tool`, one root fixed at construction and
 * granted to an agent), this is called with a fresh root every time — the
 * approval already happened one layer up, when a person registered a project
 * with this exact `rootPath`. What stays identical to the tool is everything
 * that makes inspection safe: `realpath` before ever walking the tree (so
 * `../` and a symlinked root both resolve to where they actually point before
 * anything is read), names-only traversal with `package.json` the one
 * exception, bounded depth/entries, no mutation, no shell, no network.
 *
 * Produces *candidate* facts — a caller (`ProjectService`) decides how they
 * become `ProjectFact` records, including stamping timestamps. This module
 * never touches `ProjectContextStore` directly.
 */

export interface ProjectFactCandidate {
  readonly key: string;
  readonly value: unknown;
  readonly source: "inspection" | "inferred";
  readonly confidence?: number;
}

export interface ProjectInspectionResult {
  readonly facts: readonly ProjectFactCandidate[];
}

export interface ProjectInspector {
  inspect(root: string, signal?: AbortSignal): Promise<ProjectInspectionResult>;
}

class FileSystemProjectInspector implements ProjectInspector {
  public async inspect(root: string, signal?: AbortSignal): Promise<ProjectInspectionResult> {
    let approvedRoot: string;
    try {
      approvedRoot = realpathSync(root);
    } catch {
      throw new Error("That project directory could not be read.");
    }

    const inspected = inspectProjectDirectory(approvedRoot, signal ?? new AbortController().signal);
    const facts: ProjectFactCandidate[] = [];

    if (inspected.projectName !== undefined) {
      facts.push({ key: "project.name", value: inspected.projectName, source: "inspection" });
    }

    if (inspected.packageManager !== undefined) {
      facts.push({
        key: "project.packageManager",
        value: inspected.packageManager,
        source: "inspection",
      });
    }

    if (inspected.frameworks.length > 0) {
      facts.push({ key: "project.frameworks", value: inspected.frameworks, source: "inspection" });
    }

    if (inspected.sourceRoot !== undefined) {
      facts.push({ key: "project.sourceRoot", value: inspected.sourceRoot, source: "inspection" });
    }

    if (inspected.testFramework !== undefined) {
      facts.push({
        key: "project.testFramework",
        value: inspected.testFramework,
        source: "inspection",
      });
    }

    if (inspected.designSystemPackage !== undefined) {
      facts.push({
        key: "designSystem.package",
        value: inspected.designSystemPackage,
        source: "inspection",
      });
    }

    if (inspected.designSystemDirectory !== undefined) {
      // A directory *named* like a design system is a guess, not evidence the
      // way a declared dependency is — hence `inferred`, with a confidence
      // below certainty.
      facts.push({
        key: "designSystem.path",
        value: inspected.designSystemDirectory,
        source: "inferred",
        confidence: 0.5,
      });
    }

    return { facts };
  }
}

export function createProjectInspector(): ProjectInspector {
  return new FileSystemProjectInspector();
}
