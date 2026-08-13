// packages/agents/src/ui-builder/builder-report.ts
//
// The human-readable view of a build. A view, never the source of truth:
// every line is read from the result, and it can state nothing the
// deterministic gates did not already establish.
import type { BuildResult } from "./builder-pipeline";
import type { ImplementationMap } from "@designflow/sdk";

export interface BuilderReportSection {
  readonly title: string;
  readonly lines: readonly string[];
}

export function renderBuilderReport(result: BuildResult, map: ImplementationMap): readonly BuilderReportSection[] {
  const sections: BuilderReportSection[] = [];
  const labelFor = (requirementId: string): string =>
    map.requirements.find((requirement) => requirement.id === requirementId)?.label ?? requirementId;

  sections.push({
    title: "Destination",
    lines:
      map.screen === undefined
        ? ["Not decided."]
        : [
            map.screen.destination.path + (map.screen.destination.route !== undefined ? `  (${map.screen.destination.route})` : ""),
            ...(map.screen.compositionRootPath !== undefined ? [`Mounted through: ${map.screen.compositionRootPath}`] : []),
          ],
  });

  for (const action of ["reuse", "extend", "create"] as const) {
    const entries = map.components.filter((component) => component.action === action);
    if (entries.length === 0) continue;
    sections.push({
      title: action === "reuse" ? "Reuse" : action === "extend" ? "Extend" : "Create",
      lines: entries.map(
        (component) =>
          `- ${labelFor(component.requirementId)}` +
          (component.projectTarget !== undefined
            ? ` → ${component.projectTarget.path}`
            : component.plannedPath !== undefined
              ? ` → ${component.plannedPath}`
              : ""),
      ),
    });
  }

  sections.push({
    title: "Files",
    lines:
      result.proposal === undefined
        ? ["No proposal was produced."]
        : result.proposal.files.map((file) => `${file.action === "create" ? "+" : "~"} ${file.path}`),
  });

  const check = (passed: boolean, label: string, detail?: string): string =>
    `${passed ? "✓" : "✗"} ${label}${detail !== undefined ? ` — ${detail}` : ""}`;

  sections.push({
    title: "Validation",
    lines: [
      check(result.violations.length === 0, "Map respected", result.violations[0]?.message),
      check(
        result.coverage !== undefined && result.coverage.missing.length === 0,
        `Coverage${result.coverage !== undefined ? ` (${result.coverage.resolvedCount}/${result.coverage.requirementCount})` : ""}`,
        result.coverage?.missing[0]?.label,
      ),
      check(result.reachability?.reachable === true, "Reachability", result.reachability?.reason),
      check(
        result.proposedState === undefined || result.proposedState.status === "passed",
        "Build",
        result.proposedState?.status === "unavailable" ? "not run" : result.proposedState?.diagnostics[0],
      ),
      ...(result.status !== "valid" ? [`Status: ${result.status}${result.reason !== undefined ? ` — ${result.reason}` : ""}`] : []),
      ...(result.attempts > 1 ? [`Attempts: ${result.attempts}`] : []),
    ],
  });

  return sections;
}
