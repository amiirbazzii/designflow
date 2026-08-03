// packages/agents/src/invocation-runtime.ts
import {
  agentInvocationRequestSchema,
  agentInvocationOutcomeSchema,
  DesignFlowError,
  type AgentInvocationOutcome,
  type AgentInvocationRequest,
  type AgentInvocationService,
  type Logger,
  type ModelInvoker,
  type SpecializedAgentContext,
  type ToolInvoker,
} from "@designflow/sdk";

import type { ZodError } from "zod";
import type { InMemorySpecializedAgentRegistry } from "./specialized-registry";
import { AgentInvocationRequestInvalidError } from "./errors";
import {
  AgentScopedToolService,
  DEFAULT_MAX_TOOL_CALLS_PER_DECISION,
  EMPTY_TOOL_SERVICE,
} from "./tool-service";
import {
  AgentScopedModelService,
  DEFAULT_MAX_MODEL_CALLS_PER_DECISION,
  EMPTY_MODEL_SERVICE,
} from "./model-service";

/**
 * The boundary a specialized-agent invocation has to cross — the same nine
 * steps `AgentRuntime.decide` crosses for the coordinator, applied to
 * `perform` instead of `decide`: validate the request, resolve the agent,
 * narrow its tools and model to what is both permitted and installed, build a
 * bounded context, run its strategy, and turn whatever comes back — a value
 * or a thrown error — into a validated `AgentInvocationOutcome`.
 *
 * What this deliberately does **not** do: decide whether to invoke this agent
 * at all (a workflow node's capability decides that, by calling `invoke` or
 * not), retry a failure, or let the agent reach another agent — there is no
 * field on `SpecializedAgentContext` for that, so it is not merely forbidden
 * here, it is unrepresentable.
 */

const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

export interface AgentInvocationRuntimeOptions {
  readonly registry: InMemorySpecializedAgentRegistry;
  readonly tools?: ToolInvoker | undefined;
  readonly maxToolCallsPerInvocation?: number | undefined;
  readonly models?: ModelInvoker | undefined;
  readonly maxModelCallsPerInvocation?: number | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly logger?: Logger | undefined;
}

export class AgentInvocationRuntime implements AgentInvocationService {
  private readonly registry: InMemorySpecializedAgentRegistry;
  private readonly metadata: Readonly<Record<string, unknown>>;
  private readonly logger: Logger;
  private readonly tools: ToolInvoker | undefined;
  private readonly maxToolCalls: number;
  private readonly models: ModelInvoker | undefined;
  private readonly maxModelCalls: number;

  public constructor(options: AgentInvocationRuntimeOptions) {
    this.registry = options.registry;
    this.metadata = Object.freeze({ ...options.metadata });
    this.logger = options.logger ?? silentLogger;
    this.tools = options.tools;
    this.maxToolCalls =
      options.maxToolCallsPerInvocation ?? DEFAULT_MAX_TOOL_CALLS_PER_DECISION;
    this.models = options.models;
    this.maxModelCalls =
      options.maxModelCallsPerInvocation ?? DEFAULT_MAX_MODEL_CALLS_PER_DECISION;
  }

  public async invoke(
    request: AgentInvocationRequest,
    signal?: AbortSignal,
  ): Promise<AgentInvocationOutcome> {
    const validated = this.parseRequest(request);
    const agent = this.registry.require(validated.agentId);
    const { manifest } = agent;

    const installedTools = this.tools?.installedToolIds() ?? [];
    const availableTools = manifest.allowedTools.filter((toolId) =>
      installedTools.includes(toolId),
    );

    const toolService =
      this.tools === undefined || availableTools.length === 0
        ? EMPTY_TOOL_SERVICE
        : new AgentScopedToolService({
            invoker: this.tools,
            allowedTools: availableTools,
            maxCalls: this.maxToolCalls,
            agentId: manifest.id,
            workerId: "capability-invocation",
            ...(signal !== undefined ? { signal } : {}),
          });

    const installedProfiles = this.models?.installedProfileIds() ?? [];
    const modelAvailable =
      manifest.modelProfileId !== undefined &&
      installedProfiles.includes(manifest.modelProfileId);

    const modelService =
      !modelAvailable || manifest.modelProfileId === undefined
        ? EMPTY_MODEL_SERVICE
        : new AgentScopedModelService({
            invoker: this.models as ModelInvoker,
            profileId: manifest.modelProfileId,
            maxCalls: this.maxModelCalls,
            agentId: manifest.id,
            workerId: "capability-invocation",
            ...(signal !== undefined ? { signal } : {}),
          });

    const context: SpecializedAgentContext = {
      tools: toolService,
      model: modelService,
      metadata: this.metadata,
      signal: signal ?? new AbortController().signal,
      logger: this.logger,
    };

    try {
      const output = await agent.perform(validated, context);

      return agentInvocationOutcomeSchema.parse({
        type: "success",
        agentId: manifest.id,
        agentVersion: manifest.version,
        ...(modelAvailable && manifest.modelProfileId !== undefined
          ? { modelProfileId: manifest.modelProfileId }
          : {}),
        output,
        attempt: validated.attempt,
      });
    } catch (error) {
      return agentInvocationOutcomeSchema.parse({
        type: "failure",
        agentId: manifest.id,
        code: error instanceof DesignFlowError ? error.code : "ERR_AGENT_INVOCATION_FAILED",
        message: "The agent could not produce a usable result.",
        attempt: validated.attempt,
      });
    }
  }

  private parseRequest(request: AgentInvocationRequest): AgentInvocationRequest {
    const result = agentInvocationRequestSchema.safeParse(request);

    if (!result.success) {
      throw new AgentInvocationRequestInvalidError(describe(result.error));
    }

    return result.data;
  }
}

function describe(error: ZodError): readonly string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join(".");
    return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
  });
}
