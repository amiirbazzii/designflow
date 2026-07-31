// packages/agents/src/registry.ts
import { agentManifestSchema, workerAgentWorkflowMismatch } from "@designflow/sdk";
import type { Agent, AgentManifest, WorkerManifest } from "@designflow/sdk";
import { AgentNotFoundError, AgentWorkflowNotAllowedError, DuplicateAgentError } from "./errors";

/**
 * The agent catalogue.
 *
 * Registration and resolution only. Nothing here decides anything, calls an
 * agent or touches a workflow — that is `AgentRuntime`'s job, and keeping the
 * two apart is what lets a host inspect what is installed without the risk of
 * running it.
 *
 * Domain-agnostic in the same way the worker registry is: it knows about
 * agents, not about design, code or any particular workflow. It depends on
 * `@designflow/sdk` alone, and a test in this package fails if that changes.
 */
export class InMemoryAgentRegistry {
  private readonly agents = new Map<string, Agent>();

  public constructor(initial: readonly Agent[] = []) {
    for (const agent of initial) this.register(agent);
  }

  /**
   * Adds an agent, validating its manifest at the boundary.
   *
   * A duplicate id is refused rather than overwritten. Two agents answering to
   * one name means a worker's `agentId` resolves to whichever registered last
   * — an allow-list silently replaced by a different allow-list, which is the
   * one failure this layer exists to prevent.
   */
  public register(agent: Agent): void {
    const manifest = agentManifestSchema.parse(agent.manifest);

    if (this.agents.has(manifest.id)) {
      throw new DuplicateAgentError(manifest.id);
    }

    this.agents.set(manifest.id, agent);
  }

  public get(agentId: string): Agent | undefined {
    return this.agents.get(agentId);
  }

  /** Like `get`, but says what went wrong and what was available. */
  public require(agentId: string): Agent {
    const agent = this.get(agentId);

    if (agent === undefined) {
      throw new AgentNotFoundError(
        agentId,
        this.list().map((manifest) => manifest.id),
      );
    }

    return agent;
  }

  /**
   * The installed manifests, in registration order.
   *
   * Manifests rather than agents: listing is for showing what is installed,
   * and handing out the objects with `decide` on them would make the catalogue
   * a way to invoke one.
   */
  public list(): readonly AgentManifest[] {
    return [...this.agents.values()].map((agent) => agent.manifest);
  }
}

/**
 * Checks that an agent-backed worker promises only what its agent may deliver.
 *
 * Called when a catalogue is wired together, so a mismatch surfaces at startup
 * rather than on the first run that happens to hit the offending workflow. The
 * failure reuses `ERR_AGENT_WORKFLOW_NOT_ALLOWED` because it is the same
 * violation the runtime enforces per decision — caught earlier.
 */
export function assertWorkerAgentAlignment(
  worker: WorkerManifest,
  agent: AgentManifest,
): void {
  const mismatched = workerAgentWorkflowMismatch(worker, agent);
  const offender = mismatched[0];

  if (offender !== undefined) {
    throw new AgentWorkflowNotAllowedError(
      agent.id,
      offender,
      agent.allowedWorkflows,
    );
  }
}
