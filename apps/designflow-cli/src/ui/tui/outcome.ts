import type { OutputView } from "./model";

export type TerminalOutcomeActionId = "view-report" | "view-details" | "back-to-start" | "quit";

export interface TerminalOutcomeAction {
  readonly id: TerminalOutcomeActionId;
  readonly label: string;
}

export function terminalOutcomeActions(
  hasReport: boolean,
  hasDetails: boolean,
): readonly TerminalOutcomeAction[] {
  return [
    ...(hasReport
      ? [{ id: "view-report" as const, label: "View report" }]
      : hasDetails
        ? [{ id: "view-details" as const, label: "View details" }]
        : []),
    { id: "back-to-start", label: "Back to start" },
    { id: "quit", label: "Quit" },
  ];
}

export function latestAvailableOutput(outputs: readonly OutputView[]): OutputView | undefined {
  return [...outputs].reverse().find((output) => output.status === "available");
}

export function terminalOutcomeStatusHint(
  hasReport: boolean,
  hasDetails: boolean,
  hasOutputs: boolean,
): string {
  const first = terminalOutcomeActions(hasReport, hasDetails)[0];
  const primary = first === undefined ? "" : `Enter ${first.label}   `;
  const outputs = hasOutputs ? "Tab Outputs   " : "";
  return `${primary}${outputs}q Quit   Esc Back`;
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
