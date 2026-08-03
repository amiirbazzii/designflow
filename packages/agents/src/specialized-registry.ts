// packages/agents/src/specialized-registry.ts
import {
  agentManifestSchema,
  type AgentManifest,
  type SpecializedAgent,
} from "@designflow/sdk";

import { AgentNotFoundError, DuplicateAgentError } from "./errors";

/**
 * The catalogue of specialized agents — the Figma Specification, Implementation
 * and Visual Validation agents invoked by workflow nodes.
 *
 * Deliberately a separate registry from `InMemoryAgentRegistry`, even though
 * both enforce the identical discipline (parse the manifest, reject a
 * duplicate id, never hand out anything an id-space collision could
 * silently replace). The two hold different shapes: a coordinator's `Agent`
 * answers `decide()` with one of three routing outcomes, a specialized
 * agent's `perform()` answers with whatever typed artifact it was built to
 * produce. Sharing one generic registry across both shapes would mean every
 * caller has to narrow which kind of agent it got back before it can call
 * anything on it; two registries mean a caller already knows.
 */
export class InMemorySpecializedAgentRegistry {
  private readonly agents = new Map<string, SpecializedAgent>();

  public constructor(initial: readonly SpecializedAgent[] = []) {
    for (const agent of initial) this.register(agent);
  }

  public register(agent: SpecializedAgent): void {
    const manifest = agentManifestSchema.parse(agent.manifest);

    if (this.agents.has(manifest.id)) {
      throw new DuplicateAgentError(manifest.id);
    }

    this.agents.set(manifest.id, {
      manifest,
      perform: (request, context) => agent.perform(request, context),
    });
  }

  public get(agentId: string): SpecializedAgent | undefined {
    return this.agents.get(agentId);
  }

  public require(agentId: string): SpecializedAgent {
    const agent = this.get(agentId);

    if (agent === undefined) {
      throw new AgentNotFoundError(
        agentId,
        this.list().map((manifest) => manifest.id),
      );
    }

    return agent;
  }

  /** The installed manifests, in registration order. Never the `perform` callback. */
  public list(): readonly AgentManifest[] {
    return [...this.agents.values()].map((agent) => agent.manifest);
  }
}
