// packages/agents/src/project-mapper/mapping-report.ts
//
// The human-readable view of an Implementation Map.
//
// A view, never the source of truth: every line is read from the map, and
// nothing here can state something the map does not contain. It exists so a
// person can answer "what is DesignFlow about to do to my project, and why?"
// without reading JSON.
import type { ImplementationMap } from "@designflow/sdk";

export interface MappingReportSection {
  readonly title: string;
  readonly lines: readonly string[];
}

const ACTION_LABEL: Record<string, string> = {
  reuse: "Reuse existing",
  extend: "Extend existing",
  create: "Create",
};

const DESTINATION_LABEL: Record<string, string> = {
  use_existing: "Use existing",
  create_route: "Create route",
  create_page: "Create page",
  integrate_existing_root: "Integrate into existing root",
};

export function renderMappingReport(map: ImplementationMap): readonly MappingReportSection[] {
  const sections: MappingReportSection[] = [];
  const requirementById = new Map(map.requirements.map((requirement) => [requirement.id, requirement]));

  sections.push({
    title: "Destination",
    lines:
      map.screen === undefined
        ? ["Not decided — the screen would not be reachable."]
        : [
            `${DESTINATION_LABEL[map.screen.destination.action] ?? map.screen.destination.action}: ${map.screen.destination.path}` +
              (map.screen.destination.route !== undefined ? `  (${map.screen.destination.route})` : ""),
            ...(map.screen.compositionRootPath !== undefined
              ? [`Mounted through: ${map.screen.compositionRootPath}`]
              : []),
            `Reason: ${map.screen.reason}`,
          ],
  });

  sections.push({
    title: "Components",
    lines: map.components.flatMap((component) => {
      const requirement = requirementById.get(component.requirementId);
      const target =
        component.projectTarget !== undefined
          ? `${component.projectTarget.name} (${component.projectTarget.path})`
          : (component.plannedPath ?? "new component");
      const instances = map.requirements.filter(
        (entry) => entry.kind === "component-instance" && entry.parentRequirementId === component.requirementId,
      );
      const unresolvedInstances = map.coverage.entries.filter(
        (entry) => entry.status !== "mapped" && instances.some((instance) => instance.id === entry.requirementId),
      );
      return [
        `${requirement?.label ?? component.blueprintComponentId} → ${ACTION_LABEL[component.action] ?? component.action} ${target}`,
        `  Reason: ${component.reason}  ·  confidence ${component.confidence}`,
        ...(component.requiredAdaptations.length > 0
          ? [`  Adaptations: ${component.requiredAdaptations.join("; ")}`]
          : []),
        ...(instances.length > 0
          ? [
              `  Instances: ${instances.length - unresolvedInstances.length}/${instances.length} satisfied` +
                (unresolvedInstances.length > 0
                  ? ` — unresolved: ${unresolvedInstances.map((entry) => entry.label).join(", ")}`
                  : ""),
            ]
          : []),
      ];
    }),
  });

  if (map.composition !== undefined) {
    sections.push({
      title: "Composition",
      lines: map.composition.nodes.map((node) => {
        const mapping = map.components.find((component) => component.requirementId === node.componentRequirementId);
        return `${node.label}${mapping !== undefined ? ` → ${ACTION_LABEL[mapping.action] ?? mapping.action}` : ""}`;
      }),
    });
  }

  sections.push({
    title: "Styling",
    lines: map.styles.map(
      (style) =>
        `${style.designValue} → ${style.strategy}` +
        (style.projectTokenReference !== undefined ? ` ${style.projectTokenReference}` : "") +
        (style.equivalence !== undefined ? ` (${style.equivalence})` : ""),
    ),
  });

  sections.push({
    title: "Assets",
    lines: map.assets.map((asset) => {
      const requirement = requirementById.get(asset.requirementId);
      return `${requirement?.label ?? asset.blueprintAssetId} → ${asset.strategy}${asset.projectAssetPath !== undefined ? ` ${asset.projectAssetPath}` : ""}`;
    }),
  });

  const byStatus = new Map<string, number>();
  for (const entry of map.coverage.entries) byStatus.set(entry.status, (byStatus.get(entry.status) ?? 0) + 1);

  sections.push({
    title: "Coverage",
    lines: [
      `${map.coverage.status} — ${byStatus.get("mapped") ?? 0} of ${map.coverage.retained} requirements mapped`,
      ...(map.coverage.truncated
        ? [
            `Truncated: ${map.coverage.retained} of ${map.coverage.totalRequired} requirements were retained (${map.coverage.bound?.selectionRule ?? "bounded"}).`,
          ]
        : []),
      ...map.coverage.entries
        .filter((entry) => entry.status !== "mapped")
        .slice(0, 20)
        .map((entry) => `  ${entry.status}: ${entry.label}${entry.note !== undefined ? ` — ${entry.note}` : ""}`),
      ...(map.status !== "complete" ? [`Mapping status: ${map.status}`] : []),
      ...map.mapper.failures.map((failure) => `  partition ${failure.partitionId} failed: ${failure.code}`),
    ],
  });

  if (map.uncertainties.length > 0) {
    sections.push({
      title: "Uncertainties",
      lines: map.uncertainties.map((uncertainty) => `${uncertainty.code}: ${uncertainty.description}`),
    });
  }

  return sections;
}
