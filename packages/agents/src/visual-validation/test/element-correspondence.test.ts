// packages/agents/src/visual-validation/test/element-correspondence.test.ts
//
// V2-5.1: identification before measurement.
//
// V2-5 shipped with a disclosed risk — matching on exact copy alone can attach
// one element's expected geometry to a different element that merely shares a
// string. These tests are that risk, written down and refused.
import { describe, expect, test } from "bun:test";
import type { RenderedElementEvidence, VisualExpectation } from "@designflow/sdk";

import { evaluateVisualDeltas, resolveCorrespondence } from "../index";
import { renderedWith } from "./fixtures/rendered-state-fixtures";

function element(overrides: Partial<RenderedElementEvidence> & { selector: string }): RenderedElementEvidence {
  return {
    viewportId: "desktop",
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    ancestorPath: ["body", "div"],
    ...overrides,
  };
}

function expectation(overrides: Partial<VisualExpectation> = {}): VisualExpectation {
  return {
    id: "expectation:1:height",
    kind: "geometry",
    blueprintRef: "1:41",
    label: "Amount field",
    property: "height",
    expected: "56px",
    expectedNumber: 56,
    tolerance: 4,
    severityIfMissing: "minor",
    anchor: { elementKind: "text", text: "Optional", tagHints: [], containedText: [] },
    ...overrides,
  };
}

describe("ambiguity", () => {
  test("two identical strings do not resolve to one of them", () => {
    // The exact V2-5 failure: a screen with two "Optional" labels.
    const elements = [
      element({ selector: "#first", text: "Optional", height: 56 }),
      element({ selector: "#second", text: "Optional", height: 24, y: 400 }),
    ];
    const { byRef } = resolveCorrespondence([expectation()], elements, "desktop");
    const correspondence = byRef.get("1:41")!;

    expect(correspondence.state).toBe("ambiguous");
    expect(correspondence.candidateCount).toBe(2);
    expect(correspondence.selector).toBeUndefined();
    // Identification failed, so nothing downstream may claim certainty.
    expect(correspondence.confidence).toBe(0);
  });

  test("no precise measurement is emitted from an unresolved ambiguity", () => {
    const rendered = renderedWith([
      { text: "Optional", height: 56 },
      { text: "Optional", height: 24 },
    ]);
    const { findings, unevaluatedExpectationIds } = evaluateVisualDeltas([expectation()], rendered);

    expect(findings).toHaveLength(0);
    expect(unevaluatedExpectationIds).toContain("expectation:1:height");
  });

  test("ambiguity is reported on the presence question rather than hidden", () => {
    const presence = expectation({ id: "expectation:1:presence", property: "text", expected: "Optional", kind: "content" });
    const rendered = renderedWith([{ text: "Optional" }, { text: "Optional" }]);
    const { findings } = evaluateVisualDeltas([presence], rendered);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.status).toBe("not-applicable");
    expect(findings[0]!.confidence).toBe(0);
    expect(findings[0]!.measurableDelta).toBeUndefined();
    expect(findings[0]!.explanation).toContain("could not be identified uniquely");
  });

  test("another deterministic signal resolves what copy alone cannot", () => {
    const elements = [
      element({ selector: "#first", text: "Optional", height: 56, instrumentationRef: "requirement:component:AmountField" }),
      element({ selector: "#second", text: "Optional", height: 24, y: 400 }),
    ];
    const anchored = expectation({
      anchor: { elementKind: "text", text: "Optional", instrumentationRef: "requirement:component:AmountField", tagHints: [], containedText: [] },
    });
    const { byRef } = resolveCorrespondence([anchored], elements, "desktop");

    expect(byRef.get("1:41")!.state).toBe("matched");
    expect(byRef.get("1:41")!.selector).toBe("#first");
    expect(byRef.get("1:41")!.signals).toContain("instrumentation");
  });
});

describe("wrong-match refusal", () => {
  test("an unrelated element that merely contains the copy does not inherit the expectation", () => {
    // Element B is a wrapper that happens to contain A's text. V2-5 would
    // have measured B's height against A's design height.
    const elements = [
      element({ selector: "#wrapper", text: "Enter amount and confirm", height: 300, width: 390 }),
      element({ selector: "#other-wrapper", text: "Enter amount and confirm again", height: 500, width: 390 }),
    ];
    const { byRef } = resolveCorrespondence(
      [expectation({ anchor: { elementKind: "text", text: "Enter amount", tagHints: [], containedText: [] } })],
      elements,
      "desktop",
    );

    const correspondence = byRef.get("1:41")!;
    expect(correspondence.state).toBe("ambiguous");
    expect(correspondence.selector).toBeUndefined();
  });

  test("a match resting on copy alone is never reported at full confidence", () => {
    const elements = [element({ selector: "#only", text: "Optional", height: 24 })];
    const { byRef } = resolveCorrespondence([expectation()], elements, "desktop");
    const correspondence = byRef.get("1:41")!;

    expect(correspondence.state).toBe("matched");
    expect(correspondence.signals).toEqual(["content"]);
    expect(correspondence.confidence).toBeLessThan(1);
  });

  test("a finding is never more certain than the identification underneath it", () => {
    const rendered = renderedWith([{ text: "Optional", height: 24 }]);
    const { findings } = evaluateVisualDeltas([expectation()], rendered);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.confidence).toBe(0.7);
    expect(findings[0]!.measurableDelta).toBe(-32);
  });
});

describe("elements with no visible copy", () => {
  const navExpectation = expectation({
    id: "expectation:nav:presence",
    blueprintRef: "component:BottomNavigation",
    label: "BottomNavigation",
    kind: "structure",
    property: "presence",
    expected: "BottomNavigation is rendered",
    expectedNumber: undefined,
    severityIfMissing: "major",
    anchor: {
      elementKind: "component",
      instrumentationRef: "requirement:component:BottomNavigation",
      mappedComponentName: "NavigationMenuV3",
      tagHints: ["nav", "div"],
      containedText: [],
    },
  });

  test("a host marker identifies a component that carries no text at all", () => {
    const elements = [
      element({ selector: "marker:requirement:component:BottomNavigation", tagName: "nav", instrumentationRef: "requirement:component:BottomNavigation" }),
      element({ selector: "#unrelated", tagName: "div", text: "Add Transaction" }),
    ];
    const { byRef } = resolveCorrespondence([navExpectation], elements, "desktop");

    expect(byRef.get("component:BottomNavigation")!.state).toBe("matched");
    expect(byRef.get("component:BottomNavigation")!.confidence).toBe(1);
  });

  test("the mapped component name identifies it when no marker was injected", () => {
    const elements = [
      element({ selector: "nav.navigation-menu-v3", tagName: "nav" }),
      element({ selector: "#unrelated", tagName: "div", text: "Add Transaction" }),
    ];
    const { byRef } = resolveCorrespondence([navExpectation], elements, "desktop");

    const correspondence = byRef.get("component:BottomNavigation")!;
    expect(correspondence.state).toBe("matched");
    expect(correspondence.signals).toContain("mapped_component");
  });

  test("an icon is identified structurally rather than by copy", () => {
    const iconExpectation = expectation({
      id: "expectation:icon:presence",
      blueprintRef: "1:9",
      label: "Back icon",
      kind: "structure",
      property: "presence",
      expected: "Back icon is rendered",
      expectedNumber: undefined,
      anchor: { elementKind: "asset", tagHints: ["svg", "img"], containedText: [] },
    });
    const elements = [
      element({ selector: "img.back", tagName: "img", assetSource: "/icons/back.svg" }),
      element({ selector: "p", tagName: "p", text: "Add Transaction" }),
    ];
    const { byRef } = resolveCorrespondence([iconExpectation], elements, "desktop");

    expect(byRef.get("1:9")!.state).toBe("matched");
    expect(byRef.get("1:9")!.signals).toContain("structure");
  });

  test("a container is identified by the copy it holds, not by copy it owns", () => {
    const cardExpectation = expectation({
      id: "expectation:card:presence",
      blueprintRef: "1:61",
      label: "History card",
      kind: "structure",
      property: "presence",
      expected: "History card is rendered",
      expectedNumber: undefined,
      anchor: {
        elementKind: "container",
        tagHints: ["div", "article"],
        containedText: ["Deposit from Alex", "-5,000 T"],
      },
    });
    const elements = [
      element({ selector: "article.card", tagName: "article", text: "Deposit from Alex Bank Deposit -5,000 T", width: 300, height: 80 }),
      element({ selector: "span", tagName: "span", text: "Deposit from Alex", width: 120, height: 20 }),
    ];
    const { byRef } = resolveCorrespondence([cardExpectation], elements, "desktop");

    expect(byRef.get("1:61")!.state).toBe("matched");
    expect(byRef.get("1:61")!.selector).toBe("article.card");
  });

  test("a no-copy element that is absent is reported missing, not skipped", () => {
    const rendered = renderedWith([{ text: "Add Transaction", tagName: "h1" }]);
    const { findings } = evaluateVisualDeltas([navExpectation], rendered);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe("missing-element");
    expect(findings[0]!.severity).toBe("major");
    expect(findings[0]!.explanation).toContain("BottomNavigation");
  });
});
