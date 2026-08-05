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
  type TraceEvent,
  type TraceObserver,
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
  /** Model mode is an explicit host decision; fail before perform when it is not wired. */
  readonly modelsRequired?: boolean | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly tracer?: TraceObserver | undefined;
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
  private readonly modelsRequired: boolean;
  private readonly tracer: TraceObserver | undefined;

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
    this.modelsRequired = options.modelsRequired ?? false;
    this.tracer = options.tracer;
  }

  public async invoke(
    request: AgentInvocationRequest,
    signal?: AbortSignal,
  ): Promise<AgentInvocationOutcome> {
    const validated = this.parseRequest(request);
    const agent = this.registry.require(validated.agentId);
    const { manifest } = agent;
    const traceId = crypto.randomUUID();
    const startedAt = Date.now();
    const traceMetadata = safeTraceMetadata({
      ...this.metadata,
      ...(validated.metadata ?? {}),
      invocationKind: "specialized-agent",
    });

    await this.emitTrace({
      type: "agent.invocation.started",
      traceId,
      workerId: "capability-invocation",
      agentId: manifest.id,
      timestamp: new Date(startedAt).toISOString(),
      ...(traceMetadata.executionId !== undefined
        ? { executionId: traceMetadata.executionId }
        : {}),
      ...(Object.keys(traceMetadata).length > 0 ? { metadata: traceMetadata } : {}),
    });

    const finish = async (outcome: AgentInvocationOutcome): Promise<AgentInvocationOutcome> => {
      const durationMs = Math.max(0, Date.now() - startedAt);
      await this.emitTrace(
        outcome.type === "success"
          ? {
              type: "agent.invocation.completed",
              traceId,
              durationMs,
              timestamp: new Date().toISOString(),
            }
          : {
              type: "agent.invocation.failed",
              traceId,
              errorCode: outcome.code,
              durationMs,
              timestamp: new Date().toISOString(),
            },
      );
      return outcome;
    };

    if (this.modelsRequired && this.models === undefined) {
      return finish(
        failureOutcome(
          manifest.id,
          "ERR_AGENT_MODEL_SERVICE_UNAVAILABLE",
          "No model service is configured for this specialized agent.",
          validated.attempt,
        ),
      );
    }

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

    if (this.modelsRequired && !modelAvailable) {
      return finish(
        failureOutcome(
          manifest.id,
          "ERR_MODEL_PROFILE_NOT_FOUND",
          "No model profile is configured for this specialized agent.",
          validated.attempt,
        ),
      );
    }

    const modelEvents: TraceEvent[] = [];

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
            onStart: ({ requestId, profileId }) => {
              modelEvents.push({
                type: "model.request.started",
                traceId,
                requestId,
                profileId,
                timestamp: new Date().toISOString(),
              });
            },
            onCall: (observed) => {
              if (observed.type === "success") {
                modelEvents.push({
                  type: "model.request.completed",
                  traceId,
                  requestId: observed.requestId,
                  profileId: observed.profileId,
                  providerId: observed.providerId,
                  model: observed.model,
                  durationMs: observed.durationMs,
                  ...(observed.usage !== undefined ? { usage: observed.usage } : {}),
                  timestamp: new Date().toISOString(),
                });
              } else {
                modelEvents.push({
                  type: "model.request.failed",
                  traceId,
                  requestId: observed.requestId,
                  profileId: observed.profileId,
                  errorCode: observed.code,
                  durationMs: observed.durationMs,
                  timestamp: new Date().toISOString(),
                });
              }
            },
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

      for (const event of modelEvents) await this.emitTrace(event);

      return finish(agentInvocationOutcomeSchema.parse({
        type: "success",
        agentId: manifest.id,
        agentVersion: manifest.version,
        ...(modelAvailable && manifest.modelProfileId !== undefined
          ? { modelProfileId: manifest.modelProfileId }
          : {}),
        output,
        attempt: validated.attempt,
      }));
    } catch (error) {
      for (const event of modelEvents) await this.emitTrace(event);
      const failure = failureFromError(manifest.id, error, validated.attempt);
      return finish(failure);
    }
  }

  private async emitTrace(event: TraceEvent): Promise<void> {
    try {
      await this.tracer?.onEvent(event);
    } catch {
      // Tracing is diagnostic and must never turn an agent result into a failure.
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

function failureOutcome(
  agentId: string,
  code: string,
  message: string,
  attempt: number,
): AgentInvocationOutcome {
  return agentInvocationOutcomeSchema.parse({
    type: "failure",
    agentId,
    code,
    message,
    attempt,
  });
}

function failureFromError(
  agentId: string,
  error: unknown,
  attempt: number,
): AgentInvocationOutcome {
  if (error instanceof DesignFlowError) {
    return failureOutcome(agentId, error.code, safeFailureMessage(error.message), attempt);
  }

  return failureOutcome(
    agentId,
    "ERR_AGENT_INVOCATION_FAILED",
    "The specialized agent failed before producing a usable result.",
    attempt,
  );
}

function safeFailureMessage(message: string): string {
  return message
    .replace(/Bearer\s+[^\s]+/gi, "[credential redacted]")
    .replace(/\b(?:sk-or-v1|figd_)[A-Za-z0-9_-]+/g, "[credential redacted]")
    .replace(/(?:\/Users\/|\/home\/|[A-Za-z]:\\)[^\s]+/g, "[path redacted]")
    .replace(/\s+/g, " ")
    .slice(0, 500);
}

function safeTraceMetadata(
  metadata: Readonly<Record<string, unknown>>,
): Record<string, string> {
  const allowed = new Set([
    "invocationKind",
    "executionId",
    "capabilityId",
    "nodeId",
    "workflowId",
    "iteration",
  ]);
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!allowed.has(key) || typeof value !== "string" || value.length === 0) continue;
    result[key] = value.slice(0, 160);
  }
  return result;
}

function describe(error: ZodError): readonly string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join(".");
    return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
  });
}
