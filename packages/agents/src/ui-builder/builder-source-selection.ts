// packages/agents/src/ui-builder/builder-source-selection.ts
//
// Which project files the Builder is allowed to see.
//
// The host decides — never the model. The Implementation Map already names
// every file the plan touches: the components it reuses or extends, the
// destination, the composition root. That set, and only that set, is what the
// Builder reads. There is no filesystem tool and no way to ask for more.
//
// This is the difference between "here is your project, find what you need"
// and "here are the four files your plan is about". The second is smaller,
// reproducible, and cannot leak a `.env` into a model request.
import type { ImplementationMap } from "@designflow/sdk";

/** Source excerpts the caller read for the host-selected paths. */
export interface BuilderSourceExcerpt {
  readonly path: string;
  readonly content: string;
  /** Content hash at read time, so staleness is detectable. */
  readonly hash: string;
}

export interface SelectedSourcePath {
  readonly path: string;
  readonly reason: "reuse-target" | "extend-target" | "destination" | "composition-root";
  /** Whether the Builder may propose changes to this file. */
  readonly writable: boolean;
}

/** Excerpt budget per file; a component the Builder must extend is read, not skimmed. */
export const MAX_SOURCE_EXCERPT_BYTES = 24_000;
export const MAX_SELECTED_SOURCE_FILES = 16;

/**
 * Derives the allowed source set from the map.
 *
 * `writable` is the enforcement seed: a reuse target is readable so the
 * Builder can import it correctly, and *not* writable, because reuse means
 * the component's public contract does not change.
 */
export function selectBuilderSourcePaths(map: ImplementationMap): readonly SelectedSourcePath[] {
  const selected = new Map<string, SelectedSourcePath>();
  const add = (path: string | undefined, reason: SelectedSourcePath["reason"], writable: boolean): void => {
    if (path === undefined || path.length === 0) return;
    const existing = selected.get(path);
    // A file selected twice keeps the more permissive access it was granted.
    if (existing !== undefined && existing.writable) return;
    selected.set(path, { path, reason, writable });
  };

  for (const component of map.components) {
    if (component.action === "reuse") add(component.projectTarget?.path, "reuse-target", false);
    if (component.action === "extend") add(component.projectTarget?.path, "extend-target", true);
  }

  add(map.screen?.destination.path, "destination", true);
  add(map.screen?.compositionRootPath, "composition-root", true);

  return [...selected.values()]
    .sort((left, right) => left.path.localeCompare(right.path))
    .slice(0, MAX_SELECTED_SOURCE_FILES);
}

/**
 * Every path the proposal is permitted to write.
 *
 * Writable selected files, plus the planned path of each `create` decision.
 * Anything else in a proposal is an unrelated file the plan never authorized.
 */
export function allowedWritePaths(map: ImplementationMap): readonly string[] {
  const paths = selectBuilderSourcePaths(map)
    .filter((entry) => entry.writable)
    .map((entry) => entry.path);

  for (const component of map.components) {
    if (component.action === "create" && component.plannedPath !== undefined) paths.push(component.plannedPath);
  }

  const destination = map.screen?.destination;
  if (destination !== undefined) paths.push(destination.path);

  return [...new Set(paths)].sort();
}

/**
 * Whether the proposal may write this path.
 *
 * A `create_page` destination names a *directory* — the Mapper chose where a
 * new page goes under the project's routing convention, not the file name,
 * which the convention itself determines (`app/add/page.tsx`). So a directory
 * destination authorizes the files beneath it; every other allowed path is
 * exact.
 */
export function isWriteAllowed(path: string, map: ImplementationMap): boolean {
  if (allowedWritePaths(map).includes(path)) return true;

  const destination = map.screen?.destination;
  if (destination === undefined) return false;
  const createsUnderDirectory =
    destination.action === "create_page" || destination.action === "create_route";
  return createsUnderDirectory && path.startsWith(`${destination.path}/`);
}

/** Bounds one file's content for a model request without hiding that it was cut. */
export function boundExcerpt(content: string): { text: string; truncated: boolean } {
  if (content.length <= MAX_SOURCE_EXCERPT_BYTES) return { text: content, truncated: false };
  return { text: `${content.slice(0, MAX_SOURCE_EXCERPT_BYTES)}\n/* … truncated by DesignFlow … */\n`, truncated: true };
}
