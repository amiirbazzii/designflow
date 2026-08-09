import type { ProjectFact, ProjectIdentity } from "@designflow/sdk";
import type { CliContext } from "./cli-runner";

export type DestinationKind = "page" | "component" | "new-page" | "new-component";

export interface DestinationCandidate {
  readonly label: string;
  readonly kind: DestinationKind;
  readonly path?: string;
  readonly sourcePath?: string;
}

const MAX_EXISTING_DESTINATIONS = 8;

const NEW_DESTINATIONS: readonly DestinationCandidate[] = [
  { label: "New page", kind: "new-page" },
  { label: "New component", kind: "new-component" },
];

/**
 * Inspects the already registered root through the existing product service,
 * then projects persisted facts into the small normal-view destination model.
 * Inspection failures are intentionally non-fatal: generic creation choices
 * remain useful even when a project is sparse or partially unreadable.
 */
export async function findDestinationCandidates(
  context: CliContext,
  project: ProjectIdentity | null,
): Promise<readonly DestinationCandidate[]> {
  if (project === null) return NEW_DESTINATIONS;

  try {
    await context.projects.inspectProject(project.id);
  } catch {
    // The existing project record may still have usable facts from an earlier
    // inspection; read them below and otherwise return only generic choices.
  }

  try {
    const projectContext = await context.projectContext.getContext(project.id);
    return destinationCandidatesFromFacts(projectContext.facts);
  } catch {
    return NEW_DESTINATIONS;
  }
}

export function destinationCandidatesFromFacts(
  facts: readonly ProjectFact[],
): readonly DestinationCandidate[] {
  const fact = facts.find((candidate) => candidate.key === "project.destinations");
  const existing = Array.isArray(fact?.value)
    ? fact.value.flatMap(parseExistingDestination)
    : [];

  const unique = new Map<string, DestinationCandidate>();
  for (const candidate of existing) {
    const key = `${candidate.kind}:${candidate.label}`;
    if (!unique.has(key)) unique.set(key, candidate);
  }

  return [...unique.values()].slice(0, MAX_EXISTING_DESTINATIONS).concat(NEW_DESTINATIONS);
}

function parseExistingDestination(value: unknown): DestinationCandidate[] {
  if (!isRecord(value)) return [];

  const kind = value.kind;
  const label = value.label;
  const sourcePath = value.sourcePath;
  if (
    (kind !== "page" && kind !== "component") ||
    typeof label !== "string" ||
    label.trim().length === 0 ||
    typeof sourcePath !== "string" ||
    sourcePath.trim().length === 0
  ) {
    return [];
  }

  return [
    {
      label: label.trim(),
      kind,
      path: kind === "page" ? label.trim() : sourcePath.trim(),
      sourcePath: sourcePath.trim(),
    },
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
