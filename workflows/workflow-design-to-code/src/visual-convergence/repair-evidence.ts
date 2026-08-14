// workflows/workflow-design-to-code/src/visual-convergence/repair-evidence.ts
//
// What a repair attempt is allowed to be told (V2-6).
//
// The Builder does not read the VisualDeltaReport. It receives a bounded,
// host-compiled digest: only actionable, evidence-backed findings, each mapped
// through the immutable ImplementationMap to the file the plan already
// authorized for that requirement. A finding that cannot be mapped safely to
// an allowed implementation target is carried as unresolved — no target, no
// instruction — and ambiguous correspondence never becomes a precise repair
// instruction, because amplifying uncertain evidence is exactly how a loop
// makes a screen worse with confidence.
//
// Measured facts and Critic interpretation stay visibly separate: `findings`
// are browser measurements, `advisory` is model prose about them.
import type {
  ElementCorrespondence,
  ImplementationMap,
  UIBlueprint,
  VisualDeltaReport,
  VisualFindingV1,
} from "@designflow/sdk";

import { actionableFindings } from "./convergence-policy";

const MAX_REPAIR_FINDINGS = 12;
const MAX_ADVISORY = 8;
const MAX_TEXT = 300;

export interface RepairFindingEvidence {
  readonly label: string;
  readonly category: string;
  readonly severity: string;
  readonly property?: string;
  readonly expected?: string;
  readonly actual?: string;
  readonly delta?: number;
  /** Files the plan authorizes for this requirement. Never widened. */
  readonly targetPaths: readonly string[];
}

export interface VisualRepairEvidence {
  readonly planIsImmutable: true;
  /** Measured facts, one per actionable finding the map can place. */
  readonly findings: readonly RepairFindingEvidence[];
  /** The union of every finding's targets — the full repair scope. */
  readonly allowedTargets: readonly string[];
  /** Critic interpretation. Advisory context, never permission to re-plan. */
  readonly advisory: readonly { readonly findingId: string; readonly guidance: string }[];
  /** Findings the host could not safely scope, stated without instructions. */
  readonly unresolved: readonly { readonly blueprintRef: string; readonly reason: string }[];
}

function blueprintRefOf(finding: VisualFindingV1): string | undefined {
  const first = finding.evidenceReferences[0];
  return first === undefined || first.startsWith("viewport:") || first.startsWith("selector:") ? undefined : first;
}

function propertyOf(finding: VisualFindingV1): string | undefined {
  // `finding:expectation:<blueprint-element>:<property>`
  const parts = finding.findingId.split(":");
  return parts.length >= 4 && parts[1] === "expectation" ? parts.at(-1) : undefined;
}

/** blueprintRef → the plan's authorized implementation paths for it. */
function buildTargetIndex(map: ImplementationMap, blueprint: UIBlueprint): {
  readonly targetsFor: (blueprintRef: string | undefined) => readonly string[];
  readonly screenPaths: readonly string[];
} {
  const byRef = new Map<string, string[]>();
  const requirementById = new Map(map.requirements.map((requirement) => [requirement.id, requirement]));

  for (const component of map.components) {
    const paths = [component.plannedPath, component.projectTarget?.path].filter(
      (path): path is string => path !== undefined,
    );
    if (paths.length === 0) continue;
    const refs = [component.blueprintComponentId, requirementById.get(component.requirementId)?.blueprintRef].filter(
      (ref): ref is string => ref !== undefined,
    );
    for (const ref of refs) byRef.set(ref, [...(byRef.get(ref) ?? []), ...paths]);
  }

  const screenPaths = [map.screen?.destination.path, map.screen?.compositionRootPath].filter(
    (path): path is string => path !== undefined,
  );
  const screenRef = map.screen === undefined ? undefined : requirementById.get(map.screen.requirementId)?.blueprintRef;
  if (screenRef !== undefined && screenPaths.length > 0) byRef.set(screenRef, [...screenPaths]);

  const screenElementIds = new Set(blueprint.elements.map((element) => element.id));

  return {
    screenPaths,
    targetsFor: (blueprintRef) => {
      if (blueprintRef === undefined) return [];
      const direct = byRef.get(blueprintRef);
      if (direct !== undefined) return [...new Set(direct)];
      // An element the design drew inline lives in the screen's own
      // composition file — still a path the plan authorized, never a new one.
      if (screenElementIds.has(blueprintRef) && screenPaths.length > 0) return screenPaths;
      return [];
    },
  };
}

/** Compiles the bounded repair request. Deterministic for identical inputs. */
export function compileVisualRepairEvidence(options: {
  readonly report: VisualDeltaReport;
  readonly map: ImplementationMap;
  readonly blueprint: UIBlueprint;
  readonly correspondences?: readonly ElementCorrespondence[];
}): VisualRepairEvidence {
  const index = buildTargetIndex(options.map, options.blueprint);
  const findings: RepairFindingEvidence[] = [];
  const unresolved: { blueprintRef: string; reason: string }[] = [];

  const severityRank = { critical: 0, major: 1, minor: 2, info: 3 } as const;
  const actionable = [...actionableFindings(options.report)].sort(
    (left, right) => severityRank[left.severity] - severityRank[right.severity],
  );

  for (const finding of actionable) {
    const blueprintRef = blueprintRefOf(finding);
    const targetPaths =
      finding.findingId.startsWith("finding:pixel:") && index.screenPaths.length > 0
        ? index.screenPaths
        : index.targetsFor(blueprintRef);

    if (targetPaths.length === 0) {
      unresolved.push({
        blueprintRef: blueprintRef ?? finding.findingId,
        reason: "No mapped implementation target could be derived for this finding, so it is not repairable in scope.",
      });
      continue;
    }

    const property = propertyOf(finding);
    findings.push({
      label: (finding.affectedComponent ?? finding.findingId).slice(0, MAX_TEXT),
      category: finding.category,
      severity: finding.severity,
      ...(property !== undefined ? { property } : {}),
      ...(finding.expectedValue !== undefined ? { expected: finding.expectedValue.slice(0, MAX_TEXT) } : {}),
      ...(finding.actualValue !== undefined ? { actual: finding.actualValue.slice(0, MAX_TEXT) } : {}),
      ...(finding.measurableDelta !== undefined ? { delta: finding.measurableDelta } : {}),
      targetPaths,
    });
  }

  // Ambiguity is reported as unresolved, never converted into an instruction.
  for (const correspondence of options.correspondences ?? [])
    if (correspondence.state === "ambiguous")
      unresolved.push({
        blueprintRef: correspondence.blueprintRef,
        reason: "correspondence unresolved: several rendered elements remained plausible, so no measurement is trusted here.",
      });

  const actionableIds = new Set(actionable.map((finding) => finding.findingId));
  const advisory = options.report.annotations
    .filter((annotation) => annotation.repairGuidance !== undefined && actionableIds.has(annotation.findingId))
    .slice(0, MAX_ADVISORY)
    .map((annotation) => ({ findingId: annotation.findingId, guidance: annotation.repairGuidance!.slice(0, MAX_TEXT) }));

  const bounded = findings.slice(0, MAX_REPAIR_FINDINGS);

  return {
    planIsImmutable: true,
    findings: bounded,
    allowedTargets: [...new Set(bounded.flatMap((finding) => finding.targetPaths))].sort(),
    advisory,
    unresolved: unresolved.slice(0, MAX_REPAIR_FINDINGS),
  };
}
