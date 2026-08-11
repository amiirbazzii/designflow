import { describe, expect, test } from "bun:test";
import type { Key } from "ink";
import {
  buildSessionView,
  setApprovalMode,
  setActiveStage,
  setDesignSelection,
  setDestinationSelection,
} from "./model";
import { isBackspaceInput, isCompactTerminal, isEndInput, isForwardDeleteInput, isHomeInput, mapTuiKey, reduceTuiInteraction } from "./keys";
import { designFlowTheme, statusColor } from "./theme";
import { shouldUseTui } from "./eligibility";
import { stageMarker, visibleUrlWindow } from "./components";
import { renderVisibleUrlWindow, stripBracketedPasteMarkers, urlInputBoxWidth, urlInputContentWidth } from "./url-window";
import {
  backspaceUrlText,
  deleteUrlText,
  enterDesignSelection,
  enterDestinationSelection,
  enterUrlEntry,
  enterApprovalMode,
  setApprovalOption,
  initialNavigationState,
  keepSelectionVisible,
  moveListSelection,
  moveUrlCursor,
  moveUrlCursorEnd,
  moveUrlCursorHome,
  navigateBack,
  openOutput,
  setOutputScrollOffset,
  setDestinationCandidates,
  updateUrlText,
  openProposalReview,
  openDiffView,
  closeDiffView,
  setDiffScrollOffset,
  moveReviewAction,
  moveReviewFile,
} from "./navigation";
import {
  backspaceText,
  createTextEditor,
  deleteForwardText,
  ensureTextCursorVisible,
  insertText,
  moveTextCursor,
  moveTextCursorEnd,
  moveTextCursorHome,
} from "./text-input";
import { buildProposalReview } from "../../services/proposal-review";
import { designFromUrl } from "../../services/figma-selection";

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

  test("maps selected design and destination into the stable session view", () => {
    const session = buildSessionView({ figma: "connected", ai: "connected" });
    const design = { kind: "url" as const, label: "Pasted Figma design" };
    const destination = { label: "/dashboard", kind: "page" as const, path: "/dashboard" };
    const selected = setDestinationSelection(setDesignSelection(session, design), destination);

    expect(selected.design).toEqual({ kind: "url", label: "Pasted Figma design", status: "ready" });
    expect(selected.destination).toEqual({ label: "/dashboard", value: "/dashboard", kind: "page", status: "ready" });
    expect(session.design.status).toBe("idle");
    expect(session.destination.status).toBe("idle");
  });
});

describe("DesignFlow TUI selection navigation", () => {
  test("approval mode defaults to manual and is selected before ready-to-run", () => {
    const session = buildSessionView({ figma: "connected", ai: "connected" });
    const approval = enterApprovalMode(initialNavigationState());

    expect(session.approval.mode).toBe("manual");
    expect(approval.view).toBe("approval-mode");
    expect(approval.approvalOption).toBe(0);
    const managed = setApprovalOption(approval, 1);
    expect(managed.approvalMode).toBe("designflow");
    expect(setApprovalMode(session, managed.approvalMode).approval.mode).toBe("designflow");
  });

  test("Start enters design selection and Esc follows the back hierarchy", () => {
    const start = initialNavigationState();
    const design = enterDesignSelection(start);
    const url = enterUrlEntry(design);
    const destination = enterDestinationSelection(url, {
      kind: "url",
      label: "Pasted Figma design",
      designFile: "https://www.figma.com/design/abc/Home",
      frames: [],
    });

    expect(design.view).toBe("design-selection");
    expect(navigateBack(url).view).toBe("design-selection");
    expect(navigateBack(destination).view).toBe("design-selection");
    expect(navigateBack({ ...destination, view: "ready-to-run" }).view).toBe("approval-mode");
    expect(navigateBack({ ...destination, view: "approval-mode" }).view).toBe("destination-selection");
    expect(navigateBack(design).view).toBe("start");
  });

  test("URL entry supports paste-like text, cursor movement, and backspace", () => {
    let state = enterUrlEntry(initialNavigationState());
    state = updateUrlText(state, "https://www.figma.com/design/abc/Home?q");
    expect(state.urlValue.endsWith("?q")).toBe(true);
    expect(state.urlCursor).toBe(state.urlValue.length);
    state = moveUrlCursor(state, -1);
    state = moveUrlCursor(state, 1);
    state = backspaceUrlText(state);
    expect(state.urlValue.endsWith("?q")).toBe(false);
    expect(updateUrlText(state, "q").urlValue.endsWith("?q")).toBe(true);
    expect(visibleUrlWindow(state.urlValue, state.urlCursor, 12).cursorChar).toBeDefined();
  });

  test("keeps the real Phase 6B Figma URL on one horizontal rendered line", () => {
    const value = "https://www.figma.com/design/E958ARSSBoJjblLhxZQVSU/Spendly?node-id=1026-6098";
    for (const columns of [80, 100, 120, 160]) {
      const width = urlInputContentWidth(columns, false);
      const rendered = renderVisibleUrlWindow(visibleUrlWindow(value, value.length, width));
      expect(rendered).not.toContain("\n");
      expect([...rendered].length).toBeLessThanOrEqual(width);
      expect(rendered).toContain("QVSU/Spendly?node-id=1026-6098");
      expect(urlInputBoxWidth(columns, false)).toBe(width + 4);
    }
  });

  test("keeps the cursor visible and adjusts the URL viewport while moving", () => {
    const value = "https://www.figma.com/design/E958ARSSBoJjblLhxZQVSU/Spendly?node-id=1026-6098";
    const width = urlInputContentWidth(80, false);
    const atStart = renderVisibleUrlWindow(visibleUrlWindow(value, 0, width));
    const atEnd = renderVisibleUrlWindow(visibleUrlWindow(value, value.length, width));
    expect(atStart).toContain("https://");
    expect(atEnd).toContain("node-id=1026-6098");
    expect(atEnd).not.toContain("https://www.figma.com");
  });

  test("strips bracketed-paste framing without changing the URL value", () => {
    const value = "https://www.figma.com/design/E958ARSSBoJjblLhxZQVSU/Spendly?node-id=1026-6098";
    expect(stripBracketedPasteMarkers(`\u001b[200~${value}\u001b[201~`)).toBe(value);
    expect(designFromUrl(value).designFile).toBe(value);
  });

  test("keeps compact URL input on one line at narrow widths", () => {
    const value = "https://www.figma.com/design/E958ARSSBoJjblLhxZQVSU/Spendly?node-id=1026-6098";
    for (const columns of [40, 55, 71]) {
      const width = urlInputContentWidth(columns, true);
      const rendered = renderVisibleUrlWindow(visibleUrlWindow(value, value.length, width));
      expect(rendered).not.toContain("\n");
      expect([...rendered].length).toBeLessThanOrEqual(width);
    }
  });

  test("shared text editing removes repeated characters and clamps boundaries", () => {
    let editor = createTextEditor();
    editor = insertText(editor, "abcdef");
    for (const expected of ["abcde", "abcd", "abc", "ab", "a", ""]) {
      editor = backspaceText(editor);
      expect(editor.value).toBe(expected);
    }
    expect(backspaceText(editor)).toEqual(editor);
    editor = insertText(editor, "abc");
    editor = moveTextCursorHome(editor);
    editor = moveTextCursor(editor, 1);
    editor = deleteForwardText(editor);
    expect(editor.value).toBe("ac");
    editor = moveTextCursorEnd(editor);
    expect(deleteForwardText(editor)).toEqual(editor);
  });

  test("normalizes Ink's Backspace and forward-Delete key representations", () => {
    const backspace = key({ delete: true });
    expect(isBackspaceInput("", backspace, "\u007f")).toBe(true);
    expect(isBackspaceInput("", key({ backspace: true }), "\b")).toBe(true);
    expect(isForwardDeleteInput("", backspace, "\u001b[3~")).toBe(true);
    expect(isForwardDeleteInput("", backspace, "\u007f")).toBe(false);
    expect(isHomeInput("", "\u001b[H")).toBe(true);
    expect(isEndInput("", "\u001b[F")).toBe(true);
  });

  test("URL editing uses the shared contract for middle and long-value deletion", () => {
    let state = updateUrlText(enterUrlEntry(initialNavigationState()), "abcdef");
    state = moveUrlCursorHome(state);
    state = moveUrlCursor(state, 1);
    state = deleteUrlText(state);
    expect(state.urlValue).toBe("acdef");
    state = moveUrlCursorEnd(state);
    for (const expected of ["acde", "acd", "ac", "a", ""]) {
      state = backspaceUrlText(state);
      expect(state.urlValue).toBe(expected);
    }
    expect(state.urlCursor).toBe(0);
    expect(backspaceUrlText(state).urlValue).toBe("");
  });

  test("cursor viewport stays valid after editing and resize widths", () => {
    let editor = insertText(createTextEditor(), "https://www.figma.com/design/E958ARSSBoJjblLhxZQVSU/Spendly?node-id=1026-6098");
    editor = ensureTextCursorVisible(editor, 12);
    expect(editor.viewportStart).toBeGreaterThan(0);
    editor = moveTextCursorHome(editor);
    editor = ensureTextCursorVisible(editor, 80);
    expect(editor.viewportStart).toBe(0);
    editor = moveTextCursorEnd(editor);
    editor = ensureTextCursorVisible(editor, 40);
    expect(editor.cursorIndex).toBe(editor.value.length);
  });

  test("destination selection uses discovered candidates and keeps the active row visible", () => {
    const design = {
      kind: "current-selection" as const,
      label: "Current Figma selection — Home",
      designFile: "figma://selection/1",
      frames: ["Home"],
    };
    const candidates = Array.from({ length: 12 }, (_, index) => ({
      label: `/route-${index}`,
      kind: "page" as const,
      path: `/route-${index}`,
    }));
    let state = setDestinationCandidates(enterDestinationSelection(initialNavigationState(), design), candidates);
    state = {
      ...state,
      destinationIndex: moveListSelection(state.destinationIndex, candidates.length, 1),
    };
    const offset = keepSelectionVisible(10, state.destinationScrollOffset, 4);

    expect(state.destinationCandidates).toEqual(candidates);
    expect(offset).toBe(7);
    expect(moveListSelection(0, candidates.length, -1)).toBe(0);
    expect(moveListSelection(11, candidates.length, 1)).toBe(11);
  });

  test("q is ordinary URL text while selection shortcuts remain available elsewhere", () => {
    const url = updateUrlText(enterUrlEntry(initialNavigationState()), "q");
    expect(url.urlValue).toBe("q");
    expect(mapTuiKey("q", key())).toBe("quit");
  });

  test("empty destination results remain an inline UI error", () => {
    const state = setDestinationCandidates(
      enterDestinationSelection(initialNavigationState(), {
        kind: "url",
        label: "Pasted Figma design",
        designFile: "https://www.figma.com/design/abc/Home",
        frames: [],
      }),
      [],
    );

    expect(state.error).toBe("No destination suggestions available.");
    expect(state.loading).toBeNull();
  });
});

describe("DesignFlow TUI theme and keyboard contract", () => {
  test("keeps proposal review and canonical diff navigation inside the TUI", () => {
    const request = {
      executionId: "run-1",
      workflowId: "design-to-code",
      reason: "review",
      review: buildProposalReview([
        { path: "src/App.tsx", action: "modify", currentContent: "old\n", proposedContent: "new\n" },
      ]),
      checks: [{ label: "Scope" }],
    };
    const opened = openProposalReview(initialNavigationState(), request);
    expect(opened.view).toBe("proposal-review");
    expect(openDiffView(opened).view).toBe("diff-view");
    expect(moveReviewAction(opened, 1).reviewActionIndex).toBe(1);
    expect(moveReviewFile(openDiffView(opened), 1).reviewFileIndex).toBe(0);
    expect(setDiffScrollOffset(openDiffView(opened), 100, 2).diffScrollOffset).toBe(2);
    expect(closeDiffView(openDiffView(opened)).view).toBe("proposal-review");
    expect(navigateBack(opened).view).toBe("execution");
  });

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
    const initial = { helpOpen: false, focusArea: "main" as const, selectedStage: 0, selectedOutput: 0 };
    const open = reduceTuiInteraction(initial, "help", 7);
    const closed = reduceTuiInteraction(open, "back", 7);
    const focused = reduceTuiInteraction(closed, "next-focus", 7);
    const moved = reduceTuiInteraction(focused, "down", 7);

    expect(open.helpOpen).toBe(true);
    expect(closed.helpOpen).toBe(false);
    expect(focused.focusArea).toBe("workflow");
    expect(moved.selectedStage).toBe(1);
  });

  test("cycles workflow, outputs, and main focus and clamps viewer scroll", () => {
    const initial = { helpOpen: false, focusArea: "workflow" as const, selectedStage: 0, selectedOutput: 0 };
    const outputs = reduceTuiInteraction(initial, "next-focus", 7);
    const main = reduceTuiInteraction(outputs, "next-focus", 7);
    expect(outputs.focusArea).toBe("outputs");
    expect(main.focusArea).toBe("main");

    const opened = openOutput(initialNavigationState(), "specification-artifact");
    expect(opened.view).toBe("output-viewer");
    expect(setOutputScrollOffset(opened, 99, 4).outputScrollOffset).toBe(4);
    expect(setOutputScrollOffset(opened, -1, 4).outputScrollOffset).toBe(0);
    expect(navigateBack(opened).view).toBe("start");
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
