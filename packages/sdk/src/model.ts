// packages/sdk/src/model.ts
import { z } from "zod";
import type { Logger } from "./context";

/**
 * A Model is an LLM an agent may consult while deciding.
 *
 * The same relationship a Tool has to a decision, one layer more powerful and
 * therefore bounded more tightly. A tool returns a fact; a model returns a
 * *candidate decision* — so everything downstream of a model call still has to
 * treat the answer as untrusted input, exactly the way a tool's output is
 * treated. Structured-output guarantees from a provider are not a substitute
 * for that: they describe what the provider *tried* to produce, not what it
 * is safe to act on.
 *
 * Provider-neutral by construction. Nothing in this file, or in
 * `@designflow/models`, mentions OpenRouter — that lives one layer down, in
 * `@designflow/model-provider-openrouter`, which is the only package allowed
 * to know an HTTP endpoint exists. Swapping providers means writing a new
 * package that implements `ModelProvider`; it does not mean touching an
 * agent, a workflow, a tool or this file.
 */

// ── Messages ────────────────────────────────────────────────────

/**
 * Only the roles a bounded decision actually needs.
 *
 * No `function` or `developer` role, and no provider-specific extension
 * point — those exist to support multi-turn tool-calling conversations, and
 * this system does not hand a model a live tool loop. `tool` is kept for the
 * one case that matters: showing the model what a tool it consulted already
 * found, as context rather than as something to call itself.
 */
export const modelMessageRoleSchema = z.enum(["system", "user", "assistant", "tool"]);

export type ModelMessageRole = z.infer<typeof modelMessageRoleSchema>;

export const modelMessageSchema = z
  .object({
    role: modelMessageRoleSchema,
    content: z.string(),
  })
  .strict();

export type ModelMessage = z.infer<typeof modelMessageSchema>;

/**
 * A JSON Schema object, carried opaquely.
 *
 * DesignFlow does not implement a JSON Schema validator. This is the shape a
 * provider is asked to constrain its output to, and the caller validates the
 * *actual* output independently with Zod once it comes back — see
 * `AgentModelService`. Treating this as `Record<string, unknown>` rather than
 * building a typed JSON Schema AST is deliberate: the schema only ever
 * travels outward to a provider, and DesignFlow never interprets it itself.
 */
export const jsonSchemaObjectSchema = z.record(z.string(), z.unknown());

export type JsonSchemaObject = z.infer<typeof jsonSchemaObjectSchema>;

// ── Model profile ───────────────────────────────────────────────

/** Bounds shared by every duration field in this file. */
const MAX_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_TOKENS = 32_000;

/**
 * OpenRouter-shaped routing controls, carried structurally rather than as an
 * opaque bag.
 *
 * Not every provider will use every field — a future direct-Anthropic
 * provider may ignore `order` entirely — but typing it beats a
 * `Record<string, unknown>` escape hatch: a profile author gets validation
 * and autocomplete instead of a string key they have to get right by memory.
 * A provider that does not understand a field simply does not read it.
 */
export const modelProviderRoutingSchema = z
  .object({
    /** Upstream providers to try, in order, when the gateway supports it. */
    order: z.array(z.string().min(1)).optional(),
    allowFallbacks: z.boolean().optional(),
    /** Whether the gateway may use this request to improve its own models. */
    dataCollection: z.enum(["allow", "deny"]).optional(),
  })
  .strict();

export type ModelProviderRouting = z.infer<typeof modelProviderRoutingSchema>;

/**
 * What an agent's model is, and how it may be called.
 *
 * Strict for the same reason `agentManifestSchema` is: a profile is the
 * boundary between "an agent may use an LLM" and "an agent may use *this*
 * LLM, at *this* cost, for *this* long" — a typo that landed in an unread key
 * would widen that without anyone noticing.
 *
 * **No API key lives here, structurally.** There is no field to put one in,
 * so a profile can be written to `config.json`, shown in `designflow
 * settings`, handed to a future evaluation harness, or committed to a
 * worker package, and none of those actions can leak a credential — because
 * the credential was never reachable from a profile in the first place. Every
 * provider resolves its own credential from its own environment.
 */
export const modelProfileSchema = z
  .object({
    /** Stable identifier. Referenced by `AgentManifest.modelProfileId`. */
    id: z.string().min(1),
    /** Which registered `ModelProvider` this profile calls. */
    providerId: z.string().min(1),
    /**
     * An opaque, provider-specific model slug.
     *
     * DesignFlow does not validate this against a list of "known good"
     * models — that list changes weekly and belongs to the provider, not to
     * this codebase. A slug that does not exist fails at call time with
     * `ERR_MODEL_UNAVAILABLE`, the same way an unknown tool id fails.
     */
    model: z.string().min(1),
    /** Bounded so a runaway value cannot be silently accepted from config. */
    temperature: z.number().min(0).max(2).optional(),
    maxOutputTokens: z.number().int().positive().max(MAX_OUTPUT_TOKENS).optional(),
    /**
     * Overrides the runtime's default timeout for calls under this profile.
     *
     * Bounded above, for the same reason a tool's declared timeout is: a
     * profile asking for a ten-minute wait would hold a decision open long
     * past the point a person is still waiting, and the runtime — not the
     * profile author's good judgement — is what has to enforce that.
     */
    timeoutMs: z.number().int().positive().max(MAX_TIMEOUT_MS).optional(),
    /**
     * Additional model slugs a provider may fall back to.
     *
     * Opt-in and explicit. A model choosing its own fallback would be a
     * silent retry with a different model — exactly what "no autonomous
     * retry loops" forbids — so this is a list a human wrote, not a
     * provider default the runtime discovers and applies on its own.
     */
    fallbackModels: z
      .array(z.string().min(1))
      .default([])
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "fallbackModels must not repeat a model id",
      }),
    providerRouting: modelProviderRoutingSchema.optional(),
    /**
     * Host-supplied facts about the profile, not policy.
     *
     * The one open field, and — like every other `metadata` in this
     * codebase — the one place a careless caller could put something that
     * should have been a real field instead. It is never read for anything
     * security-relevant: `providerId`, `model`, `timeoutMs` and the routing
     * fields above are the only inputs `ModelRuntime` ever consults, and a
     * test asserts that a `metadata.providerId` set to something else changes
     * nothing about which provider actually gets called.
     */
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

export type ModelProfile = z.infer<typeof modelProfileSchema>;

// ── Usage ───────────────────────────────────────────────────────

/**
 * What a provider reported about the call, when it reported anything.
 *
 * Every field optional because providers disagree about what they return —
 * some omit cost, some omit token counts entirely for certain models. Absence
 * here means "not reported," never "zero."
 */
export const modelUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    totalTokens: z.number().int().nonnegative().optional(),
    cost: z.number().nonnegative().optional(),
  })
  .strict();

export type ModelUsage = z.infer<typeof modelUsageSchema>;

// ── Request and response ────────────────────────────────────────

/**
 * What `ModelRuntime` sends to a `ModelProvider`.
 *
 * Assembled by the runtime from a resolved `ModelProfile` and the caller's
 * messages — never handed to an agent to construct directly, which is why it
 * carries `requestId` and the resolved `model` slug rather than trusting a
 * caller to supply either. No field for a credential: a provider resolves its
 * own from its own environment, never from a request.
 */
export const modelRequestSchema = z
  .object({
    requestId: z.string().min(1),
    profileId: z.string().min(1),
    model: z.string().min(1),
    messages: z.array(modelMessageSchema).min(1),
    responseSchema: jsonSchemaObjectSchema,
    temperature: z.number().min(0).max(2).optional(),
    maxOutputTokens: z.number().int().positive().max(MAX_OUTPUT_TOKENS).optional(),
    /**
     * Routing and fallback policy, copied verbatim from the resolved
     * profile — never from a caller's per-call input.
     *
     * Kept as a distinct, typed field rather than folded into `metadata` so a
     * provider can read it without guessing a key name, and so it is visible
     * in the schema that this is policy, not a log annotation.
     */
    fallbackModels: z.array(z.string().min(1)).default([]),
    providerRouting: modelProviderRoutingSchema.optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

export type ModelRequest = z.infer<typeof modelRequestSchema>;

/**
 * What a `ModelProvider` returns, normalised.
 *
 * `output` stays `unknown` even here — this is the *envelope*, proof that the
 * provider answered in a shape DesignFlow recognises. Whether the content of
 * `output` satisfies whatever the caller actually asked for is a second,
 * independent check the caller makes with its own Zod schema. Conflating the
 * two would mean trusting the provider's structured-output guarantee alone,
 * which the architecture explicitly refuses to do.
 */
export const modelResponseSchema = z
  .object({
    requestId: z.string().min(1),
    providerId: z.string().min(1),
    model: z.string().min(1),
    output: z.unknown(),
    usage: modelUsageSchema.optional(),
    durationMs: z.number().nonnegative(),
    providerRequestId: z.string().min(1).optional(),
  })
  .strict();

export type ModelResponse = z.infer<typeof modelResponseSchema>;

/**
 * The outcome of one model call, as `ModelRuntime` hands it back.
 *
 * A discriminated union, strict on both members, carrying no `stack`, no
 * `cause` and no raw provider response — the same rule `ToolResult` and
 * `AgentDecision` follow. A provider's own error text is the single most
 * likely place for a request id, an internal hostname or a fragment of the
 * prompt to leak, so the runtime sanitises before constructing one of these.
 */
/** One candidate's sanitized outcome inside an ordered model policy. */
export const modelCandidateAttemptSchema = z
  .object({
    model: z.string().min(1),
    code: z.string().min(1),
    /** Elapsed time for that candidate alone, when the runtime measured it. */
    durationMs: z.number().nonnegative().optional(),
  })
  .strict();

export type ModelCandidateAttempt = z.infer<typeof modelCandidateAttemptSchema>;

/** Which candidate of an ordered model policy produced a successful result. */
export const modelCandidateSelectionSchema = z
  .object({
    model: z.string().min(1),
    /** 0 = primary; >0 = fallback position in the configured list. */
    candidateIndex: z.number().int().nonnegative(),
    candidateCount: z.number().int().positive(),
    previousFailures: z.array(modelCandidateAttemptSchema).max(8).default([]),
  })
  .strict();

export type ModelCandidateSelection = z.infer<typeof modelCandidateSelectionSchema>;

export const modelResultSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("success"),
      requestId: z.string().min(1),
      providerId: z.string().min(1),
      model: z.string().min(1),
      output: z.unknown(),
      usage: modelUsageSchema.optional(),
      durationMs: z.number().nonnegative(),
      /**
       * Which configured candidate actually produced this result, when the
       * profile declares an ordered model policy. Absent for single-model
       * profiles, whose results are byte-identical to the pre-policy shape.
       */
      selection: modelCandidateSelectionSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("failure"),
      requestId: z.string().min(1),
      /** A stable `ERR_MODEL_*` code. Never matched on message text. */
      code: z.string().min(1),
      message: z.string().min(1),
      retryable: z.boolean(),
      durationMs: z.number().nonnegative(),
      /**
       * Bounded, sanitized per-candidate outcomes when an ordered model
       * policy was exhausted. Absent for single-model profiles.
       */
      attempts: z.array(modelCandidateAttemptSchema).max(8).optional(),
    })
    .strict(),
]);

export type ModelResult = z.infer<typeof modelResultSchema>;

// ── Provider contracts ──────────────────────────────────────────

/**
 * What a provider adapter is allowed to see while it runs.
 *
 * Narrower than `AgentContext`, narrower even than `ToolContext` in spirit —
 * a provider has no reason to see anything about DesignFlow at all beyond a
 * signal, a logger and ambient installation facts. No agents, no workers, no
 * `ToolRegistry`, no `WorkflowRunner`, no repositories, no artifact stores, no
 * engine services: a provider adapter's entire job is "take this request,
 * call an HTTP endpoint, return a normalised response," and a context wide
 * enough to do more than that would be a context wide enough to do more than
 * that.
 */
export interface ModelProviderContext {
  readonly signal: AbortSignal;
  readonly logger: Logger;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface ModelProviderCapabilities {
  readonly jsonMode: boolean;
  readonly strictJsonSchema: boolean;
  readonly toolCalling: boolean;
  readonly maxOutputTokens: number;
  readonly responseSchemaIssues?: (schema: JsonSchemaObject) => readonly string[];
}

/**
 * A concrete LLM gateway or vendor — OpenRouter, and later a direct
 * Anthropic, OpenAI, Google or local provider.
 *
 * Contains no agent-specific business logic. A provider translates a
 * `ModelRequest` into whatever its API wants and translates the answer back;
 * it does not know what a workflow is, what a decision is, or that agents
 * exist. That ignorance is what makes swapping providers safe.
 */
export interface ModelProvider {
  readonly id: string;

  /** Optional preflight facts for providers with model-specific capabilities. */
  capabilities?(model: string): ModelProviderCapabilities;

  generate(request: ModelRequest, context: ModelProviderContext): Promise<ModelResponse>;
}

// ── The port AgentRuntime uses to reach the model layer ─────────

/**
 * What `AgentRuntime` sends to the model layer for one call.
 *
 * Carries `profileId` because `ModelRuntime` lives in a separate package
 * (`@designflow/models`) that resolves profiles and providers on its own —
 * the same reason `ToolInvocationRequest` carries `allowedTools` rather than
 * assuming the invoker already knows. `requestId` is minted by the caller
 * (the agent-scoped model service, not the agent itself) so a `started` and
 * its matching `completed`/`failed` trace event can be correlated without the
 * model layer inventing an id the caller never sees.
 */
export interface ModelInvocationRequest {
  readonly requestId: string;
  readonly profileId: string;
  readonly messages: readonly ModelMessage[];
  readonly responseSchema: JsonSchemaObject;
  readonly temperature?: number | undefined;
  readonly maxOutputTokens?: number | undefined;
  readonly signal?: AbortSignal | undefined;
  /** For observation only. Never used to make a resolution or policy decision. */
  readonly agentId?: string | undefined;
  readonly workerId?: string | undefined;
}

/**
 * The port `AgentRuntime` uses to reach the model layer.
 *
 * Exists so `@designflow/agents` can offer model access while depending on
 * `@designflow/sdk` alone — `ModelRuntime` lives in `@designflow/models` and
 * implements this, exactly the relationship `ToolInvoker`/`ToolRuntime` have.
 */
export interface ModelInvoker {
  /**
   * The ids of every registered profile, for narrowing an agent's view.
   *
   * The same reason `ToolInvoker.installedToolIds` exists: it lets
   * `AgentRuntime` tell — before ever attempting a call — whether the profile
   * an agent's manifest names is actually configured, so a missing profile
   * fails cheaply rather than after a round trip that was never going to
   * succeed.
   */
  installedProfileIds(): readonly string[];

  generate(request: ModelInvocationRequest): Promise<ModelResult>;
}

// ── The port an agent is handed ──────────────────────────────────

/**
 * What an agent may ask its model with.
 *
 * No `profileId` field — deliberately. The agent-scoped service this is
 * handed by is bound to exactly one profile at construction, the one named in
 * the agent's own manifest, so there is no field here for a compromised or
 * careless agent to name a *different* profile with. An agent cannot request
 * another agent's model because the shape of the request makes it
 * unrepresentable, not because a check happens to catch it.
 *
 * No generic type parameter, on purpose: a generic `generateStructured<T>`
 * would need an unsafe cast somewhere to turn the provider's `unknown` output
 * into `T` before the caller's own Zod schema has run. Returning the same
 * `ModelResult` shape `ModelInvoker` returns keeps that cast where it
 * belongs — nowhere. The caller parses `result.output` itself, with whatever
 * schema it asked the model to satisfy.
 */
export interface AgentModelRequest {
  readonly messages: readonly ModelMessage[];
  readonly responseSchema: JsonSchemaObject;
  readonly temperature?: number | undefined;
  readonly maxOutputTokens?: number | undefined;
}

export interface AgentModelService {
  generate(request: AgentModelRequest): Promise<ModelResult>;
}
