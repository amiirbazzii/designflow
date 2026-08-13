// workflows/workflow-design-to-code/src/visual-validation/render-instrumentation.ts
//
// Host-owned correspondence markers, written only into the throwaway copy.
//
// The problem this solves: after a page renders, nothing in the DOM says which
// div was the design's bottom navigation. Copy can identify a label; it cannot
// identify a container, an icon or a card, and it identifies the wrong node
// whenever a screen repeats a string.
//
// So the host writes the answer down before the build and reads it back after:
// a single `data-designflow-ref="<requirementId>"` attribute on the outermost
// element each proposed component returns.
//
// Five constraints make this safe rather than clever:
//
//   1. It is applied to the temporary workspace copy only. The user's project
//      is never touched, and the proposal artifact, the approval candidate and
//      the applied bytes are all the uninstrumented original.
//   2. A `data-*` attribute is inert. It cannot match a CSS selector the
//      project already wrote, and it changes no layout, no size and no color —
//      the screenshots are of the real implementation.
//   3. The transform is deliberately narrow. It only ever inserts an attribute
//      into a JSX opening tag it is confident it has parsed, and it declines
//      whenever the file does not match that narrow shape.
//   4. It is build-verified. If the instrumented workspace fails to build, the
//      render falls back to the uninstrumented proposal and records why.
//   5. `RenderedState.provenance` states plainly that the built source was not
//      byte-identical to the proposal, rather than implying that it was.
import type { ImplementationMap, ProposedFileChanges } from "@designflow/sdk";

export const INSTRUMENTATION_ATTRIBUTE = "data-designflow-ref";

export interface InstrumentationResult {
  readonly proposal: ProposedFileChanges;
  readonly applied: boolean;
  readonly instrumentedFileCount: number;
  readonly notes: readonly string[];
}

/** `export default function Page(` / `export function Card(` / `const X = (` */
const COMPONENT_DECLARATION =
  /export\s+(?:default\s+)?(?:async\s+)?function\s+[A-Z][A-Za-z0-9_]*\s*\(|export\s+(?:default\s+)?const\s+[A-Z][A-Za-z0-9_]*\s*=/g;

/**
 * The first JSX opening tag at or after `from`, when it is unambiguous.
 *
 * Returns the index just after the tag name so an attribute can be inserted
 * there. Declines — returns `undefined` — for fragments, member expressions,
 * mapped/conditional expressions and anything that is not plainly a tag, since
 * a mistake here breaks the build rather than degrading a measurement.
 */
function openingTagInsertionPoint(source: string, from: number): number | undefined {
  const match = /<([A-Za-z][A-Za-z0-9]*)(\s|>|\/)/.exec(source.slice(from, from + 4_000));
  if (match === null) return undefined;
  const index = from + match.index + 1 + match[1]!.length;
  // `<Foo.Bar>` and `<>` are out of scope on purpose.
  if (source[index] === ".") return undefined;
  return index;
}

/**
 * Which requirement a proposed file realizes.
 *
 * Taken from the Implementation Map, which already decided this: the map is
 * where "this requirement is realized by this file" was recorded, so the
 * marker carries a plan identity rather than a guess about file naming.
 */
function requirementForPath(path: string, map: ImplementationMap): string | undefined {
  for (const component of map.components) {
    if (component.projectTarget?.path === path || component.plannedPath === path) return component.requirementId;
  }
  const destination = map.screen?.destination;
  if (destination !== undefined && (path === destination.path || path.startsWith(`${destination.path}/`)))
    return map.screen?.requirementId ?? "requirement:screen";
  return undefined;
}

const INSTRUMENTABLE = /\.(jsx|tsx)$/i;

/**
 * Produces an instrumented copy of a validated proposal.
 *
 * The returned proposal is for the isolated workspace only. Its `files` differ
 * from the original by exactly one inserted attribute per component, and its
 * identity is deliberately kept separate from the validated proposal's hash by
 * the caller.
 */
export function instrumentProposal(
  proposal: ProposedFileChanges,
  map: ImplementationMap | undefined,
): InstrumentationResult {
  if (map === undefined)
    return {
      proposal,
      applied: false,
      instrumentedFileCount: 0,
      notes: ["No Implementation Map was available, so no correspondence markers could be derived."],
    };

  const notes: string[] = [];
  let instrumented = 0;

  const files = proposal.files.map((file) => {
    if (!INSTRUMENTABLE.test(file.path)) return file;
    const content = file.content;
    if (content === undefined || content.length === 0 || content.length > 400_000) return file;

    const requirementId = requirementForPath(file.path, map);
    if (requirementId === undefined) {
      notes.push(`${file.path}: no mapped requirement, left uninstrumented.`);
      return file;
    }
    if (content.includes(INSTRUMENTATION_ATTRIBUTE)) return file;

    const marker = requirementId.replace(/[^A-Za-z0-9:_-]/g, "-").slice(0, 200);
    COMPONENT_DECLARATION.lastIndex = 0;
    const declaration = COMPONENT_DECLARATION.exec(content);
    if (declaration === null) {
      notes.push(`${file.path}: no exported component declaration found, left uninstrumented.`);
      return file;
    }

    const insertion = openingTagInsertionPoint(content, declaration.index + declaration[0].length);
    if (insertion === undefined) {
      notes.push(`${file.path}: no unambiguous JSX opening tag, left uninstrumented.`);
      return file;
    }

    instrumented += 1;
    return {
      ...file,
      content: `${content.slice(0, insertion)} ${INSTRUMENTATION_ATTRIBUTE}="${marker}"${content.slice(insertion)}`,
    };
  });

  if (instrumented === 0)
    return { proposal, applied: false, instrumentedFileCount: 0, notes: notes.slice(0, 8) };

  return {
    proposal: { ...proposal, files },
    applied: true,
    instrumentedFileCount: instrumented,
    notes: notes.slice(0, 8),
  };
}
