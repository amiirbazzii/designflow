import { describe, expect, test } from "bun:test";
import { designEngineer } from "@designflow/workers";
import type { CliContext, ResolvedWorker } from "../services/cli-runner";
import { designFromCurrentSelection, type InteractiveDesign } from "../services/figma-selection";
import { menu, ScriptedTerminal } from "../ui/terminal";
import { collectInput } from "./run";
import { interactiveRunOptions, selectDesign, signInInteractive } from "./interactive";

function shellContext(options: {
  readonly status: "connected" | "unavailable" | "not-configured";
  readonly selection?: { readonly id: string; readonly name: string; readonly type: string } | null;
}): CliContext {
  return {
    figmaConnectionStatus: () => options.status,
    getCurrentFigmaSelection: async () => options.selection ?? null,
  } as unknown as CliContext;
}

const resolved: ResolvedWorker = {
  worker: designEngineer,
  workflowId: "design-to-code-figma-specification",
  workflowInstalled: true,
  steps: 1,
};

describe("interactive design selection", () => {
  test("connected current selection uses the existing Desktop identity", async () => {
    const terminal = new ScriptedTerminal([""]);
    const design = await selectDesign(shellContext({
      status: "connected",
      selection: { id: "10:1", name: "Expense Form", type: "FRAME" },
    }), terminal);

    expect(design).toMatchObject({
      kind: "current-selection",
      label: "Current Figma selection — Expense Form",
      frames: ["Expense Form"],
    });
    expect(design?.designFile).toContain("node-id=10-1");
    expect(terminal.transcript).toContain("Current Figma selection");
  });

  test("missing selection recovers to a valid pasted URL", async () => {
    const terminal = new ScriptedTerminal(["", "2", "https://www.figma.com/design/abc123/Expenses?node-id=10-1"]);
    const design = await selectDesign(shellContext({ status: "connected" }), terminal);

    expect(design).toMatchObject({ kind: "url", designFile: expect.stringContaining("abc123") });
    expect(terminal.transcript).toContain("No Figma selection found.");
  });

  test("invalid URLs are bounded and do not produce a design", async () => {
    const terminal = new ScriptedTerminal(["2", "not a figma url", "back"]);

    await expect(selectDesign(shellContext({ status: "connected" }), terminal)).resolves.toBeNull();
    expect(terminal.transcript).toContain("That is not a valid Figma URL. Try again.");
  });

  test("disconnected Figma still permits the URL fallback", async () => {
    const terminal = new ScriptedTerminal(["2", "https://www.figma.com/file/abc123/Expenses"]);
    const design = await selectDesign(shellContext({ status: "unavailable" }), terminal);

    expect(design?.kind).toBe("url");
  });

  test("shell-selected design and destination are carried without approval flags", () => {
    const design: InteractiveDesign = designFromCurrentSelection({
      id: "10:1",
      name: "Expense Form",
      type: "FRAME",
    });
    const destination = { label: "/expenses", kind: "page" as const, path: "/expenses" };

    expect(interactiveRunOptions({
      id: "project-1",
      name: "Spendly",
      rootPath: "/tmp/spendly",
      createdAt: "2026-08-10T00:00:00.000Z",
      updatedAt: "2026-08-10T00:00:00.000Z",
    }, destination, design)).toMatchObject({
      projectId: "project-1",
      destination,
      design,
    });
    expect(interactiveRunOptions(null, destination, design)).not.toHaveProperty("approval");
    expect(interactiveRunOptions(null, destination, design)).not.toHaveProperty("projectWriteConsent");
    const rendered = menu(
      { name: "Spendly", rootPath: "/tmp/spendly" },
      { status: "connected", design: design.label, destination: destination.label },
    );
    expect(rendered).toContain("Current Figma selection — Expense Form");
    expect(rendered).toContain("Destination\n  /expenses");
  });

  test("prefilled design inputs skip only the questions already answered by the shell", async () => {
    const terminal = new ScriptedTerminal(["prepare the implementation"]);
    const design = designFromCurrentSelection({ id: "10:1", name: "Expense Form", type: "FRAME" });

    const input = await collectInput(terminal, resolved, design);

    expect(input).toMatchObject({ designFile: design.designFile, frames: ["Expense Form"] });
    expect(input.request).toBe("prepare the implementation");
    expect(terminal.questions).toEqual(["What would you like from this design? (Create an engineering specification. Do not modify the project.)"]);
  });

  test("Google sign-in updates the product session without rendering credentials", async () => {
    const calls: string[] = [];
    const terminal = new ScriptedTerminal();
    const context = {
      signInWithGoogle: async (onBrowserFallback: (url: string) => void) => {
        calls.push("google");
        onBrowserFallback("https://project.supabase.co/auth/v1/authorize?provider=google");
        return "connected";
      },
    } as unknown as CliContext;

    await expect(signInInteractive(context, terminal)).resolves.toBe(true);
    expect(calls).toEqual(["google"]);
    expect(terminal.transcript).toContain("Opening Google sign-in in your browser...");
    expect(terminal.transcript).toContain("Open this sign-in link:");
    expect(terminal.transcript).toContain("✓ Signed in");
    expect(terminal.transcript).not.toContain("access-token");
  });
});
