import { describe, expect, it } from "bun:test";
import { PassThrough } from "node:stream";
import {
  initialFreshUiState,
  readyFreshUiState,
  transitionFreshUi,
} from "./fresh-ui";
import {
  designFromCurrentSelection,
  designFromUrl,
} from "../../services/figma-selection";
import { freshCommand } from "../../commands/interactive";
import type { CliContext } from "../../services/cli-runner";
import { ScriptedTerminal } from "../../ui/terminal";
import { buildFreshUiViewFromContext } from "./model";
import { runTuiShell } from "./run";

function freshInputStream(): PassThrough & NodeJS.ReadStream {
  const input = new PassThrough() as PassThrough & NodeJS.ReadStream;
  Object.assign(input, { isTTY: true, setRawMode: () => input, ref: () => input, unref: () => input });
  return input;
}

function freshOutputStream(): PassThrough & NodeJS.WriteStream {
  const output = new PassThrough() as PassThrough & NodeJS.WriteStream;
  Object.assign(output, { isTTY: true, columns: 120, rows: 30 });
  return output;
}

describe("Fresh UI source readiness", () => {
  it("starts in selecting and reaches ready-to-generate for one current selection", () => {
    const selection = designFromCurrentSelection({ id: "12:34", name: "Landing", type: "FRAME" });
    const state = transitionFreshUi(initialFreshUiState(), selection);

    expect(state.status).toBe("ready-to-generate");
    if (state.status !== "ready-to-generate") return;
    expect(state.nodeId).toBe("12:34");
    expect(state.source.nodeIds).toEqual(["12:34"]);
  });

  it("normalizes dash-form node IDs from a pasted frame URL", () => {
    const state = readyFreshUiState(
      designFromUrl("https://www.figma.com/design/file-key/Home?node-id=101-202&t=private"),
    );

    expect(state.status).toBe("ready-to-generate");
    if (state.status !== "ready-to-generate") return;
    expect(state.nodeId).toBe("101:202");
    expect(state.source.normalizedUrl).toBe(
      "https://www.figma.com/design/file-key?node-id=101-202",
    );
  });

  it("rejects a missing node ID", () => {
    expect(() => readyFreshUiState(
      designFromUrl("https://www.figma.com/design/file-key/Home"),
    )).toThrow("exactly one Figma frame node ID");
  });

  it("rejects an invalid host/source", () => {
    expect(() => readyFreshUiState(
      designFromUrl("https://example.com/design/file-key?node-id=1-2"),
    )).toThrow("Invalid Figma source");
  });

  it("rejects more than one node ID", () => {
    expect(() => readyFreshUiState(
      designFromUrl("https://www.figma.com/design/file-key/Home?node-id=1-2,3-4"),
    )).toThrow("exactly one Figma frame node ID");
  });

  it("is deterministic for the same normalized source", () => {
    const design = designFromUrl("https://www.figma.com/file/file-key/Home?node-id=1-2");
    expect(readyFreshUiState(design)).toEqual(readyFreshUiState(design));
  });

  it("keeps the non-TTY Fresh command at source readiness without project/session calls", async () => {
    const calls: string[] = [];
    const context = {
      figmaConnectionStatus: () => "unavailable",
      ensureFigmaConnection: async () => {
        calls.push("ensure-figma");
        return "unavailable";
      },
      getCurrentFigmaSelection: async () => {
        calls.push("current-selection");
        return null;
      },
    } as unknown as CliContext;
    const terminal = new ScriptedTerminal([
      "2",
      "https://www.figma.com/design/file-key/Home?node-id=1-2",
    ]);

    await expect(freshCommand(context, terminal)).resolves.toBe(0);
    expect(calls).toEqual([]);
    expect(terminal.transcript).toContain("Ready to generate: 1:2");
  });

  it("bounds repeated non-interactive source failures", async () => {
    const context = {
      figmaConnectionStatus: () => "unavailable",
      ensureFigmaConnection: async () => "unavailable",
      getCurrentFigmaSelection: async () => null,
    } as unknown as CliContext;
    const terminal = new ScriptedTerminal(["2", "invalid", "", ""]);

    await expect(freshCommand(context, terminal)).resolves.toBe(1);
    expect(terminal.transcript).toContain("Fresh UI stopped after three invalid or unavailable source attempts.");
  });

  it("builds Fresh presentation facts without detecting a project or refreshing AI", () => {
    const calls: string[] = [];
    const context = {
      figmaConnectionStatus: () => {
        calls.push("figma-status");
        return "not-configured";
      },
      refreshAiSession: async () => calls.push("refresh-ai"),
    } as unknown as CliContext;

    const view = buildFreshUiViewFromContext(context);
    expect(view.project.status).toBe("not-detected");
    expect(view.ai.status).toBe("not-configured");
    expect(calls).toEqual(["figma-status"]);
  });

  it("composes Fresh TUI without constructing the legacy project runtime", async () => {
    const context = {
      figmaConnectionStatus: () => "not-configured",
      aiStatus: () => "not-configured",
      signInWithGoogle: async () => "not-configured",
    } as unknown as CliContext;
    const input = freshInputStream();
    const shell = runTuiShell(
      context,
      { input, output: freshOutputStream() },
      () => undefined,
      async () => 0,
      undefined,
      { mode: "fresh" },
    );

    input.write("q");
    await expect(shell).resolves.toEqual({ type: "quit" });
  });
});
