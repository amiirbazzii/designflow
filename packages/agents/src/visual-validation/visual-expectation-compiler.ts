// packages/agents/src/visual-validation/visual-expectation-compiler.ts
//
// Blueprint → checkable visual expectations (Agent Architecture V2, V2-5).
//
// Nothing here calls a model. The Blueprint's `facts` are already the design's
// deterministic truth — an exact string, a width in pixels, a hex color — so
// turning them into things a browser can be asked about is arithmetic, not
// judgment.
//
// One deliberate restriction shapes the whole file: an expectation is emitted
// only when the element carries **exact visible copy**. Text is the only
// anchor that lets a rendered DOM node be matched back to a design element
// without guessing, and a wrong match produces a confident, wrong finding —
// far more damaging than a missing one. Elements without copy are counted as
// unanchorable rather than silently dropped.
import type { ImplementationMap, UIBlueprint, VisualExpectation } from "@designflow/sdk";

export interface CompiledExpectations {
  readonly expectations: readonly VisualExpectation[];
  /** Elements that carry design facts but no text to anchor them by. */
  readonly unanchorableElementCount: number;
  readonly bounds: readonly { collection: string; originalCount: number; retainedCount: number; reason: string }[];
}

/** The contract's ceiling; beyond this the report stops being readable anyway. */
const MAX_EXPECTATIONS = 200;

/** Text is compared as a human reads it, not as the DOM serializes it. */
export function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function geometryTolerance(px: number): number {
  // Fonts, borders and subpixel layout move real implementations a little.
  // 4px or 5%, whichever is larger, keeps honest rendering out of the report.
  return Math.max(4, px * 0.05);
}

export function compileVisualExpectations(
  blueprint: UIBlueprint,
  map?: ImplementationMap,
): CompiledExpectations {
  const expectations: VisualExpectation[] = [];
  let unanchorable = 0;

  for (const element of blueprint.elements) {
    const { facts, semantics } = element;
    const text = facts.text?.trim();

    if (text === undefined || text.length === 0) {
      if (facts.widthPx !== undefined || facts.style?.background !== undefined) unanchorable += 1;
      continue;
    }

    const label = facts.name ?? text.slice(0, 60);
    // Copy the user reads is the design. Primary copy missing is not a
    // near-miss, it is the wrong screen.
    const missingSeverity = semantics.importance === "primary" ? "critical" : "major";

    expectations.push({
      id: `expectation:${element.id}:text`,
      kind: "content",
      blueprintRef: element.id,
      label,
      property: "text",
      expected: text.slice(0, 400),
      severityIfMissing: missingSeverity,
    });

    if (facts.heightPx !== undefined && facts.heightPx > 0)
      expectations.push({
        id: `expectation:${element.id}:height`,
        kind: "geometry",
        blueprintRef: element.id,
        label,
        property: "height",
        expected: `${facts.heightPx}px`,
        expectedNumber: facts.heightPx,
        tolerance: geometryTolerance(facts.heightPx),
        severityIfMissing: "minor",
      });

    if (facts.typography?.fontSizePx !== undefined && facts.typography.fontSizePx > 0)
      expectations.push({
        id: `expectation:${element.id}:font-size`,
        kind: "typography",
        blueprintRef: element.id,
        label,
        property: "fontSize",
        expected: `${facts.typography.fontSizePx}px`,
        expectedNumber: facts.typography.fontSizePx,
        tolerance: 1,
        severityIfMissing: "minor",
      });

    if (facts.textColor !== undefined)
      expectations.push({
        id: `expectation:${element.id}:color`,
        kind: "surface",
        blueprintRef: element.id,
        label,
        property: "color",
        expected: facts.textColor,
        severityIfMissing: "minor",
      });

    if (facts.style?.background !== undefined)
      expectations.push({
        id: `expectation:${element.id}:background`,
        kind: "surface",
        blueprintRef: element.id,
        label,
        property: "backgroundColor",
        expected: facts.style.background,
        severityIfMissing: "minor",
      });

    if (facts.style?.radiusPx !== undefined && facts.style.radiusPx > 0)
      expectations.push({
        id: `expectation:${element.id}:radius`,
        kind: "surface",
        blueprintRef: element.id,
        label,
        property: "borderRadius",
        expected: `${facts.style.radiusPx}px`,
        expectedNumber: facts.style.radiusPx,
        tolerance: 2,
        severityIfMissing: "minor",
      });
  }

  // A style the map deliberately kept as a raw design value has no token to
  // hide behind: it must appear on screen exactly as the design stated it.
  for (const style of map?.styles ?? []) {
    if (style.strategy !== "raw_design_value" || style.category !== "color") continue;
    expectations.push({
      id: `expectation:style:${style.designValue}`,
      kind: "surface",
      blueprintRef: `style:${style.designValue}`,
      label: `raw design color ${style.designValue}`,
      property: "anyColor",
      expected: style.designValue,
      severityIfMissing: "minor",
    });
  }

  const bounds: { collection: string; originalCount: number; retainedCount: number; reason: string }[] = [];
  if (expectations.length > MAX_EXPECTATIONS)
    bounds.push({
      collection: "expectations",
      originalCount: expectations.length,
      retainedCount: MAX_EXPECTATIONS,
      reason: "Expectation ceiling reached; content expectations are retained first.",
    });

  // Content first, so a truncated run still checks whether the right screen
  // was built before it checks whether its corners are round enough.
  const ordered = [...expectations].sort((left, right) =>
    left.kind === right.kind ? 0 : left.kind === "content" ? -1 : right.kind === "content" ? 1 : 0,
  );

  return {
    expectations: ordered.slice(0, MAX_EXPECTATIONS),
    unanchorableElementCount: unanchorable,
    bounds,
  };
}
