// packages/agents/src/agents/../ui-builder/map-enforcement.ts
//
// Deterministic enforcement of the Implementation Map against a proposal.
//
// The Builder writes code. It does not get to decide that reuse was actually
// create, that a different component was better, or that the screen belongs
// somewhere else — those were decided by the Mapper, reviewed as a plan, and
// are immutable input here. This file is what makes that true rather than
// merely instructed.
//
// Everything is checked from the proposal and the map alone. No model
// statement carries authority: the Builder saying "all requirements covered"
// is worth exactly nothing, which is why coverage is derived here instead.
import {
  type ComponentMapping,
  type ImplementationMap,
  type ProposedFileChanges,
  type UIBlueprint,
} from "@designflow/sdk";

import { isWriteAllowed } from "./builder-source-selection";

export type MapViolationCode =
  | "ERR_IMPLEMENTATION_MAP_VIOLATION_REUSE_MODIFIED"
  | "ERR_IMPLEMENTATION_MAP_VIOLATION_SUBSTITUTE_COMPONENT"
  | "ERR_IMPLEMENTATION_MAP_VIOLATION_MISSING_EXTENSION"
  | "ERR_IMPLEMENTATION_MAP_VIOLATION_UNAUTHORIZED_FILE"
  | "ERR_IMPLEMENTATION_MAP_VIOLATION_DESTINATION"
  | "ERR_IMPLEMENTATION_MAP_VIOLATION_TOKEN"
  | "ERR_IMPLEMENTATION_MAP_VIOLATION_ASSET"
  | "ERR_IMPLEMENTATION_MAP_VIOLATION_BINDING";

export interface MapViolation {
  readonly code: MapViolationCode;
  readonly message: string;
  readonly path?: string;
  readonly requirementId?: string;
}

const EXECUTABLE = /\.(jsx|tsx|js|ts|mjs)$/i;

function importsFrom(content: string, targetPath: string): boolean {
  // Match by file stem: a project importing "@/components/ui/button" and a
  // target at "src/components/ui/button.tsx" are the same component, and the
  // Builder legitimately uses whichever alias the project's own convention
  // prefers (ProjectContext told it which).
  const stem = targetPath.split("/").at(-1)?.replace(/\.[^.]+$/, "") ?? "";
  if (stem.length === 0) return false;
  const pattern = new RegExp(`from\\s+["'][^"']*${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`, "i");
  return pattern.test(content);
}

/**
 * Checks one proposal against the plan that authorized it.
 *
 * Returns violations rather than throwing: the bounded repair loop turns them
 * into feedback, and a caller that wants a hard stop simply refuses a
 * non-empty result.
 */
export function enforceImplementationMap(
  proposal: ProposedFileChanges,
  map: ImplementationMap,
  blueprint: UIBlueprint,
): readonly MapViolation[] {
  const violations: MapViolation[] = [];
  const proposedPaths = new Set(proposal.files.map((file) => file.path));
  const proposedContent = proposal.files.map((file) => file.content ?? "").join("\n");

  // D. The binding must still describe the plan and project this proposal claims.
  if (proposal.v2Binding !== undefined) {
    if (
      map.binding.projectFingerprint !== undefined &&
      proposal.v2Binding.projectFingerprint !== undefined &&
      proposal.v2Binding.projectFingerprint !== map.binding.projectFingerprint
    ) {
      violations.push({
        code: "ERR_IMPLEMENTATION_MAP_VIOLATION_BINDING",
        message: "The proposal claims a different project state than the Implementation Map was planned against.",
      });
    }
  }

  // A/B/C. Per-component action enforcement.
  for (const component of map.components) {
    const target = component.projectTarget?.path;

    if (component.action === "reuse") {
      if (target !== undefined && proposedPaths.has(target)) {
        violations.push({
          code: "ERR_IMPLEMENTATION_MAP_VIOLATION_REUSE_MODIFIED",
          message: `The map reuses ${target} without changing it, but the proposal modifies it. Reuse means the component's contract stays as it is.`,
          path: target,
          requirementId: component.requirementId,
        });
      }
      // A substitute component created to stand in for a reused one.
      const substitute = substituteFor(component, proposal, map);
      if (substitute !== undefined) {
        violations.push({
          code: "ERR_IMPLEMENTATION_MAP_VIOLATION_SUBSTITUTE_COMPONENT",
          message: `The map reuses ${target ?? "an existing component"} for ${component.blueprintComponentId}, but the proposal creates ${substitute} instead.`,
          path: substitute,
          requirementId: component.requirementId,
        });
      }
      if (target !== undefined && !importsFrom(proposedContent, target)) {
        violations.push({
          code: "ERR_IMPLEMENTATION_MAP_VIOLATION_SUBSTITUTE_COMPONENT",
          message: `Nothing in the proposal imports the reused component ${target}.`,
          path: target,
          requirementId: component.requirementId,
        });
      }
      continue;
    }

    if (component.action === "extend") {
      if (target !== undefined && !proposedPaths.has(target)) {
        violations.push({
          code: "ERR_IMPLEMENTATION_MAP_VIOLATION_MISSING_EXTENSION",
          message: `The map extends ${target} (${component.requiredAdaptations.join("; ") || "bounded adaptation"}), but the proposal never changes it.`,
          path: target,
          requirementId: component.requirementId,
        });
      }
      const substitute = substituteFor(component, proposal, map);
      if (substitute !== undefined) {
        violations.push({
          code: "ERR_IMPLEMENTATION_MAP_VIOLATION_SUBSTITUTE_COMPONENT",
          message: `The map extends ${target ?? "an existing component"}, but the proposal creates ${substitute} instead.`,
          path: substitute,
          requirementId: component.requirementId,
        });
      }
      continue;
    }

    // create: the planned path must actually be created.
    if (component.plannedPath !== undefined && !proposedPaths.has(component.plannedPath)) {
      violations.push({
        code: "ERR_IMPLEMENTATION_MAP_VIOLATION_MISSING_EXTENSION",
        message: `The map creates ${component.plannedPath} for ${component.blueprintComponentId}, but the proposal does not.`,
        path: component.plannedPath,
        requirementId: component.requirementId,
      });
    }
  }

  // Any file the plan never authorized.
  for (const file of proposal.files) {
    if (!isWriteAllowed(file.path, map)) {
      violations.push({
        code: "ERR_IMPLEMENTATION_MAP_VIOLATION_UNAUTHORIZED_FILE",
        message: `The proposal changes ${file.path}, which the Implementation Map does not authorize.`,
        path: file.path,
      });
    }
  }

  // D. The mapped destination must actually be realized.
  const destination = map.screen?.destination;
  if (destination !== undefined) {
    const realized =
      proposedPaths.has(destination.path) ||
      [...proposedPaths].some((path) => path.startsWith(`${destination.path}/`));
    if (!realized) {
      violations.push({
        code: "ERR_IMPLEMENTATION_MAP_VIOLATION_DESTINATION",
        message: `The map places the screen at ${destination.path}, but the proposal never writes it.`,
        path: destination.path,
      });
    }
  }

  // F. A mapped token must be referenced; a raw design value must survive.
  for (const style of map.styles) {
    if (style.strategy === "reuse_token" || style.strategy === "extend_token") {
      if (style.projectTokenReference !== undefined && !proposedContent.includes(tokenNeedle(style.projectTokenReference))) {
        violations.push({
          code: "ERR_IMPLEMENTATION_MAP_VIOLATION_TOKEN",
          message: `The map maps ${style.designValue} onto ${style.projectTokenReference}, but the proposal never references it.`,
        });
      }
    }
    if (style.strategy === "raw_design_value" && !proposedContent.toLowerCase().includes(style.designValue.toLowerCase())) {
      violations.push({
        code: "ERR_IMPLEMENTATION_MAP_VIOLATION_TOKEN",
        message: `The map keeps ${style.designValue} as a raw design value because no project token matches, but the proposal does not carry it.`,
      });
    }
  }

  // G. Only mapped assets, and only through their mapped strategy.
  for (const asset of map.assets) {
    if (asset.strategy === "reuse_project_asset" || asset.strategy === "reuse_project_icon") {
      if (asset.projectAssetPath !== undefined && !proposedContent.includes(tokenNeedle(asset.projectAssetPath))) {
        violations.push({
          code: "ERR_IMPLEMENTATION_MAP_VIOLATION_ASSET",
          message: `The map reuses the project asset ${asset.projectAssetPath}, but the proposal never references it.`,
        });
      }
    }
  }

  void blueprint;
  return violations;
}

/** `var(--surface-muted)` → `--surface-muted`; a path → its stem. */
function tokenNeedle(reference: string): string {
  const variable = /var\(\s*(--[A-Za-z0-9_-]+)/.exec(reference);
  if (variable !== null) return variable[1]!;
  return reference.split("/").at(-1)?.replace(/\.[^.]+$/, "") ?? reference;
}

/**
 * A created file that stands in for a component the map said to reuse/extend.
 *
 * Name-based on purpose: `NewButton.tsx` or `CustomTextField.tsx` beside a
 * mapped `Button` is exactly the silent re-plan this check exists to catch.
 */
function substituteFor(
  component: ComponentMapping,
  proposal: ProposedFileChanges,
  map: ImplementationMap,
): string | undefined {
  const label = map.requirements.find((requirement) => requirement.id === component.requirementId)?.label;
  const needle = (label ?? component.blueprintComponentId.replace(/^component:/, "")).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (needle.length < 3) return undefined;

  for (const file of proposal.files) {
    if (file.action !== "create" || !EXECUTABLE.test(file.path)) continue;
    if (file.path === component.projectTarget?.path) continue;
    const stem = (file.path.split("/").at(-1) ?? "").replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (stem.includes(needle)) return file.path;
  }
  return undefined;
}
