import { describe, expect, test } from "bun:test";
import type { Key } from "ink";
import { buildSessionView, setActiveStage } from "./model";
import { isCompactTerminal, mapTuiKey, reduceTuiInteraction } from "./keys";
import { designFlowTheme, statusColor } from "./theme";
import { shouldUseTui } from "./eligibility";
import { stageMarker } from "./components";

const key = (overrides: Partial<Key> = {}): Key => ({
  upArrow: false,
  downArrow: false,
  leftArrow: false,
  rightArrow: false,
  pageDown: false,
  pageUp: false,
  return: false,
  escape: false,
  ctrl: false,
  shift: false,
  tab: false,
  backspace: false,
  delete: false,
  meta: false,
  ...overrides,
});

describe("DesignFlow TUI presentation model", () => {
  test("maps project, Figma, AI, and readiness state without raw internals", () => {
    const session = buildSessionView({
      project: { name: "Spendly", path: "/tmp/spendly" },
      figma: "connected",
      ai: "development-provider",
    });

    expect(session.project).toEqual({ name: "Spendly", path: "/tmp/spendly", status: "ready" });
    expect(session.figma).toEqual({ status: "ready", label: "Connected" });
    expect(session.ai).toEqual({ status: "ready", label: "Development provider" });
    expect(session.design).toEqual({ label: "Not selected", status: "idle" });
    expect(session.destination).toEqual({ label: "Not selected", status: "idle" });
  });

  test("keeps the seven workflow stages in product order", () => {
    const session = buildSessionView({ figma: "not-configured", ai: "not-configured" });

    expect(session.workflow.stages.map((stage) => stage.label)).toEqual([
      "Understanding",
      "Specification",
      "Project analysis",
      "Implementation",
      "Validation",
      "Visual check",
      "Correction",
    ]);
    expect(session.outputs).toEqual([]);
  });

  test("represents an active stage without mutating the source view", () => {
    const session = buildSessionView({ figma: "connected", ai: "connected" });
    const active = setActiveStage(session, "implementation");

    expect(active.workflow.status).toBe("active");
    expect(active.workflow.activeStage).toBe("implementation");
    expect(active.workflow.stages[3]?.status).toBe("active");
    expect(session.workflow.stages[3]?.status).toBe("pending");
    expect(stageMarker(active.workflow.stages[3]!)).toBe("→");
  });

  test("keeps presentation input immutable", () => {
    const facts = Object.freeze({
      project: Object.freeze({ name: "Spendly", path: "/tmp/spendly" }),
      figma: "connected" as const,
      ai: "connected" as const,
    });

    expect(() => buildSessionView(facts)).not.toThrow();
    expect(facts.project.name).toBe("Spendly");
  });
});

describe("DesignFlow TUI theme and keyboard contract", () => {
  test("uses blue as the semantic accent", () => {
    expect(designFlowTheme.accent).toBe("blue");
    expect(designFlowTheme.focus).toBe("blue");
    expect(statusColor("active")).toBe(designFlowTheme.accentStrong);
  });

  test("maps navigation, help, quit, and Ctrl+C predictably", () => {
    expect(mapTuiKey("", key({ return: true }))).toBe("activate");
    expect(mapTuiKey("", key({ upArrow: true }))).toBe("up");
    expect(mapTuiKey("", key({ downArrow: true }))).toBe("down");
    expect(mapTuiKey("", key({ tab: true }))).toBe("next-focus");
    expect(mapTuiKey("", key({ tab: true, shift: true }))).toBe("previous-focus");
    expect(mapTuiKey("?", key())).toBe("help");
    expect(mapTuiKey("q", key())).toBe("quit");
    expect(mapTuiKey("c", key({ ctrl: true }))).toBe("interrupt");
  });

  test("opens and closes help, then preserves focus navigation", () => {
    const initial = { helpOpen: false, focusArea: "main" as const, selectedStage: 0 };
    const open = reduceTuiInteraction(initial, "help", 7);
    const closed = reduceTuiInteraction(open, "back", 7);
    const focused = reduceTuiInteraction(closed, "next-focus", 7);
    const moved = reduceTuiInteraction(focused, "down", 7);

    expect(open.helpOpen).toBe(true);
    expect(closed.helpOpen).toBe(false);
    expect(focused.focusArea).toBe("workflow");
    expect(moved.selectedStage).toBe(1);
  });

  test("has a sane compact mode boundary", () => {
    expect(isCompactTerminal(71, 24)).toBe(true);
    expect(isCompactTerminal(72, 18)).toBe(false);
  });
});

describe("TUI launch eligibility", () => {
  test("only selects full-screen mode for a bare interactive TTY", () => {
    expect(shouldUseTui({ argv: [], stdinIsTTY: true, stdoutIsTTY: true })).toBe(true);
    expect(shouldUseTui({ argv: ["--help"], stdinIsTTY: true, stdoutIsTTY: true })).toBe(false);
    expect(shouldUseTui({ argv: [], stdinIsTTY: false, stdoutIsTTY: true })).toBe(false);
    expect(shouldUseTui({ argv: [], stdinIsTTY: true, stdoutIsTTY: false })).toBe(false);
  });
});
