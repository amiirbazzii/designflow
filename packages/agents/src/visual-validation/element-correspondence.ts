// packages/agents/src/visual-validation/element-correspondence.ts
//
// Which rendered element is a design expectation about? (V2-5.1)
//
// V2-5 answered this with exact visible copy alone, and disclosed the cost: a
// screen with two "Optional" labels matches the wrong one half the time, and
// then reports a confident, pixel-accurate delta about an element nobody
// asked about. A wrong measurement presented as certain is worse than no
// measurement, because it survives review.
//
// So identification happens first, deterministically, and its uncertainty is
// carried rather than rounded away:
//
//   expectation → candidates → signals → matched | ambiguous | unmatched
//
// Signals are applied strongest-first and only ever *narrow* the candidate
// set. Nothing here breaks a tie by picking the first, the nearest or the
// prettiest: if two candidates survive every signal, the answer is
// `ambiguous`, and the evaluator emits no precise delta from it.
//
// The Visual Critic never sees this problem. Correspondence is evidence, not
// judgment — a model asked "which div is the header?" will always answer, and
// that is exactly the failure mode.
import type {
  CorrespondenceSignal,
  ElementCorrespondence,
  RenderedElementEvidence,
  VisualExpectation,
} from "@designflow/sdk";

import { normalizeText } from "./visual-expectation-compiler";

export interface CorrespondenceResult {
  readonly correspondences: readonly ElementCorrespondence[];
  /** Resolved element per blueprintRef, present only for `matched`. */
  readonly matches: ReadonlyMap<string, RenderedElementEvidence>;
  readonly byRef: ReadonlyMap<string, ElementCorrespondence>;
}

/**
 * Confidence per identifying signal.
 *
 * These bound a finding's confidence — a measurement can never be more
 * certain than the identification it rests on. Instrumentation is 1 because
 * the host wrote the marker and the browser read it back; content alone is
 * 0.7 because a unique string is good evidence and not proof.
 */
const SIGNAL_CONFIDENCE: Readonly<Record<CorrespondenceSignal, number>> = Object.freeze({
  instrumentation: 1,
  mapped_component: 0.95,
  structure: 0.85,
  content: 0.7,
  geometry: 0.75,
});

function componentTokens(name: string): readonly string[] {
  // `NavigationMenuV3` → ["navigationmenuv3", "navigation-menu-v3"]; project
  // class names and markers use either convention.
  const compact = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const dashed = name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");
  return compact.length >= 3 ? [compact, dashed] : [];
}

/** Does this rendered element look like an instance of the mapped component? */
function looksLikeComponent(element: RenderedElementEvidence, name: string): boolean {
  const tokens = componentTokens(name);
  if (tokens.length === 0) return false;
  const haystack = [element.selector, element.instrumentationRef ?? "", ...element.ancestorPath]
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9- ]/g, "");
  return tokens.some((token) => haystack.includes(token));
}

function textOf(element: RenderedElementEvidence): string {
  return normalizeText(element.text ?? "");
}

function area(element: RenderedElementEvidence): number {
  return element.width * element.height;
}

/**
 * Resolves one expectation against the rendered elements of one viewport.
 *
 * Each stage narrows; a stage that would empty the set is skipped rather than
 * applied, so a weak signal can never turn a real match into "unmatched".
 */
function resolveOne(
  expectation: VisualExpectation,
  elements: readonly RenderedElementEvidence[],
  viewportId: string,
): { correspondence: ElementCorrespondence; element?: RenderedElementEvidence } {
  const anchor = expectation.anchor;
  const signals: CorrespondenceSignal[] = [];
  let candidates = [...elements];

  const narrow = (
    signal: CorrespondenceSignal,
    predicate: (element: RenderedElementEvidence) => boolean,
  ): void => {
    const next = candidates.filter(predicate);
    if (next.length === 0 || next.length === candidates.length) return;
    candidates = next;
    signals.push(signal);
  };

  // A. Instrumentation: the host's own marker, read back off the node. When
  // it is present it is decisive on its own, including for elements that
  // carry no text at all.
  if (anchor.instrumentationRef !== undefined) {
    const marked = candidates.filter((element) => element.instrumentationRef === anchor.instrumentationRef);
    if (marked.length > 0) {
      candidates = marked;
      signals.push("instrumentation");
    }
  }

  // B. The Implementation Map already decided which project component realizes
  // this requirement, so an element that does not look like that component is
  // not a candidate for it.
  if (anchor.mappedComponentName !== undefined)
    narrow("mapped_component", (element) => looksLikeComponent(element, anchor.mappedComponentName!));

  // C. Structure: the tag family the design implies, e.g. an image node must
  // be an image. This is the main signal for elements with no copy.
  if (anchor.tagHints.length > 0)
    narrow("structure", (element) =>
      anchor.tagHints.includes((element.tagName ?? "").toLowerCase()) ||
      anchor.tagHints.some((hint) => element.ancestorPath.some((step) => step.toLowerCase() === hint)),
    );

  if (anchor.elementKind === "asset")
    narrow("structure", (element) => element.assetSource !== undefined || (element.tagName ?? "") === "img");

  // D. Exact content. Still useful, no longer the sole identity mechanism.
  if (anchor.text !== undefined && anchor.text.length > 0) {
    const needle = normalizeText(anchor.text);
    const exact = candidates.filter((element) => textOf(element) === needle);
    const containing = candidates.filter((element) => textOf(element).includes(needle));
    if (exact.length > 0) {
      candidates = exact;
      signals.push("content");
    } else if (containing.length > 0) {
      // Recorded even when it narrows nothing: several nodes carrying the copy
      // is an ambiguity worth reporting, not an absence.
      candidates = containing;
      signals.push("content");
    }
  }

  // Containers and components are identified by the copy they *hold*.
  if (anchor.containedText.length > 0 && anchor.text === undefined) {
    const needles = anchor.containedText.map(normalizeText);
    const holders = candidates.filter((element) => {
      const text = textOf(element);
      return needles.every((needle) => text.includes(needle));
    });
    if (holders.length > 0) {
      candidates = holders;
      signals.push("content");
      // The tightest node that still holds all of it is the container itself
      // rather than one of its ancestors.
      const smallest = Math.min(...holders.map(area));
      const tight = holders.filter((element) => area(element) <= smallest * 1.05);
      if (tight.length > 0 && tight.length < holders.length) candidates = tight;
    }
  }

  // E. Geometry, used only to disambiguate and only when it is decisive:
  // design order versus render order among otherwise identical candidates.
  if (candidates.length > 1 && anchor.order !== undefined) {
    const ordered = [...candidates].sort((left, right) => left.y - right.y || left.x - right.x);
    const byIndex = ordered.filter((element) => element.siblingIndex === anchor.order);
    if (byIndex.length === 1) {
      candidates = byIndex;
      signals.push("geometry");
    }
  }

  const base = (): Omit<ElementCorrespondence, "state" | "confidence" | "candidateCount"> => ({
    blueprintRef: expectation.blueprintRef,
    signals,
    viewportId,
  });

  if (candidates.length === 0 || signals.length === 0)
    return {
      correspondence: {
        ...base(),
        state: "unmatched",
        confidence: 0,
        candidateCount: 0,
        reason:
          signals.length === 0
            ? "No deterministic signal identified this element in the rendered output."
            : "No rendered element satisfied every deterministic signal.",
      },
    };

  // Structure and geometry narrow; they do not identify. "The only `nav` on
  // the page" is a coincidence away from being wrong, and a single surviving
  // candidate is not evidence that it is the right one. Assets are the
  // exception: for an icon, being the image in that position is the identity.
  const decisive =
    signals.some((signal) => signal === "instrumentation" || signal === "mapped_component" || signal === "content") ||
    (anchor.elementKind === "asset" && signals.includes("structure"));

  if (!decisive)
    return {
      correspondence: {
        ...base(),
        state: "unmatched",
        confidence: 0,
        candidateCount: candidates.length,
        reason: "Only structural evidence was available, which narrows candidates but does not identify one.",
      },
    };

  if (candidates.length > 1)
    return {
      correspondence: {
        ...base(),
        state: "ambiguous",
        // Identification failed, so nothing downstream may claim certainty.
        confidence: 0,
        candidateCount: candidates.length,
        reason: `${candidates.length} rendered elements remained plausible after every deterministic signal.`,
      },
    };

  const element = candidates[0]!;
  // The weakest signal used bounds the result: a match resting partly on bare
  // copy is a copy-strength match, however many other hints agreed.
  const confidence = Math.min(...signals.map((signal) => SIGNAL_CONFIDENCE[signal]));

  return {
    element,
    correspondence: {
      ...base(),
      state: "matched",
      confidence,
      candidateCount: 1,
      selector: element.selector,
    },
  };
}

/**
 * Resolves every expectation against one viewport's rendered elements.
 *
 * Expectations sharing a `blueprintRef` are resolved once — they are all about
 * the same element, and resolving per-property would let a font-size check and
 * a height check silently land on different nodes.
 */
export function resolveCorrespondence(
  expectations: readonly VisualExpectation[],
  elements: readonly RenderedElementEvidence[],
  viewportId: string,
): CorrespondenceResult {
  const correspondences: ElementCorrespondence[] = [];
  const matches = new Map<string, RenderedElementEvidence>();
  const byRef = new Map<string, ElementCorrespondence>();

  for (const expectation of expectations) {
    if (byRef.has(expectation.blueprintRef)) continue;
    const { correspondence, element } = resolveOne(expectation, elements, viewportId);
    correspondences.push(correspondence);
    byRef.set(expectation.blueprintRef, correspondence);
    if (element !== undefined) matches.set(expectation.blueprintRef, element);
  }

  return { correspondences, matches, byRef };
}
