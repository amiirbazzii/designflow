// packages/agents/src/ui-builder/builder-coverage.ts
//
// Host-derived coverage and reachability for a Builder proposal.
//
// The legacy path asked the model to declare which design targets it had
// covered. A model that failed to implement something is exactly the model
// least able to notice, so V2 derives coverage from the Implementation Map's
// own requirements and the proposal's actual contents.
//
// Reachability gets its own check because of a specific field failure: a run
// produced correct components and a page nobody could open. "Did you mount
// it?" is not a question to ask a model — it is a path from the mapped
// destination through the composition root into the proposed files.
import type { ImplementationMap, ProposedFileChanges, UIBlueprint } from "@designflow/sdk";

export interface BuilderCoverageEntry {
  readonly requirementId: string;
  readonly kind: string;
  readonly label: string;
  readonly status: "satisfied" | "missing";
  readonly note?: string;
}

export interface BuilderCoverageResult {
  readonly entries: readonly BuilderCoverageEntry[];
  readonly requirementCount: number;
  readonly resolvedCount: number;
  readonly missing: readonly BuilderCoverageEntry[];
}

export interface ReachabilityResult {
  readonly reachable: boolean;
  readonly destinationPath?: string;
  readonly compositionRootPath?: string;
  readonly reason?: string;
}

function proposalText(proposal: ProposedFileChanges): string {
  return proposal.files.map((file) => file.content ?? "").join("\n");
}

function stemOf(path: string): string {
  return (path.split("/").at(-1) ?? path).replace(/\.[^.]+$/, "");
}

/**
 * Every map requirement, checked against what the proposal actually contains.
 *
 * A component definition counts as satisfied when its decided target is
 * present (created, modified, or imported for a reuse); an *instance* counts
 * when its evidenced content appears — that is what stops one reused
 * component from silently standing in for six different uses.
 */
export function deriveBuilderCoverage(
  proposal: ProposedFileChanges,
  map: ImplementationMap,
  blueprint: UIBlueprint,
): BuilderCoverageResult {
  const text = proposalText(proposal);
  const paths = new Set(proposal.files.map((file) => file.path));
  const entries: BuilderCoverageEntry[] = [];

  const componentByRequirement = new Map(map.components.map((component) => [component.requirementId, component]));
  const instanceContentByElement = new Map<string, string[]>();
  for (const component of blueprint.components) {
    for (const instance of component.instances) {
      instanceContentByElement.set(
        instance.elementId,
        instance.contents.map((slot) => slot.text).filter((value): value is string => value !== undefined),
      );
    }
  }

  for (const requirement of map.requirements) {
    if (requirement.kind === "component-definition") {
      const decision = componentByRequirement.get(requirement.id);
      if (decision === undefined) {
        entries.push({ requirementId: requirement.id, kind: requirement.kind, label: requirement.label, status: "missing", note: "no mapping decision" });
        continue;
      }
      const target = decision.projectTarget?.path ?? decision.plannedPath;
      const satisfied =
        decision.action === "reuse"
          ? target !== undefined && text.includes(stemOf(target))
          : target !== undefined && paths.has(target);
      entries.push({
        requirementId: requirement.id,
        kind: requirement.kind,
        label: requirement.label,
        status: satisfied ? "satisfied" : "missing",
        ...(satisfied ? {} : { note: `${decision.action} target ${target ?? "(none)"} is not realized by the proposal` }),
      });
      continue;
    }

    if (requirement.kind === "component-instance") {
      const contents = instanceContentByElement.get(requirement.blueprintRef) ?? [];
      // An instance with no evidenced copy is satisfied by its definition;
      // one with copy must have that copy somewhere in the proposal.
      const satisfied = contents.length === 0 || contents.every((content) => text.includes(content));
      entries.push({
        requirementId: requirement.id,
        kind: requirement.kind,
        label: requirement.label,
        status: satisfied ? "satisfied" : "missing",
        ...(satisfied ? {} : { note: `the proposal does not carry this instance's content (${contents.slice(0, 2).join(", ")})` }),
      });
      continue;
    }

    if (requirement.kind === "screen-reachability") {
      const reachability = checkReachability(proposal, map);
      entries.push({
        requirementId: requirement.id,
        kind: requirement.kind,
        label: requirement.label,
        status: reachability.reachable ? "satisfied" : "missing",
        ...(reachability.reachable ? {} : { note: reachability.reason ?? "the screen is not reachable" }),
      });
      continue;
    }

    if (requirement.kind === "region") {
      // A region is realized through its members; it is satisfied when the
      // screen file exists and something was written for the design.
      const satisfied = proposal.files.length > 0;
      entries.push({ requirementId: requirement.id, kind: requirement.kind, label: requirement.label, status: satisfied ? "satisfied" : "missing" });
      continue;
    }

    if (requirement.kind === "asset") {
      const decision = map.assets.find((asset) => asset.requirementId === requirement.id);
      const satisfied = decision !== undefined && decision.strategy !== "unresolved";
      entries.push({
        requirementId: requirement.id,
        kind: requirement.kind,
        label: requirement.label,
        status: satisfied ? "satisfied" : "missing",
        ...(satisfied ? {} : { note: "no asset strategy was decided" }),
      });
    }
  }

  const missing = entries.filter((entry) => entry.status === "missing");
  return {
    entries,
    requirementCount: entries.length,
    resolvedCount: entries.length - missing.length,
    missing,
  };
}

/**
 * Can a person actually open this screen?
 *
 * The destination file must exist in the proposal, and — when the map named a
 * composition root — either that root already renders the destination or the
 * proposal changes the root so that it does. A page file alone is not
 * reachability under a router that never routes to it.
 */
export function checkReachability(proposal: ProposedFileChanges, map: ImplementationMap): ReachabilityResult {
  const destination = map.screen?.destination;
  if (destination === undefined) {
    return { reachable: false, reason: "the Implementation Map decided no destination" };
  }

  const files = new Map(proposal.files.map((file) => [file.path, file.content ?? ""]));
  const destinationFile =
    [...files.keys()].find((path) => path === destination.path) ??
    [...files.keys()].find((path) => path.startsWith(`${destination.path}/`));

  if (destinationFile === undefined) {
    return {
      reachable: false,
      destinationPath: destination.path,
      reason: `the proposal never writes the mapped destination ${destination.path}`,
    };
  }

  const destinationContent = files.get(destinationFile) ?? "";
  if (destinationContent.trim().length === 0) {
    return { reachable: false, destinationPath: destinationFile, reason: "the destination file is empty" };
  }

  // A file-routing convention (Next app/pages) makes the destination reachable
  // by existing; anything else needs the composition root to mount it.
  const fileRouted = /(^|\/)(app|pages)\//.test(destinationFile) && /\b(page|route|layout)\.[jt]sx?$/.test(destinationFile);
  const rootPath = map.screen?.compositionRootPath;

  if (fileRouted) {
    return { reachable: true, destinationPath: destinationFile, ...(rootPath !== undefined ? { compositionRootPath: rootPath } : {}) };
  }

  if (rootPath === undefined) {
    return {
      reachable: false,
      destinationPath: destinationFile,
      reason: "the destination is not file-routed and the map named no composition root to mount it",
    };
  }

  const rootContent = files.get(rootPath);
  if (rootContent === undefined) {
    return {
      reachable: false,
      destinationPath: destinationFile,
      compositionRootPath: rootPath,
      reason: `the proposal does not change the composition root ${rootPath}, so nothing mounts the screen`,
    };
  }

  const mounted = rootContent.includes(stemOf(destinationFile));
  return mounted
    ? { reachable: true, destinationPath: destinationFile, compositionRootPath: rootPath }
    : {
        reachable: false,
        destinationPath: destinationFile,
        compositionRootPath: rootPath,
        reason: `${rootPath} does not reference ${stemOf(destinationFile)}, so the screen is never mounted`,
      };
}
