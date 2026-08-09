import { describe, expect, test } from "bun:test";
import type { CliContext } from "../services/cli-runner";
import { ScriptedTerminal } from "../ui/terminal";
import { renderProgress, watchProgress } from "./session-flow";

type Progress = Parameters<Parameters<CliContext["onProgress"]>[0]>[0];

function progressContext(listeners: Array<(progress: Progress) => void>): CliContext {
  return {
    onProgress(listener) {
      listeners.push(listener);
    },
  } as unknown as CliContext;
}

describe("interactive Design Engineer progress", () => {
  test("renders product stages from the existing progress callback", () => {
    const listeners: Array<(progress: Progress) => void> = [];
    const terminal = new ScriptedTerminal();

    watchProgress(progressContext(listeners), terminal, { productExperience: true });
    listeners[0]?.({
      completed: 2,
      total: 6,
      percent: 33,
      steps: [
        { capabilityId: "parse-figma-source", label: "Parse Figma source", status: "done" },
        { capabilityId: "inspect-registered-project", label: "Inspect project", status: "done" },
        { capabilityId: "invoke-implementation-agent", label: "Invoke agent", status: "active" },
        { label: "Pending step", status: "pending" },
      ],
    });

    expect(terminal.transcript).toContain("Understanding");
    expect(terminal.transcript).toContain("✓ Design loaded");
    expect(terminal.transcript).toContain("→ Preparing implementation");
    expect(terminal.transcript).not.toContain("Pending step");
    expect(terminal.transcript).not.toContain("Invoke agent");
  });

  test("keeps the technical renderer for explicit command callers", () => {
    const listeners: Array<(progress: Progress) => void> = [];
    const terminal = new ScriptedTerminal();

    watchProgress(progressContext(listeners), terminal);
    listeners[0]?.({
      completed: 1,
      total: 1,
      percent: 100,
      steps: [
        { capabilityId: "run-project-validation", label: "Run validation", status: "done" },
      ],
    });

    expect(terminal.transcript).toContain("✓ Running the project's own checks");
    expect(terminal.transcript).toContain("1 of 1 steps");
    expect(terminal.transcript).not.toContain("Checking");
  });

  test("does not duplicate an unchanged product frame", () => {
    const listeners: Array<(progress: Progress) => void> = [];
    const terminal = new ScriptedTerminal();

    watchProgress(progressContext(listeners), terminal, { productExperience: true });
    const frame = {
      completed: 0,
      total: 3,
      percent: 0,
      steps: [{ label: "Pending step", status: "pending" }],
    };
    listeners[0]?.(frame);
    listeners[0]?.(frame);

    expect(terminal.output).toEqual(["Preparing Design Engineer..."]);
  });
});

describe("technical progress renderer", () => {
  test("continues to render the existing explicit progress shape", () => {
    expect(
      renderProgress({
        completed: 2,
        total: 3,
        steps: [{ label: "A step", status: "done" }],
      }),
    ).toContain("2 of 3 steps");
  });
});
