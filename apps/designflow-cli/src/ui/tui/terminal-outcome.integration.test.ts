import { PassThrough } from "node:stream";
import { runTuiShellWithView } from "./run";
import { buildSessionView } from "./model";
import type { TuiExecutionBridge } from "./execution";
import { headerStatus } from "./components";
import {
  terminalOutcomeActionForShortcut,
  terminalOutcomeFromSession,
  terminalOutcomeMenuActions,
} from "./outcome";

function inputStream(): PassThrough & NodeJS.ReadStream {
  const input = new PassThrough() as PassThrough & NodeJS.ReadStream;
  Object.assign(input, {
    isTTY: true,
    setRawMode: () => input,
    ref: () => input,
    unref: () => input,
  });
  return input;
}

function outputStream(): PassThrough & NodeJS.WriteStream {
  const output = new PassThrough() as PassThrough & NodeJS.WriteStream;
  Object.assign(output, { isTTY: true, columns: 120, rows: 30 });
  return output;
}

function waitForRender(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 45));
}

const fixtureDesign = {
  kind: "figma-url" as const,
  label: "Fixture design",
  designFile: "fixture-file",
  frames: ["1:2"],
};

const fixtureDestination = {
  kind: "page" as const,
  label: "/add",
  path: "/add",
  sourcePath: "src/app/add/page.tsx",
  source: "fixture",
};

describe("terminal outcome Ink orchestration", () => {
  test("design-source retrieval failure enters the shared interactive outcome and supports details, back, and quit", async () => {
    const input = inputStream();
    const output = outputStream();
    let rendered = "";
    output.on("data", (chunk) => { rendered += String(chunk); });
    let startCalled = 0;
    let selectedApprovalMode: string | undefined;

    const shell = runTuiShellWithView(
      buildSessionView({ project: { name: "Fixture" }, figma: "connected", ai: "connected" }),
      { input, output },
      () => undefined,
      {
        getCurrentDesign: async () => fixtureDesign,
        parseFigmaUrl: () => fixtureDesign,
        getDestinations: async () => [fixtureDestination],
      },
      "fixture-project",
      async (action, bridge) => {
        startCalled += 1;
        selectedApprovalMode = action.approvalMode;
        setTimeout(() => bridge.result({
          session: { status: "failed", executionId: "fixture-run", originalInput: {} },
          message: "Could not finish retrieving the design source.",
        } as Parameters<TuiExecutionBridge["result"]>[0]), 10);
        return 1;
      },
    );

    const send = async (value: string): Promise<void> => {
      input.write(value);
      await waitForRender();
    };

    // Start → current selection → destination → manual approval → run.
    await send("\r");
    await send("\r");
    await send("\r");
    await send("\r");
    await send("\r");

    // The actual failure view must accept its advertised primary action.
    await send("\r");
    expect(rendered).toContain("Details");

    // Details returns through the same terminal outcome state.
    await send("\u001b");
    await send("q");
    await expect(Promise.race([shell, waitForRender().then(() => "timeout" as const)])).resolves.toEqual({ type: "quit" });
    expect(startCalled).toBe(1);
    expect(selectedApprovalMode).toBe("manual");
    expect(rendered).toContain("Needs attention");
  });

  test("terminal outcomes derive status and handlers from one action model", () => {
    const session = buildSessionView({ project: { name: "Fixture" }, figma: "connected", ai: "connected" });
    const failed = {
      ...session,
      workflow: { ...session.workflow, status: "unavailable" as const },
      diagnostics: ["Could not finish retrieving the design source."],
      finalResult: { status: "failure" as const, summary: "Could not finish retrieving the design source." },
    };
    const outcome = terminalOutcomeFromSession(failed, "needs-attention");
    const menu = terminalOutcomeMenuActions(outcome.actions);

    expect(headerStatus(failed, false, outcome)).toBe("Needs attention");
    expect(headerStatus(session, false)).toBe("Ready");
    expect(menu.map((action) => action.label)).toEqual(["View details", "Back to start", "Quit"]);
    expect(terminalOutcomeActionForShortcut(outcome.actions, "enter")?.id).toBe("view-details");
    expect(terminalOutcomeActionForShortcut(outcome.actions, "back")?.id).toBe("back-to-start");
    expect(terminalOutcomeActionForShortcut(outcome.actions, "quit")?.id).toBe("quit");
  });
});
