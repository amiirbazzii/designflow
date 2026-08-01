// packages/sdk/src/tool.ts
import {
  z,
  type ZodType,
  type ZodTypeDef,
} from "zod";

import type { Logger } from "./context";

/**
 * A Tool is something an agent may consult *while deciding*.
 *
 * The distinction that matters, and the one this whole file exists to hold:
 *
 *   a Capability does work    — it is scheduled by the engine, appears in a
 *                               DAG, declares artifacts, and its output is
 *                               part of the result
 *   a Tool informs a decision — it is called by an agent, appears in no DAG,
 *                               produces no artifact, and its output is thrown
 *                               away once the decision is made
 *
 * Confusing the two would make tools a second, unaudited execution path. A
 * tool that "just writes a file while it's in there" is a capability wearing a
 * disguise, and it would produce output the engine never recorded, cannot
 * reuse, cannot reconcile and cannot explain.
 *
 * So tools are bounded on every side: they run only inside one `decide()`
 * call, only from an explicit per-agent allow-list, only with schema-validated
 * input, only for a bounded time, and their output is schema-validated before
 * an agent is allowed to see it. Everything a tool returns is untrusted until
 * it has been parsed.
 */

// ── Schema descriptors ──────────────────────────────────────────

/**
 * A serializable description of a tool's input or output shape.
 *
 * Deliberately *not* a serialized Zod schema. Zod instances hold closures and
 * refinements that do not survive JSON, so a manifest carrying one would be a
 * manifest that cannot be sent anywhere — which defeats the purpose of a
 * manifest. The executable schemas live on the `Tool` itself, where they are
 * used; this is the part that can be shown to a person, written to a catalogue
 * or, later, handed to a model deciding what to call.
 *
 * The two can disagree, and nothing here prevents that. A tool whose
 * descriptor lies is a documentation bug, not a safety hole: enforcement is
 * always the real schema on the `Tool`, never this.
 */
export const toolFieldDescriptorSchema = z
  .object({
    name: z.string().min(1),
    type: z.enum(["string", "number", "boolean", "string[]", "object", "unknown"]),
    required: z.boolean().default(false),
    description: z.string().optional(),
  })
  .strict();

export type ToolFieldDescriptor = z.infer<typeof toolFieldDescriptorSchema>;

export const toolSchemaDescriptorSchema = z
  .object({
    description: z.string().min(1),
    fields: z.array(toolFieldDescriptorSchema).default([]),
  })
  .strict();

export type ToolSchemaDescriptor = z.infer<typeof toolSchemaDescriptorSchema>;

// ── Manifest ────────────────────────────────────────────────────

/** How long a tool may run before the runtime stops waiting. */
export const DEFAULT_TOOL_TIMEOUT_MS = 5_000;

export const toolManifestSchema = z
  .object({
    /** Stable identifier. Referenced by `AgentManifest.allowedTools`. */
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    /** Explicit, for the same reason an agent's version is. */
    version: z.string().min(1),
    inputSchema: toolSchemaDescriptorSchema,
    outputSchema: toolSchemaDescriptorSchema,
    /**
     * Per-tool override of the runtime's default timeout.
     *
     * Bounded above as well as below: a tool declaring a ten-minute timeout
     * would hold a decision open long past the point a person is still
     * waiting, and the runtime is the wrong place to discover that.
     */
    timeoutMs: z.number().int().positive().max(60_000).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

export type ToolManifest = z.infer<typeof toolManifestSchema>;

// ── Calls and results ───────────────────────────────────────────

export const toolCallSchema = z
  .object({
    /**
     * Identifies one invocation.
     *
     * Carried through to the result and to every observation, so a failure in
     * a log can be tied to the call that caused it without correlating on
     * timestamps.
     */
    id: z.string().min(1),
    toolId: z.string().min(1),
    input: z.unknown(),
  })
  .strict();

export type ToolCall = z.infer<typeof toolCallSchema>;

/**
 * The outcome of one tool call.
 *
 * A discriminated union rather than "output plus optional error", so a caller
 * cannot read `output` without having established that the call succeeded.
 *
 * Strict on both members, and carrying no `stack`, no `cause` and no nested
 * error object — the same rule the agent decision follows. An infrastructure
 * error's own text is the most likely place for a path, a connection string or
 * a token to appear, so the runtime sanitises before it constructs one of
 * these, and the schema makes it impossible to smuggle the original alongside.
 */
export const toolResultSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("success"),
      callId: z.string().min(1),
      toolId: z.string().min(1),
      output: z.unknown(),
      durationMs: z.number().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal("failure"),
      callId: z.string().min(1),
      toolId: z.string().min(1),
      /** A stable `ERR_TOOL_*` code. Never matched on message text. */
      code: z.string().min(1),
      message: z.string().min(1),
      /**
       * Whether calling again could plausibly succeed.
       *
       * Advisory only — nothing in this stage retries. It is here so the
       * distinction is recorded at the point it is known, rather than
       * reconstructed later by matching on codes.
       */
      retryable: z.boolean(),
      durationMs: z.number().nonnegative(),
    })
    .strict(),
]);

export type ToolResult = z.infer<typeof toolResultSchema>;

// ── Runtime contracts ───────────────────────────────────────────

/**
 * What a tool is allowed to see while running.
 *
 * Narrower than `AgentContext`, and narrower on purpose: it has no `tools`
 * port. A tool that could call tools could recurse, and a bounded decision
 * would stop being bounded. It also has no runner, no repository, no artifact
 * store, no approval manager and no filesystem handle — a tool needing one
 * closes over its own, scoped at construction by whoever installed it, so the
 * grant is visible in the composition root rather than implicit in the
 * context.
 */
export interface ToolContext {
  readonly signal: AbortSignal;
  readonly logger: Logger;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface Tool<TInput = unknown, TOutput = unknown> {
  readonly manifest: ToolManifest;
  /**
   * Enforced on the way in. The manifest's descriptor is documentation.
   *
   * The third parameter is `unknown` rather than `TInput` so a schema using
   * `.default()` or `.transform()` still fits — those make what a parser
   * accepts differ from what it produces, and a tool whose input has an
   * optional field with a default is the ordinary case, not an exotic one.
   * Parsing is always from `unknown`; only the result is typed.
   */
  readonly inputSchema: ZodType<TInput, ZodTypeDef, unknown>;
  /** Enforced on the way out, because a tool's output is untrusted too. */
  readonly outputSchema: ZodType<TOutput, ZodTypeDef, unknown>;

  execute(input: TInput, context: ToolContext): Promise<TOutput>;
}

/**
 * What an agent is handed to call tools with.
 *
 * A service port, not a registry. An agent holding a `ToolRegistry` could
 * enumerate every installed tool and reach the executable objects on it,
 * making the permission check advisory. This exposes exactly one verb, and
 * every call through it is re-checked.
 */
export interface AgentToolService {
  call(call: ToolCall): Promise<ToolResult>;
}

/**
 * The port `AgentRuntime` uses to reach the tool layer.
 *
 * Exists so `@designflow/agents` can offer tools while depending on
 * `@designflow/sdk` alone — `ToolRuntime` lives in `@designflow/tools` and
 * implements this. `allowedTools` travels with every invocation rather than
 * being bound once, so the enforcing layer is told what is permitted on each
 * call and never has to trust a scope it was configured with earlier.
 */
export interface ToolInvocationRequest {
  readonly call: ToolCall;
  readonly allowedTools: readonly string[];
  readonly signal?: AbortSignal | undefined;
  /** For observation only. Never used to make a permission decision. */
  readonly agentId?: string | undefined;
  readonly workerId?: string | undefined;
}

export interface ToolInvoker {
  /** The ids of every installed tool, for narrowing an agent's view. */
  installedToolIds(): readonly string[];
  invoke(request: ToolInvocationRequest): Promise<ToolResult>;
}
