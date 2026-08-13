// packages/agents/src/catalog/design-engineer-coordinator.ts
import {
  agentManifestSchema,
  modelProfileSchema,
  type Agent,
  type AgentManifest,
  type ModelProfile,
} from "@designflow/sdk";

import {
  deterministicDesignEngineerStrategy,
  FIGMA_SPECIFICATION_WORKFLOW_ID,
  type DesignEngineerStrategy,
} from "./design-engineer-agent";

/**
 * The Design Engineer Coordinator.
 *
 * Stage 2 introduces three specialized agents behind the Design Engineer
 * worker — Figma Specification, Implementation, Visual Validation — but the
 * worker's public entry point stays exactly what it always was: one
 * `agentId`, resolving to one routing decision-maker. This is that decision
 * maker's new home.
 *
 * `design-engineer-agent` (the manifest `design-engineer-agent.ts` still
 * exports) is retained unchanged, registered alongside this one under its
 * own, different id, as a compatibility alias — see the ADR for the full
 * reasoning. Both share the exact same decision logic: renaming would have
 * meant either breaking any stored session that recorded the old agent id in
 * its task/context, or writing a migration for state this codebase has
 * always treated as append-only and safe to keep reading forever. Adding a
 * new id and keeping the old one costs one extra registration; renaming
 * would have cost a migration path for something no other Stage in this
 * codebase has needed to migrate yet.
 *
 * The coordinator itself still only ever chooses among `run_workflow`,
 * `request_clarification` and `decline` — the same three outcomes
 * `agent.ts`'s module doc describes. It does not invoke the Figma
 * Specification, Implementation or Visual Validation agents directly; those
 * are invoked by `design-to-code-agent-foundation`'s own workflow nodes,
 * through `AgentInvocationRuntime`, never through this class.
 */

const MODEL_PROFILE_ID = "design-engineer-coordinator-default";

export const designEngineerCoordinatorManifest: AgentManifest = agentManifestSchema.parse({
  id: "design-engineer-coordinator",
  name: "Design Engineer Coordinator",
  description: "Decides how a Design Engineer request should be carried out",
  version: "0.1.0",
  instructions:
    "You coordinate the Design Engineer. Understand what the user wants from a " +
    "Figma design: choose create_specification to document or analyze it; choose " +
    "prepare_implementation only when they want code changes prepared for their " +
    "selected project; ask one clarifying question when the goal is unclear; " +
    "decline work that is not about a design.",
  allowedWorkflows: ["design-to-code", "design-to-code-implementation", FIGMA_SPECIFICATION_WORKFLOW_ID],
  allowedTools: ["classify-design-task"],
  modelProfileId: MODEL_PROFILE_ID,
  metadata: { author: "DesignFlow" },
});

/**
 * The coordinator's own, independently configurable model profile.
 *
 * A distinct id from `design-engineer-default` (the retained alias's
 * profile) even though both currently resolve to the same provider and model
 * slug — Part 4 of Stage 2 is explicit that no two agents share one profile,
 * so a config override aimed at the coordinator can never accidentally also
 * change what the retained alias uses, and vice versa.
 */
export const designEngineerCoordinatorDefaultModelProfile: ModelProfile = modelProfileSchema.parse({
  id: MODEL_PROFILE_ID,
  providerId: "openrouter",
  model: "openai/gpt-4o-mini",
});

class DesignEngineerCoordinator implements Agent {
  public readonly manifest: AgentManifest;
  private readonly strategy: DesignEngineerStrategy;

  public constructor(manifest: AgentManifest, strategy: DesignEngineerStrategy) {
    this.manifest = manifest;
    this.strategy = strategy;
  }

  public decide: Agent["decide"] = (task, context) => {
    return this.strategy(task, context, this.manifest);
  };
}

export function createDesignEngineerCoordinator(
  strategy: DesignEngineerStrategy = deterministicDesignEngineerStrategy,
): Agent {
  return new DesignEngineerCoordinator(designEngineerCoordinatorManifest, strategy);
}

export const designEngineerCoordinator: Agent = createDesignEngineerCoordinator();
