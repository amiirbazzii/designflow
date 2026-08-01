// apps/designflow-cli/src/commands/memory.ts
import { heading } from "../ui/terminal";
import type { Terminal } from "../ui/terminal";
import type { CliContext } from "../services/cli-runner";
import { DesignFlowError } from "@designflow/sdk";
import type { AgentMemory, MemoryProposal, MemoryScope } from "@designflow/sdk";

/**
 * `designflow memory`, `memory add`, `memory revoke`, `memory proposals`,
 * `memory approve` and `memory reject`.
 *
 * Durable memory is never written silently: a person authors it directly
 * with `memory add`, or approves something an agent proposed with `memory
 * approve`. Agent ids never appear in this file's output — a scope like
 * `project_agent` is shown as "for <agent name>", and an unresolvable agent
 * id is shown as "an agent no longer installed" rather than the id itself.
 */

const CLI_SCOPES = ["project", "project-agent", "agent"] as const;
type CliScope = (typeof CLI_SCOPES)[number];

function toMemoryScope(scope: CliScope): MemoryScope {
  return scope === "project-agent" ? "project_agent" : scope;
}

// ── List / revoke ───────────────────────────────────────────────

export interface MemoryListOptions {
  readonly projectId?: string;
  readonly agentName?: string;
}

export async function memoryCommand(
  context: CliContext,
  terminal: Terminal,
  options?: MemoryListOptions,
): Promise<number> {
  const agentId = resolveAgentId(context, options?.agentName);
  if (options?.agentName !== undefined && agentId === undefined) {
    return unknownAgent(terminal, context, options.agentName);
  }

  const memories = await context.memory.listMemory({
    status: "active",
    ...(options?.projectId !== undefined ? { projectId: options.projectId } : {}),
    ...(agentId !== undefined ? { agentId } : {}),
  });

  terminal.print(heading("Memory"));

  if (memories.length === 0) {
    terminal.print("Nothing remembered yet.");
    terminal.print();
    terminal.print("Add something with  designflow memory add");
    return 0;
  }

  for (const memory of memories) {
    terminal.print();
    printMemory(terminal, context, memory);
  }

  terminal.print();
  return 0;
}

export interface MemoryAddOptions {
  readonly scope?: CliScope;
  readonly projectId?: string;
  readonly agentName?: string;
  readonly key?: string;
  readonly value?: string;
}

export async function memoryAddCommand(
  context: CliContext,
  terminal: Terminal,
  options: MemoryAddOptions,
): Promise<number> {
  if (options.scope === undefined || !CLI_SCOPES.includes(options.scope)) {
    terminal.print("Which scope? One of: project, project-agent, agent. For example:");
    terminal.print();
    terminal.print(
      '  designflow memory add --scope agent --agent "<agent name>" --key prefer.existingComponents --value true',
    );
    terminal.print();
    terminal.print("Run  designflow list  to see the names an agent is addressed by.");
    return 1;
  }

  if (options.key === undefined || options.value === undefined) {
    terminal.print("A memory needs both --key and --value.");
    return 1;
  }

  const scope = toMemoryScope(options.scope);
  const agentId = resolveAgentId(context, options.agentName);

  if (options.agentName !== undefined && agentId === undefined) {
    return unknownAgent(terminal, context, options.agentName);
  }

  if ((scope === "agent" || scope === "project_agent") && agentId === undefined) {
    terminal.print("That scope needs  --agent \"<name>\" .");
    return 1;
  }

  if ((scope === "project" || scope === "project_agent") && options.projectId === undefined) {
    terminal.print("That scope needs  --project <project-id> .");
    return 1;
  }

  try {
    const memory = await context.memory.addMemory({
      scope,
      ...(agentId !== undefined ? { agentId } : {}),
      ...(options.projectId !== undefined ? { projectId: options.projectId } : {}),
      key: options.key,
      value: parseValue(options.value),
      source: "user_approved",
    });

    terminal.print(heading("Remembered"));
    printMemory(terminal, context, memory);
    return 0;
  } catch (error) {
    return reportMemoryError(terminal, error);
  }
}

export async function memoryRevokeCommand(
  context: CliContext,
  terminal: Terminal,
  memoryId: string,
): Promise<number> {
  try {
    await context.memory.revokeMemory(memoryId);
    terminal.print(`Revoked ${memoryId}.`);
    return 0;
  } catch (error) {
    return reportMemoryError(terminal, error, memoryId);
  }
}

// ── Proposals ───────────────────────────────────────────────────

export async function memoryProposalsCommand(
  context: CliContext,
  terminal: Terminal,
  options?: { readonly status?: MemoryProposal["status"] },
): Promise<number> {
  const proposals = await context.memoryProposals.listProposals(
    options?.status !== undefined ? { status: options.status } : { status: "pending" },
  );

  terminal.print(heading("Memory proposals"));

  if (proposals.length === 0) {
    terminal.print("Nothing waiting on you right now.");
    terminal.print();
    return 0;
  }

  for (const proposal of proposals) {
    terminal.print();
    printProposal(terminal, context, proposal);
  }

  terminal.print();
  return 0;
}

export async function memoryApproveCommand(
  context: CliContext,
  terminal: Terminal,
  proposalId: string,
): Promise<number> {
  try {
    const memory = await context.memoryProposals.approve(proposalId, "user");
    terminal.print(heading("Approved"));
    printMemory(terminal, context, memory);
    return 0;
  } catch (error) {
    return reportProposalError(terminal, proposalId, error);
  }
}

export async function memoryRejectCommand(
  context: CliContext,
  terminal: Terminal,
  proposalId: string,
): Promise<number> {
  try {
    await context.memoryProposals.reject(proposalId, "user");
    terminal.print(`Rejected ${proposalId}. Nothing was remembered.`);
    return 0;
  } catch (error) {
    return reportProposalError(terminal, proposalId, error);
  }
}

// ── Rendering ───────────────────────────────────────────────────

function printMemory(terminal: Terminal, context: CliContext, memory: AgentMemory): void {
  terminal.print(`  ${memory.key}: ${renderValue(memory.value)}`);
  terminal.print(`    Scope: ${describeScope(context, memory.scope, memory.agentId, memory.projectId)}`);
  terminal.print(`    Memory: ${memory.id}`);
}

function printProposal(terminal: Terminal, context: CliContext, proposal: MemoryProposal): void {
  const agentName = agentNameOf(context, proposal.proposedByAgentId);
  terminal.print(`  ${agentName} suggests remembering:`);
  terminal.print(`    "${proposal.rationaleSummary}"`);
  terminal.print(
    `    Scope: ${describeScope(context, proposal.scope, proposal.proposedByAgentId, proposal.projectId)}`,
  );
  terminal.print(`    Proposal: ${proposal.id}`);
}

function describeScope(
  context: CliContext,
  scope: MemoryScope,
  agentId: string | undefined,
  projectId: string | undefined,
): string {
  const agentName = agentId !== undefined ? agentNameOf(context, agentId) : undefined;

  if (scope === "agent") return `${agentName ?? "an agent"}, everywhere`;
  if (scope === "project") return `this project${projectId !== undefined ? ` (${projectId})` : ""}`;
  return `${agentName ?? "an agent"}, this project${projectId !== undefined ? ` (${projectId})` : ""}`;
}

function agentNameOf(context: CliContext, agentId: string): string {
  return context.agentDirectory.find((entry) => entry.id === agentId)?.name ?? "an agent no longer installed";
}

function resolveAgentId(context: CliContext, agentName: string | undefined): string | undefined {
  if (agentName === undefined) return undefined;
  return context.agentDirectory.find(
    (entry) => entry.name.toLowerCase() === agentName.toLowerCase(),
  )?.id;
}

function unknownAgent(terminal: Terminal, context: CliContext, agentName: string): number {
  terminal.print(`No agent named "${agentName}".`);
  if (context.agentDirectory.length > 0) {
    terminal.print(`Try one of: ${context.agentDirectory.map((entry) => entry.name).join(", ")}`);
  }
  return 1;
}

function renderValue(value: unknown): string {
  return Array.isArray(value) ? value.join(", ") : String(value);
}

/** `true`/`false`/a number parse as themselves; everything else stays a string. */
function parseValue(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw.trim().length > 0 && !Number.isNaN(Number(raw))) return Number(raw);
  return raw;
}

function reportMemoryError(terminal: Terminal, error: unknown, memoryId?: string): number {
  if (error instanceof DesignFlowError && error.code === "ERR_MEMORY_NOT_FOUND") {
    terminal.print(`No memory with that id: ${memoryId ?? ""}`);
    terminal.print();
    terminal.print("Run  designflow memory  to see what is remembered.");
    return 1;
  }

  throw error;
}

function reportProposalError(terminal: Terminal, proposalId: string, error: unknown): number {
  if (error instanceof DesignFlowError && error.code === "ERR_MEMORY_PROPOSAL_NOT_FOUND") {
    terminal.print(`No proposal with that id: ${proposalId}`);
    terminal.print();
    terminal.print("Run  designflow memory proposals  to see what is waiting.");
    return 1;
  }

  if (error instanceof DesignFlowError && error.code === "ERR_MEMORY_PROPOSAL_STATE_INVALID") {
    terminal.print("That proposal was already resolved.");
    return 1;
  }

  if (error instanceof DesignFlowError && error.code === "ERR_MEMORY_PROPOSAL_EXPIRED") {
    terminal.print("That proposal has expired.");
    return 1;
  }

  throw error;
}
