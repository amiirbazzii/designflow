// apps/designflow-cli/src/commands/traces.ts
import {
  displayProviderName,
  formatWhen,
  heading,
  type Terminal,
} from "../ui/terminal";

import { describeCapability } from "../services/presentation";
import type { CliContext } from "../services/cli-runner";
import type { AgentTrace, WorkerManifest } from "@designflow/sdk";

/**
 * `designflow traces` — what happened during past AI decisions.
 *
 * The command that makes agent behaviour inspectable, and the one place where
 * being careful about *what is not shown* matters more than presentation. A
 * trace records who decided, when, how long it took, what was decided and which
 * tools were consulted. It does not record the request, the reasoning, the tool
 * inputs or the tool outputs — and this file could not print them if it wanted
 * to, because the trace it reads has no field holding them.
 *
 * Everything comes from `context.traces`, the product read API. A command that
 * held a `TraceStore` could write the record it displays, and a record its own
 * reader can edit is not an audit record.
 */
export async function tracesCommand(
  context: CliContext,
  terminal: Terminal,
  options?: { readonly traceId?: string },
): Promise<number> {
  const workers = context.workers.listWorkers();

  if (options?.traceId !== undefined) {
    const trace = await context.traces.getTrace(options.traceId);

    if (trace === null) {
      terminal.print(heading("Trace"));
      terminal.print(`No trace with that id: ${options.traceId}`);
      terminal.print();
      terminal.print("Run  designflow traces  to see the ones that do exist.");
      return 1;
    }

    terminal.print(heading("Trace"));
    printDetail(terminal, trace, workers);
    return 0;
  }

  // Most recent first, and bounded: a trace list is for "what did I just do?",
  // not for scrolling a year of history.
  const traces = await context.traces.listTraces({ limit: 20 });

  terminal.print(heading("AI decisions"));

  if (traces.length === 0) {
    terminal.print("No AI decisions have been made yet.");
    terminal.print();
    terminal.print("Run a worker, then come back — every run records one.");
    return 0;
  }

  for (const trace of traces) {
    terminal.print();
    printDetail(terminal, trace, workers);
  }

  terminal.print();
  return 0;
}

/**
 * One trace, in the vocabulary a person already has.
 *
 * Worker and agent by *name* where one is known, because "Design Engineer"
 * means something to the reader and `design-engineer-agent` does not. The id is
 * still shown, because it is what they would type to look at this one again.
 */
function printDetail(
  terminal: Terminal,
  trace: AgentTrace,
  workers: readonly WorkerManifest[],
): void {
  const worker = workers.find((candidate) => candidate.id === trace.workerId);

  terminal.print(`  ${worker?.name ?? trace.workerId}`);
  terminal.print(
    `    ${describeOutcome(trace)}  ·  ${formatWhen(Date.parse(trace.startedAt))}` +
      (trace.durationMs !== undefined ? `  ·  ${formatDuration(trace.durationMs)}` : ""),
  );

  terminal.print(`    Tools consulted: ${trace.toolCalls.length}`);
  terminal.print(`    Model calls: ${trace.modelCalls.length}`);

  if (trace.metadata?.["invocationKind"] === "specialized-agent") {
    const capabilityId = trace.metadata["capabilityId"];

    // The role, not the agent id — and only for the capabilities that really
    // invoke one. A deterministic step reads as the stage it is.
    if (typeof capabilityId === "string") {
      const producer = describeCapability(capabilityId, capabilityId);
      terminal.print(
        producer.kind === "role"
          ? `    Role: ${producer.label}`
          : `    Step: ${producer.label}`,
      );
    }

    if (trace.errorCode !== undefined) terminal.print(`    Error code: ${trace.errorCode}`);
  }

  printModelUsage(terminal, trace);

  if (trace.executionId !== undefined) {
    terminal.print(`    Run: ${trace.executionId}`);
  }

  terminal.print(`    ${trace.id}`);
}

/**
 * The model calls a trace recorded, and only what it recorded.
 *
 * A deterministic decision has no model calls and prints no model lines. Token
 * counts appear only when the provider reported them — an unreported usage
 * must not render as `0`, which would read as "this call cost nothing".
 */
function printModelUsage(terminal: Terminal, trace: AgentTrace): void {
  for (const call of trace.modelCalls) {
    const provider =
      call.providerId !== undefined ? displayProviderName(call.providerId) : undefined;

    terminal.print(
      `    Model: ${[provider, call.model].filter((part) => part !== undefined).join(" ") || "not recorded"}` +
        `  ·  profile ${call.profileId}  ·  ${call.status}`,
    );

    const usage = call.usage;
    if (usage === undefined) continue;

    const reported: string[] = [];
    if (usage.inputTokens !== undefined) reported.push(`${usage.inputTokens} in`);
    if (usage.outputTokens !== undefined) reported.push(`${usage.outputTokens} out`);
    if (usage.totalTokens !== undefined) reported.push(`${usage.totalTokens} total`);

    if (reported.length > 0) terminal.print(`      Tokens: ${reported.join(", ")}`);
    if (usage.cost !== undefined) terminal.print(`      Cost: ${usage.cost}`);
  }
}

/**
 * What the decision came to, said plainly.
 *
 * Never the workflow id: a person hires a Design Engineer and should not have
 * to learn that it runs a `design-to-code` pipeline, which has been true since
 * the worker catalogue and stays true here.
 */
function describeOutcome(trace: AgentTrace): string {
  if (trace.status === "running") return "still deciding";

  if (trace.status === "failed") {
    // The code is not shown. It names internal machinery, and "stopped" is the
    // part that matters to whoever is reading.
    return "stopped before starting";
  }

  switch (trace.decisionType) {
    case "run_workflow":
      return "started the work";
    case "request_clarification":
      return "asked for more detail";
    case "decline":
      return "declined";
    default:
      return "completed";
  }
}

/** Coarse on purpose — nobody reads "3187 ms". */
function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`;

  const seconds = durationMs / 1000;
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
}
