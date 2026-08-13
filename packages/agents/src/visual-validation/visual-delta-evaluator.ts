// packages/agents/src/visual-validation/visual-delta-evaluator.ts
//
// Expectations × RenderedState → deterministic findings (V2-5 / V2-5.1).
//
// This is the half of visual evaluation that must never be a model's opinion.
// Whether the heading says "Add Transaction", whether the card is 56px tall,
// whether the background is #F8F8F8 — a browser already answered all three,
// and asking a model to look at a screenshot and re-answer them is how the
// product previously produced confident, unverifiable claims.
//
// V2-5.1 puts identification first:
//
//   expectation → correspondence → matched   → measure the delta
//                                → ambiguous → say so, measure nothing
//                                → unmatched → missing / unresolved finding
//
// The old order — find the text, assume the element, measure confidently —
// could attach one element's expected geometry to a different element that
// merely shared a string. A finding's confidence is now bounded by the
// confidence of the identification underneath it.
//
// Every finding here carries `origin: "deterministic"` and a real measurement.
// The Visual Critic runs afterwards and may say which of these matter — it
// cannot add one, remove one, resolve an ambiguity, or change what was
// measured.
import {
  VISUAL_VALIDATION_SCHEMA_VERSION,
  type ElementCorrespondence,
  type RenderedElementEvidence,
  type RenderedState,
  type VisualExpectation,
  type VisualFindingV1,
} from "@designflow/sdk";

import { resolveCorrespondence } from "./element-correspondence";

export interface DeltaEvaluation {
  readonly findings: readonly VisualFindingV1[];
  /** Expectations no rendered element could be anchored to, so never judged. */
  readonly unevaluatedExpectationIds: readonly string[];
  readonly evaluatedViewportId?: string;
  readonly correspondences: readonly ElementCorrespondence[];
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
    /** Confidence in the identification; the finding can be no surer. */
    confidence: number;
    status?: VisualFindingV1["status"];
    expectedValue?: string;
    actualValue?: string;
    measurableDelta?: number;
    element?: RenderedElementEvidence;
    viewportId?: string;
    signals?: readonly string[];
  },
): VisualFindingV1 {
  return {
    schemaVersion: VISUAL_VALIDATION_SCHEMA_VERSION,
    findingId: `finding:${expectation.id}`,
    category: parts.category,
    severity: parts.severity,
    confidence: Math.max(0, Math.min(1, parts.confidence)),
    status: parts.status ?? "confirmed",
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
      ...(parts.signals ?? []).map((signal) => `signal:${signal}`),
    ].slice(0, 32),
    origin: "deterministic",
  };
}

export function evaluateVisualDeltas(
  expectations: readonly VisualExpectation[],
  renderedState: RenderedState,
): DeltaEvaluation {
  if (renderedState.status !== "rendered" || renderedState.elements.length === 0)
    return {
      findings: [],
      unevaluatedExpectationIds: expectations.map((expectation) => expectation.id),
      correspondences: [],
    };

  // One viewport carries the comparison. Repeating every finding three times
  // because the design has three breakpoints buries the actual problem, and
  // the Blueprint's facts describe one frame, not a responsive matrix.
  const viewportId = renderedState.elements[0]!.viewportId;
  const elements = renderedState.elements.filter((element) => element.viewportId === viewportId);
  const allColors = elements.flatMap((element) =>
    [element.color, element.backgroundColor, element.borderColor].filter(
      (value): value is string => value !== undefined,
    ),
  );

  const { correspondences, matches, byRef } = resolveCorrespondence(expectations, elements, viewportId);

  const findings: VisualFindingV1[] = [];
  const unevaluated: string[] = [];

  for (const expectation of expectations) {
    // A raw design color is a property of the page, not of one element.
    if (expectation.property === "anyColor") {
      const present = allColors.some((color) => colorsMatch(expectation.expected, color) === true);
      if (!present)
        findings.push(
          finding(expectation, {
            category: "color",
            severity: expectation.severityIfMissing,
            confidence: 1,
            expectedValue: expectation.expected,
            explanation: `The map kept ${expectation.expected} as a raw design value, but nothing rendered uses it.`,
            viewportId,
          }),
        );
      continue;
    }

    const correspondence = byRef.get(expectation.blueprintRef);
    const element = matches.get(expectation.blueprintRef);
    const isPresence = expectation.property === "text" || expectation.property === "presence";

    // A. Nothing in the render corresponds to this design element.
    if (correspondence === undefined || correspondence.state === "unmatched") {
      if (!isPresence) {
        unevaluated.push(expectation.id);
        continue;
      }
      findings.push(
        finding(expectation, {
          category: "missing-element",
          severity: expectation.severityIfMissing,
          // Certain that nothing matched; that is itself a measurement.
          confidence: 1,
          expectedValue: expectation.expected,
          explanation:
            expectation.property === "text"
              ? `The design shows "${expectation.expected}", but no rendered element carries that text.`
              : `The design includes ${expectation.label}, but no rendered element corresponds to it.`,
          viewportId,
        }),
      );
      continue;
    }

    // B. Several rendered elements remain plausible. Saying which one is wrong
    // would be a guess, and a guess with a pixel value attached reads as fact.
    if (correspondence.state === "ambiguous") {
      if (isPresence)
        findings.push(
          finding(expectation, {
            category: "component-structure",
            severity: "info",
            confidence: 0,
            status: "not-applicable",
            expectedValue: expectation.expected,
            explanation: `${expectation.label} could not be identified uniquely in the rendered output: ${correspondence.candidateCount} elements matched every available signal, so no measurement was taken.`,
            viewportId,
            signals: correspondence.signals,
          }),
        );
      else unevaluated.push(expectation.id);
      continue;
    }

    // C. Identified. Now — and only now — measure.
    if (element === undefined) {
      unevaluated.push(expectation.id);
      continue;
    }
    if (isPresence) continue;

    if (expectation.property === "color" || expectation.property === "backgroundColor") {
      const actual = expectation.property === "color" ? element.color : element.backgroundColor;
      if (actual === undefined) {
        unevaluated.push(expectation.id);
        continue;
      }
      const matched = colorsMatch(expectation.expected, actual);
      if (matched === undefined) {
        unevaluated.push(expectation.id);
        continue;
      }
      if (!matched)
        findings.push(
          finding(expectation, {
            category: "color",
            severity: expectation.severityIfMissing,
            confidence: correspondence.confidence,
            expectedValue: expectation.expected,
            actualValue: actual,
            element,
            viewportId,
            signals: correspondence.signals,
            explanation: `${expectation.label} renders ${actual} where the design specifies ${expectation.expected}.`,
          }),
        );
      continue;
    }

    const actualNumber =
      expectation.property === "height"
        ? element.height
        : expectation.property === "width"
          ? element.width
          : expectation.property === "fontSize"
            ? parsePx(element.fontSize)
            : expectation.property === "borderRadius"
              ? parsePx(element.borderRadius)
              : undefined;

    if (actualNumber === undefined || expectation.expectedNumber === undefined) {
      unevaluated.push(expectation.id);
      continue;
    }

    const delta = actualNumber - expectation.expectedNumber;
    if (Math.abs(delta) <= (expectation.tolerance ?? 0)) continue;

    findings.push(
      finding(expectation, {
        category:
          expectation.property === "fontSize"
            ? "typography"
            : expectation.property === "borderRadius"
              ? "radius"
              : "size",
        severity: expectation.severityIfMissing,
        confidence: correspondence.confidence,
        expectedValue: expectation.expected,
        actualValue: `${Math.round(actualNumber * 100) / 100}px`,
        measurableDelta: Math.round(delta * 100) / 100,
        element,
        viewportId,
        signals: correspondence.signals,
        explanation: `${expectation.label} renders at ${Math.round(actualNumber * 100) / 100}px where the design specifies ${expectation.expected}.`,
      }),
    );
  }

  return { findings, unevaluatedExpectationIds: unevaluated, evaluatedViewportId: viewportId, correspondences };
}
