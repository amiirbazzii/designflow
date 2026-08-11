import type { DesignFlowSessionView, OutputView } from "./model";

export type TerminalOutcomeActionId = "view-report" | "view-details" | "outputs" | "back-to-start" | "quit";
export type TerminalOutcomeActionShortcut = "enter" | "tab" | "back" | "quit";
export type TerminalOutcomeKind =
  | "needs-attention"
  | "cancelled"
  | "completed";

export interface TerminalOutcomeAction {
  readonly id: TerminalOutcomeActionId;
  readonly label: string;
  readonly shortcut: TerminalOutcomeActionShortcut;
  /** Actions in the main outcome list are selected with Enter. */
  readonly menu: boolean;
}

export interface TerminalOutcomeView {
  readonly kind: TerminalOutcomeKind;
  readonly title: string;
  readonly message: string;
  readonly projectMutationStatus: "unchanged" | "applied" | "restored";
  readonly details: readonly string[];
  readonly actions: readonly TerminalOutcomeAction[];
}

export function terminalOutcomeActions(
  hasReport: boolean,
  hasDetails: boolean,
  hasOutputs = false,
): readonly TerminalOutcomeAction[] {
  return [
    ...(hasReport
      ? [{ id: "view-report" as const, label: "View report", shortcut: "enter" as const, menu: true }]
      : hasDetails
        ? [{ id: "view-details" as const, label: "View details", shortcut: "enter" as const, menu: true }]
        : []),
    ...(hasOutputs
      ? [{ id: "outputs" as const, label: "Outputs", shortcut: "tab" as const, menu: false }]
      : []),
    { id: "back-to-start", label: "Back to start", shortcut: "back" as const, menu: true },
    { id: "quit", label: "Quit", shortcut: "quit" as const, menu: true },
  ];
}

export function terminalOutcomeMenuActions(
  actions: readonly TerminalOutcomeAction[],
): readonly TerminalOutcomeAction[] {
  return actions.filter((action) => action.menu);
}

export function terminalOutcomeActionForShortcut(
  actions: readonly TerminalOutcomeAction[],
  shortcut: TerminalOutcomeActionShortcut,
): TerminalOutcomeAction | undefined {
  return actions.find((action) => action.shortcut === shortcut);
}

export function terminalOutcomeFromSession(
  session: DesignFlowSessionView,
  kind: TerminalOutcomeKind,
): TerminalOutcomeView {
  const hasReport = latestAvailableOutput(session.outputs) !== undefined;
  const hasDetails = session.diagnostics.length > 0;
  const message = session.diagnostics[0] ?? session.finalResult?.summary ?? "DesignFlow finished.";
  const failure = kind !== "completed";
  const projectMutationStatus = failure
    ? session.diagnostics.some((line) => /restored|rolled back/i.test(line))
      ? "restored"
      : "unchanged"
    : "applied";

  return {
    kind,
    title: kind === "completed" ? "Done" : kind === "cancelled" ? "Cancelled" : "Needs attention",
    message,
    projectMutationStatus,
    details: session.diagnostics.slice(0, 12),
    actions: terminalOutcomeActions(hasReport, hasDetails, session.outputs.length > 0),
  };
}

export function isTerminalSession(session: DesignFlowSessionView): boolean {
  return session.finalResult !== undefined || session.workflow.status === "unavailable";
}

export function latestAvailableOutput(outputs: readonly OutputView[]): OutputView | undefined {
  return [...outputs].reverse().find((output) => output.status === "available");
}

export function terminalOutcomeStatusHint(
  hasReport: boolean,
  hasDetails: boolean,
  hasOutputs: boolean,
): string {
  return terminalOutcomeStatusHintForActions(terminalOutcomeActions(hasReport, hasDetails, hasOutputs));
}

export function terminalOutcomeStatusHintForActions(
  actions: readonly TerminalOutcomeAction[],
): string {
  const first = terminalOutcomeMenuActions(actions)[0];
  const primary = first === undefined ? "" : `Enter ${first.label}   `;
  const outputs = terminalOutcomeActionForShortcut(actions, "tab") === undefined ? "" : "Tab Outputs   ";
  const back = terminalOutcomeActionForShortcut(actions, "back") === undefined ? "" : "Esc Back   ";
  const quit = terminalOutcomeActionForShortcut(actions, "quit") === undefined ? "" : "q Quit";
  return `${primary}${outputs}${quit}${back.length > 0 ? `   ${back.trim()}` : ""}`.trim();
}

export function visualResultStatusHint(
  hasReport: boolean,
  canImprove: boolean,
  hasOutputs: boolean,
): string {
  const report = hasReport ? "Enter View report   " : "";
  const improve = canImprove ? "i Improve   " : "";
  const outputs = hasOutputs ? "Tab Outputs   " : "";
  return `${report}${improve}${outputs}q Quit   Esc Back`;
}
