// packages/agents/src/project-mapper/candidate-builder.ts
//
// Deterministic candidate discovery.
//
// The mapper is never asked to compare every Blueprint component against
// every project component — that is a quadratic prompt and a model doing
// bookkeeping. The host derives a small, ordered candidate set per
// requirement from ProjectContext facts, and the model's job narrows to the
// one thing it is actually good at: judging compatibility.
//
// Candidates are host-minted ids. A patch selects one; it cannot name a path,
// so a component the project does not have cannot be referenced into
// existence.
import type {
  CanonicalProjectContext,
  MappingBound,
  MappingCandidate,
  ProjectComponent,
  UIBlueprint,
} from "@designflow/sdk";

/** Candidates offered per requirement. Small on purpose. */
export const MAX_CANDIDATES_PER_REQUIREMENT = 5;

export interface CandidateSet {
  readonly requirementId: string;
  readonly candidates: readonly MappingCandidate[];
  readonly bound?: MappingBound;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Deterministic 0–1 similarity. No fuzzy libraries, no model. */
function score(blueprintName: string, component: ProjectComponent): { score: number; reason: string } {
  const design = normalize(blueprintName);
  const project = normalize(component.name);
  if (design.length === 0 || project.length === 0) return { score: 0, reason: "no comparable name" };

  if (design === project) {
    return {
      score: component.designSystemMember ? 1 : 0.9,
      reason: component.designSystemMember
        ? "exact name match on a design-system component"
        : "exact name match on a project component",
    };
  }
  if (project.includes(design) || design.includes(project)) {
    return {
      score: component.designSystemMember ? 0.7 : 0.6,
      reason: "one name contains the other",
    };
  }

  // A shared meaningful suffix/prefix ("TextField" vs "InputField") is weak
  // evidence worth offering, never worth asserting.
  const shared = ["field", "input", "button", "card", "nav", "menu", "list", "item", "select", "tab"].find(
    (token) => design.includes(token) && project.includes(token),
  );
  if (shared !== undefined) return { score: 0.4, reason: `both names contain "${shared}"` };

  return { score: 0, reason: "no name evidence" };
}

/**
 * Builds the candidate set for one Blueprint component.
 *
 * Ordering is total and deterministic: score, then design-system membership,
 * then path — so the same project always offers the same candidates in the
 * same order, and a bound retains a predictable prefix.
 */
export function buildComponentCandidates(
  requirementId: string,
  blueprintComponentName: string,
  context: CanonicalProjectContext,
): CandidateSet {
  const scored = context.components
    .map((component) => ({ component, ...score(blueprintComponentName, component) }))
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        Number(right.component.designSystemMember) - Number(left.component.designSystemMember) ||
        left.component.path.localeCompare(right.component.path),
    );

  const candidates: MappingCandidate[] = scored.slice(0, MAX_CANDIDATES_PER_REQUIREMENT).map((entry, index) => ({
    id: `${requirementId}#candidate-${index + 1}`,
    name: entry.component.name,
    path: entry.component.path,
    ...(entry.component.exportedNames[0] !== undefined ? { exportName: entry.component.exportedNames[0] } : {}),
    designSystemMember: entry.component.designSystemMember,
    matchReason: entry.reason,
    matchScore: entry.score,
    factConfidence: entry.component.provenance.confidence,
  }));

  if (scored.length <= MAX_CANDIDATES_PER_REQUIREMENT) return { requirementId, candidates };

  return {
    requirementId,
    candidates,
    bound: {
      collection: `candidates:${requirementId}`,
      discoveredCount: scored.length,
      retainedCount: candidates.length,
      limit: MAX_CANDIDATES_PER_REQUIREMENT,
      truncated: true,
      selectionRule: "highest name-match score, design-system members first, then path order",
    },
  };
}

/**
 * Directories a `create` may plan into.
 *
 * Design-system directories first when the Blueprint component looks like a
 * shared primitive, generic component directories otherwise; a project with
 * neither gets its source root. Never an arbitrary path.
 */
export function plannedDirectoriesFor(context: CanonicalProjectContext): { id: string; path: string }[] {
  const directories = [
    ...context.designSystem.directories.map((entry) => entry.value),
    ...context.structure.componentDirectories,
    ...context.designSystem.genericComponentDirectories,
    ...context.structure.sourceRoots,
  ];
  return [...new Set(directories)]
    .slice(0, 16)
    .map((path, index) => ({ id: `planned-directory-${index + 1}`, path }));
}

/** Every token a style decision may reference, host-minted. */
export function projectTokensFor(context: CanonicalProjectContext): {
  id: string;
  reference: string;
  value: string;
  category?: string;
}[] {
  return context.designSystem.tokens.slice(0, 200).map((token, index) => ({
    id: `project-token-${index + 1}`,
    reference: token.reference,
    value: token.value,
    ...(token.category !== undefined ? { category: token.category } : {}),
  }));
}

/** Project files that could serve a Blueprint asset. */
export function projectAssetsFor(context: CanonicalProjectContext): { id: string; path: string }[] {
  const assetLike = context.components
    .filter((component) => /icon|logo|asset|image/i.test(component.name) || /icon|asset/i.test(component.path))
    .map((component) => component.path);
  return [...new Set(assetLike)].slice(0, 64).map((path, index) => ({ id: `project-asset-${index + 1}`, path }));
}

/** Blueprint components that need a mapping decision, in Blueprint order. */
export function mappableBlueprintComponents(blueprint: UIBlueprint): readonly UIBlueprint["components"][number][] {
  return blueprint.components;
}
