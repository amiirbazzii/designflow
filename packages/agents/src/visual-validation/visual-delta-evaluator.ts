// packages/agents/src/visual-validation/visual-delta-evaluator.ts
//
// Expectations × RenderedState → deterministic findings (V2-5).
//
// This is the half of visual evaluation that must never be a model's opinion.
// Whether the heading says "Add Transaction", whether the card is 56px tall,
// whether the background is #F8F8F8 — a browser already answered all three,
// and asking a model to look at a screenshot and re-answer them is how the
// product previously produced confident, unverifiable claims.
//
// Every finding here carries `origin: "deterministic"` and a real measurement
// in `expectedValue`/`actualValue`. The Visual Critic runs afterwards and may
// say which of these matter — it cannot add one, remove one, or change what
// was measured.
import {
  VISUAL_VALIDATION_SCHEMA_VERSION,
  type RenderedElementEvidence,
  type RenderedState,
  type VisualExpectation,
  type VisualFindingV1,
} from "@designflow/sdk";

import { normalizeText } from "./visual-expectation-compiler";

export interface DeltaEvaluation {
  readonly findings: readonly VisualFindingV1[];
  /** Expectations no rendered element could be anchored to, so never judged. */
  readonly unevaluatedExpectationIds: readonly string[];
  readonly evaluatedViewportId?: string;
}

/** `rgb(248, 248, 248)` / `#f8f8f8` / `#fff` → `[r, g, b]`. */
export function parseColor(value: string): readonly [number, number, number] | undefined {
  const text = value.trim().toLowerCase();

  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(text);
  if (rgb !== null) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(text);
  if (hex !== null) {
    const digits = hex[1]!;
    const full = digits.length === 3 ? digits.split("").map((digit) => digit + digit).join("") : digits;
    return [
      Number.parseInt(full.slice(0, 2), 16),
      Number.parseInt(full.slice(2, 4), 16),
      Number.parseInt(full.slice(4, 6), 16),
    ];
  }
  return undefined;
}

/**
 * Channel distance, so `#f8f8f8` and `rgb(247,248,248)` are the same color.
 *
 * Anti-aliasing, color-space conversion and a designer's rounding all move a
 * channel by one or two. A report that flags those is a report nobody reads.
 */
const COLOR_TOLERANCE = 6;

function colorsMatch(expected: string, actual: string): boolean | undefined {
  const left = parseColor(expected);
  const right = parseColor(actual);
  if (left === undefined || right === undefined) return undefined;
  return left.every((channel, index) => Math.abs(channel - right[index]!) <= COLOR_TOLERANCE);
}

function parsePx(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const match = /(-?[\d.]+)/.exec(value);
  return match === null ? undefined : Number(match[1]);
}

function finding(
  expectation: VisualExpectation,
  parts: {
    category: VisualFindingV1["category"];
    severity: VisualFindingV1["severity"];
    explanation: string;
    expectedValue?: string;
    actualValue?: string;
    measurableDelta?: number;
    element?: RenderedElementEvidence;
    viewportId?: string;
  },
): VisualFindingV1 {
  return {
    schemaVersion: VISUAL_VALIDATION_SCHEMA_VERSION,
    findingId: `finding:${expectation.id}`,
    category: parts.category,
    severity: parts.severity,
    // A measurement is not a guess. Deterministic findings are certain about
    // what was measured; whether it matters is the Critic's business.
    confidence: 1,
    status: "confirmed",
    affectedComponent: expectation.label.slice(0, 200),
    ...(parts.expectedValue !== undefined ? { expectedValue: parts.expectedValue.slice(0, 2_000) } : {}),
    ...(parts.actualValue !== undefined ? { actualValue: parts.actualValue.slice(0, 2_000) } : {}),
    ...(parts.measurableDelta !== undefined ? { measurableDelta: parts.measurableDelta } : {}),
    ...(parts.element !== undefined
      ? {
          boundingRegion: {
            x: parts.element.x,
            y: parts.element.y,
            width: parts.element.width,
            height: parts.element.height,
          },
        }
      : {}),
    explanation: parts.explanation.slice(0, 4_000),
    evidenceReferences: [
      expectation.blueprintRef,
      ...(parts.viewportId !== undefined ? [`viewport:${parts.viewportId}`] : []),
      ...(parts.element !== undefined ? [`selector:${parts.element.selector}`] : []),
    ].slice(0, 32),
    origin: "deterministic",
  };
}

/**
 * The rendered element that corresponds to an expectation's design element.
 *
 * Matched on exact copy, then on containment, then by smallest box — the
 * smallest node carrying the text is the label itself rather than one of its
 * ancestors, which is what makes a height measurement meaningful.
 */
function anchorFor(
  expected: string,
  elements: readonly RenderedElementEvidence[],
): RenderedElementEvidence | undefined {
  const needle = normalizeText(expected);
  if (needle.length === 0) return undefined;

  const exact = elements.filter((element) => normalizeText(element.text ?? "") === needle);
  const pool = exact.length > 0 ? exact : elements.filter((element) => normalizeText(element.text ?? "").includes(needle));
  if (pool.length === 0) return undefined;

  return [...pool].sort((left, right) => left.width * left.height - right.width * right.height)[0];
}

export function evaluateVisualDeltas(
  expectations: readonly VisualExpectation[],
  renderedState: RenderedState,
): DeltaEvaluation {
  if (renderedState.status !== "rendered" || renderedState.elements.length === 0)
    return { findings: [], unevaluatedExpectationIds: expectations.map((expectation) => expectation.id) };

  // One viewport carries the comparison. Repeating every finding three times
  // because the design has three breakpoints buries the actual problem, and
  // the Blueprint's facts describe one frame, not a responsive matrix.
  const viewportId = renderedState.elements[0]!.viewportId;
  const elements = renderedState.elements.filter((element) => element.viewportId === viewportId);
  const allText = elements.map((element) => element.text ?? "").join("\n");
  const allColors = elements.flatMap((element) =>
    [element.color, element.backgroundColor, element.borderColor].filter(
      (value): value is string => value !== undefined,
    ),
  );

  const findings: VisualFindingV1[] = [];
  const unevaluated: string[] = [];

  for (const expectation of expectations) {
    if (expectation.property === "anyColor") {
      const present = allColors.some((color) => colorsMatch(expectation.expected, color) === true);
      if (!present)
        findings.push(
          finding(expectation, {
            category: "color",
            severity: expectation.severityIfMissing,
            expectedValue: expectation.expected,
            explanation: `The map kept ${expectation.expected} as a raw design value, but nothing rendered uses it.`,
            viewportId,
          }),
        );
      continue;
    }

    if (expectation.property === "text") {
      if (normalizeText(allText).includes(normalizeText(expectation.expected))) continue;
      findings.push(
        finding(expectation, {
          category: "missing-element",
          severity: expectation.severityIfMissing,
          expectedValue: expectation.expected,
          explanation: `The design shows "${expectation.expected}", but no rendered element carries that text.`,
          viewportId,
        }),
      );
      continue;
    }

    // Every other expectation needs the element the copy identifies. If the
    // copy itself is missing, the content finding above already said so and a
    // second one about its font size would only be noise.
    const contentExpectation = expectations.find(
      (candidate) => candidate.blueprintRef === expectation.blueprintRef && candidate.property === "text",
    );
    const anchor = contentExpectation === undefined ? undefined : anchorFor(contentExpectation.expected, elements);
    if (anchor === undefined) {
      unevaluated.push(expectation.id);
      continue;
    }

    if (expectation.property === "color" || expectation.property === "backgroundColor") {
      const actual = expectation.property === "color" ? anchor.color : anchor.backgroundColor;
      if (actual === undefined) {
        unevaluated.push(expectation.id);
        continue;
      }
      const matches = colorsMatch(expectation.expected, actual);
      if (matches === undefined) {
        unevaluated.push(expectation.id);
        continue;
      }
      if (!matches)
        findings.push(
          finding(expectation, {
            category: "color",
            severity: expectation.severityIfMissing,
            expectedValue: expectation.expected,
            actualValue: actual,
            element: anchor,
            viewportId,
            explanation: `${expectation.label} renders ${actual} where the design specifies ${expectation.expected}.`,
          }),
        );
      continue;
    }

    const actualNumber =
      expectation.property === "height"
        ? anchor.height
        : expectation.property === "fontSize"
          ? parsePx(anchor.fontSize)
          : expectation.property === "borderRadius"
            ? parsePx(anchor.borderRadius)
            : undefined;

    if (actualNumber === undefined || expectation.expectedNumber === undefined) {
      unevaluated.push(expectation.id);
      continue;
    }

    const delta = actualNumber - expectation.expectedNumber;
    if (Math.abs(delta) <= (expectation.tolerance ?? 0)) continue;

    findings.push(
      finding(expectation, {
        category: expectation.property === "fontSize" ? "typography" : expectation.property === "height" ? "size" : "radius",
        severity: expectation.severityIfMissing,
        expectedValue: expectation.expected,
        actualValue: `${Math.round(actualNumber * 100) / 100}px`,
        measurableDelta: Math.round(delta * 100) / 100,
        element: anchor,
        viewportId,
        explanation: `${expectation.label} renders at ${Math.round(actualNumber * 100) / 100}px where the design specifies ${expectation.expected}.`,
      }),
    );
  }

  return { findings, unevaluatedExpectationIds: unevaluated, evaluatedViewportId: viewportId };
}
