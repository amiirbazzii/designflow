// packages/agents/src/decision-prompt.ts
import { z } from "zod";
import type { JsonSchemaObject, ModelMessage } from "@designflow/sdk";

/**
 * The bounded prompt a model-backed decision is built from.
 *
 * Deliberately its own file, outside every provider adapter. A provider
 * translates messages into an HTTP call; it never sees an `AgentManifest`, a
 * task, or a tool result, and could not construct a prompt even if it wanted
 * to. This is the one place that assembly happens, which is what makes it
 * possible to say precisely what a model is and is not shown — read this
 * file, not the provider, to answer "what does the model see?".
 *
 * Deterministic and pure: the same inputs produce the same messages, every
 * time, with no clock, no randomness and no I/O. That is what makes it
 * separately testable without a model, a provider or a network in sight.
 *
 * ## What goes in
 *
 *   - the agent's own instructions (its standing brief)
 *   - the user-safe request, exactly as the agent itself received it
 *   - a bounded summary of the structured input, key/value pairs only
 *   - the workflows the agent may choose, by id
 *   - the tools the agent may consult, by id
 *   - the exact schema the answer must satisfy
 *
 * ## What never goes in
 *
 *   - an API key, a header, or anything about how the call will be made
 *   - hidden infrastructure state — no execution ids, no file paths, no
 *     internal configuration
 *   - a repository credential, or any fact about how DesignFlow stores data
 *   - a raw trace, an unrelated config value, or the trace id this decision
 *     will itself be recorded under
 *   - a request for chain-of-thought. The prompt asks for a concise
 *     `reasoningSummary` explicitly, and asks for nothing more private than
 *     that — the same distinction `agentDecisionSchema` enforces structurally
 *     is asked for here in words, so the model is never invited to produce
 *     what the schema would refuse anyway.
 */

const REASONING_INSTRUCTION =
  "Explain your choice in one short, user-safe sentence for `reasoningSummary`. " +
  "Do not include private reasoning, step-by-step thinking, or anything beyond that one sentence.";

/**
 * The model's answer, before it becomes an `AgentDecision`.
 *
 * Narrower than `agentDecisionSchema` in one deliberate way: no `input`
 * field. The model chooses *which* workflow, never *what to run it with* —
 * the structured input a workflow receives still comes from the task the
 * person actually submitted, copied over unchanged by whichever strategy
 * calls this. A model that could invent workflow input would be a model that
 * could smuggle content into a capability's input that nobody reviewed;
 * keeping that field off the vocabulary the model is even offered means there
 * is nothing to smuggle it through.
 *
 * Every member `.strict()`, for the identical reason `agentDecisionSchema`
 * is: a model attaching anything beyond what is named here — chain-of-thought
 * under a different key, an invented field — produces an answer that fails to
 * parse rather than one that quietly reaches the decision that gets acted on.
 */
export const modelDecisionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("run_workflow"),
      workflowId: z.string().min(1),
      reasoningSummary: z.string().min(1).max(400),
    })
    .strict(),
  z
    .object({
      type: z.literal("request_clarification"),
      question: z.string().min(1).max(400),
      reasoningSummary: z.string().min(1).max(400),
    })
    .strict(),
  z
    .object({
      type: z.literal("decline"),
      reason: z.string().min(1).max(400),
      reasoningSummary: z.string().min(1).max(400),
    })
    .strict(),
]);

export type ModelDecision = z.infer<typeof modelDecisionSchema>;

const nullableText = z.string().max(400).nullable();

/** Flat transport shape accepted by strict JSON-schema providers. */
export const modelDecisionTransportSchema = z
  .object({
    type: z.enum(["run_workflow", "request_clarification", "decline"]),
    workflowId: nullableText,
    question: nullableText,
    reason: nullableText,
    reasoningSummary: z.string().min(1).max(400),
  })
  .strict();

export type ModelDecisionTransport = z.infer<typeof modelDecisionTransportSchema>;

/** Converts the flat provider response into the existing discriminated union. */
export function modelDecisionFromTransport(
  raw: unknown,
  availableWorkflows: readonly string[],
): ModelDecision | undefined {
  const parsed = modelDecisionTransportSchema.safeParse(raw);
  if (!parsed.success) return undefined;

  const decision = parsed.data;
  if (decision.type === "run_workflow") {
    if (decision.workflowId === null || !availableWorkflows.includes(decision.workflowId)) return undefined;
    if (decision.question !== null || decision.reason !== null) return undefined;
    return modelDecisionSchema.parse({ type: decision.type, workflowId: decision.workflowId, reasoningSummary: decision.reasoningSummary });
  }

  if (decision.type === "request_clarification") {
    if (decision.question === null || decision.question.trim().length === 0) return undefined;
    if (decision.workflowId !== null || decision.reason !== null) return undefined;
    return modelDecisionSchema.parse({ type: decision.type, question: decision.question, reasoningSummary: decision.reasoningSummary });
  }

  if (decision.reason === null || decision.reason.trim().length === 0) return undefined;
  if (decision.workflowId !== null || decision.question !== null) return undefined;
  return modelDecisionSchema.parse({ type: decision.type, reason: decision.reason, reasoningSummary: decision.reasoningSummary });
}

/**
 * The JSON Schema sent to the provider. It deliberately uses one flat object
 * with nullable fields: OpenRouter's strict JSON-schema path rejects a
 * top-level `oneOf`, while the internal discriminated union remains the
 * authoritative post-parse contract.
 *
 * Hand-written rather than derived from the Zod schema by a converter —
 * building a general Zod-to-JSON-Schema translator for one call site would be
 * exactly the kind of unsupported generalisation this stage was told not to
 * add. `workflowId` is constrained to an enum of the agent's own
 * `availableWorkflows`, tightening the model's choices at the schema level —
 * genuinely useful, since some providers reject an answer outside an enum
 * before it is even returned — but this is a courtesy, not the enforcement.
 * `modelDecisionSchema` re-parses the answer regardless, and the workflow
 * allow-list check downstream of that does not know or care that the schema
 * already tried to narrow things.
 */
export function decisionResponseSchema(availableWorkflows: readonly string[]): JsonSchemaObject {
  return {
    type: "object",
    properties: {
      type: { type: "string", enum: ["run_workflow", "request_clarification", "decline"] },
      workflowId: { type: ["string", "null"], enum: [...availableWorkflows, null] },
      question: { type: ["string", "null"], maxLength: 400 },
      reason: { type: ["string", "null"], maxLength: 400 },
      reasoningSummary: { type: "string", maxLength: 400 },
    },
    required: ["type", "workflowId", "question", "reason", "reasoningSummary"],
    additionalProperties: false,
  };
}

export interface DecisionPromptClarification {
  readonly question: string;
  readonly answer: string;
}

export interface DecisionPromptInput {
  readonly instructions: string;
  readonly request: string;
  /** Bounded key/value pairs. Values are stringified and truncated. */
  readonly inputSummary?: Readonly<Record<string, unknown>> | undefined;
  readonly availableWorkflows: readonly string[];
  readonly availableTools: readonly string[];
  /**
   * Clarifying questions already asked and answered earlier in this same
   * bounded task, oldest first — present only when a session resumed this
   * decision after `request_clarification`. Absent on a first decision.
   *
   * This is the *only* way a resumed decision differs from a fresh one: the
   * request and input are unchanged, and this is additional bounded context,
   * not a replacement for either. Still no chain-of-thought and no raw
   * session state — a caller building this list from a stored session is
   * expected to have already stripped everything but the question and the
   * answer, the same discipline `SessionContextBuilder` documents.
   */
  readonly clarifications?: readonly DecisionPromptClarification[] | undefined;
  /**
   * Bounded project facts, when the task is scoped to a project — Stage 40's
   * Project Context, already filtered and truncated by `ContextAssemblyService`
   * before this ever sees it. Absent for a task with no project, or when no
   * `AgentKnowledgeService` is configured; the prompt is byte-identical to
   * every test written before Stage 40 in that case.
   */
  readonly projectFacts?: readonly DecisionPromptFact[] | undefined;
  /**
   * Bounded, approved agent memory applicable to this exact agent/project —
   * Stage 40's Agent Memory. Never anything an agent wrote for itself; see
   * `MemoryProposalService` for why only approved memory ever reaches here.
   */
  readonly memoryNotes?: readonly DecisionPromptFact[] | undefined;
}

export interface DecisionPromptFact {
  readonly key: string;
  readonly value: unknown;
}

const MAX_VALUE_LENGTH = 200;
const MAX_SUMMARY_FIELDS = 20;
const MAX_CLARIFICATIONS = 10;
const MAX_FACTS_IN_PROMPT = 20;

/** One line per field, truncated, so a single oversized answer cannot blow the prompt open. */
function summarizeInput(input: Readonly<Record<string, unknown>> | undefined): string {
  if (input === undefined) return "(none)";

  const entries = Object.entries(input).slice(0, MAX_SUMMARY_FIELDS);
  if (entries.length === 0) return "(none)";

  return entries
    .map(([key, value]) => {
      const rendered = Array.isArray(value) ? value.join(", ") : String(value);
      const bounded =
        rendered.length > MAX_VALUE_LENGTH
          ? `${rendered.slice(0, MAX_VALUE_LENGTH)}…`
          : rendered;
      return `- ${key}: ${bounded}`;
    })
    .join("\n");
}

/**
 * Renders a resumed decision's prior exchange, or nothing at all.
 *
 * Returns lines to append rather than a string, so a fresh decision's prompt
 * is byte-identical to what it was before this existed — an empty array
 * joins to nothing, adding no blank section for a task that was never
 * clarified.
 */
function summarizeClarifications(
  clarifications: readonly DecisionPromptClarification[] | undefined,
): readonly string[] {
  if (clarifications === undefined || clarifications.length === 0) return [];

  const bounded = clarifications.slice(0, MAX_CLARIFICATIONS);

  return [
    "",
    "Already asked and answered for this same request:",
    ...bounded.map(
      (exchange, index) => `${index + 1}. Q: ${exchange.question}\n   A: ${exchange.answer}`,
    ),
  ];
}

/**
 * Renders bounded facts as one line each, or nothing at all.
 *
 * Shared by `projectFacts` and `memoryNotes` — both are the same shape
 * (`key`, `value`) for the same reason: a decision does not need to know
 * *why* it knows something, only what it knows, bounded and named.
 */
function summarizeFacts(
  heading: string,
  facts: readonly DecisionPromptFact[] | undefined,
): readonly string[] {
  if (facts === undefined || facts.length === 0) return [];

  const bounded = facts.slice(0, MAX_FACTS_IN_PROMPT);

  return [
    "",
    heading,
    ...bounded.map(({ key, value }) => {
      const rendered = Array.isArray(value) ? value.join(", ") : String(value);
      const truncated =
        rendered.length > MAX_VALUE_LENGTH ? `${rendered.slice(0, MAX_VALUE_LENGTH)}…` : rendered;
      return `- ${key}: ${truncated}`;
    }),
  ];
}

/**
 * Builds the messages and response schema for one decision.
 *
 * Two messages: a `system` message carrying the agent's standing instructions
 * plus the bounded menu of what it may choose from, and a `user` message
 * carrying the request itself. Splitting them this way is what lets the same
 * instructions be reused verbatim across many requests, and is the
 * conventional shape most providers optimise for.
 */
export function buildDecisionPrompt(input: DecisionPromptInput): {
  readonly messages: readonly ModelMessage[];
  readonly responseSchema: JsonSchemaObject;
} {
  const system = [
    input.instructions,
    "",
    "You are deciding what should happen next for a bounded task. You must respond " +
      "with exactly one structured decision matching the schema you have been given.",
    "",
    `Permitted workflows: ${input.availableWorkflows.length > 0 ? input.availableWorkflows.join(", ") : "(none)"}`,
    `Permitted tools already consulted: ${input.availableTools.length > 0 ? input.availableTools.join(", ") : "(none)"}`,
    "",
    "You may only choose a workflow from the permitted list above. You may not name " +
      "a tool, a capability, a shell command, a file path or any other operation — your " +
      "only choices are: run one of the permitted workflows, ask a clarifying question, " +
      "or decline.",
    "",
    REASONING_INSTRUCTION,
  ].join("\n");

  const user = [
    `Request: ${input.request.length > 0 ? input.request : "(empty)"}`,
    "",
    "Structured input:",
    summarizeInput(input.inputSummary),
    ...summarizeClarifications(input.clarifications),
    ...summarizeFacts("Known about this project:", input.projectFacts),
    ...summarizeFacts("Remembered preferences:", input.memoryNotes),
  ].join("\n");

  return {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    responseSchema: decisionResponseSchema(input.availableWorkflows),
  };
}

// ── Product-action decisions (MVP-3B reconciliation) ─────────────
//
// The Design Engineer coordinator decides among PRODUCT ACTIONS, never raw
// workflow ids: the host supplies the actions currently permitted, the model
// (or the deterministic strategy) interprets the user's intent among them,
// and a deterministic translator downstream maps the chosen action onto a
// workflow. A model answer can narrow behavior but can never broaden
// authority — every response is re-validated against the allowed set here
// and against live prerequisites after translation.

export const PRODUCT_ACTIONS = [
  "create_specification",
  "prepare_implementation",
  "request_clarification",
  "decline",
] as const;

export type ProductAction = (typeof PRODUCT_ACTIONS)[number];

export const productActionDecisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create_specification"), reasoningSummary: z.string().min(1).max(400) }).strict(),
  z.object({ action: z.literal("prepare_implementation"), reasoningSummary: z.string().min(1).max(400) }).strict(),
  z.object({ action: z.literal("request_clarification"), question: z.string().min(1).max(400), reasoningSummary: z.string().min(1).max(400) }).strict(),
  z.object({ action: z.literal("decline"), reason: z.string().min(1).max(400), reasoningSummary: z.string().min(1).max(400) }).strict(),
]);

export type ProductActionDecision = z.infer<typeof productActionDecisionSchema>;

export const COORDINATOR_OUTPUT_ERROR_CODES = [
  "ERR_COORDINATOR_OUTPUT_EMPTY",
  "ERR_COORDINATOR_OUTPUT_JSON_INVALID",
  "ERR_COORDINATOR_OUTPUT_SCHEMA_INVALID",
  "ERR_COORDINATOR_ACTION_INVALID",
  "ERR_COORDINATOR_ACTION_NOT_ALLOWED",
  "ERR_COORDINATOR_OUTPUT_TRUNCATED",
] as const;

export type CoordinatorOutputErrorCode =
  (typeof COORDINATOR_OUTPUT_ERROR_CODES)[number];

export interface CoordinatorOutputValidationFailure {
  readonly errorCode: CoordinatorOutputErrorCode;
  readonly schemaPath?: string | undefined;
  readonly returnedAction?: string | undefined;
  readonly outputLength: number;
  readonly truncated: boolean;
}

export type ProductActionValidation =
  | { readonly decision: ProductActionDecision }
  | { readonly failure: CoordinatorOutputValidationFailure };

const productActionTransportSchema = z
  .object({
    action: z.enum(PRODUCT_ACTIONS),
    question: nullableText,
    reason: nullableText,
    reasoningSummary: z.string().min(1).max(400),
  })
  .strict();

function boundedOutputLength(raw: unknown): number {
  if (typeof raw === "string") return Math.min(raw.length, 100_000);
  if (raw === undefined || raw === null) return 0;

  try {
    return Math.min(JSON.stringify(raw).length, 100_000);
  } catch {
    return 0;
  }
}

function schemaPath(path: readonly PropertyKey[]): string | undefined {
  const rendered = path
    .map((part) => String(part).replace(/[^a-zA-Z0-9_.-]/g, ""))
    .join(".")
    .slice(0, 160);
  return rendered.length > 0 ? rendered : undefined;
}

function safeReturnedAction(raw: unknown): string | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const action = (raw as { action?: unknown }).action;
  if (typeof action !== "string" || !/^[a-zA-Z0-9_:-]{1,80}$/.test(action)) return undefined;
  if (/(?:sk-|api[_-]?key|bearer|token|secret)/i.test(action)) return undefined;
  return action;
}

function invalid(
  raw: unknown,
  errorCode: CoordinatorOutputErrorCode,
  extra: Pick<CoordinatorOutputValidationFailure, "schemaPath" | "returnedAction"> &
    Partial<Pick<CoordinatorOutputValidationFailure, "truncated">> = {},
): ProductActionValidation {
  return {
    failure: {
      errorCode,
      outputLength: boundedOutputLength(raw),
      truncated: extra.truncated ?? false,
      ...(extra.schemaPath !== undefined ? { schemaPath: extra.schemaPath } : {}),
      ...(extra.returnedAction !== undefined ? { returnedAction: extra.returnedAction } : {}),
    },
  };
}

/** Strictly validates one untrusted Coordinator transport response. */
export function validateProductActionTransport(
  raw: unknown,
  allowedActions: readonly ProductAction[],
): ProductActionValidation {
  if (raw === undefined || raw === null) {
    return invalid(raw, "ERR_COORDINATOR_OUTPUT_EMPTY");
  }

  let candidate: unknown = raw;
  if (typeof raw === "string") {
    try {
      candidate = JSON.parse(raw) as unknown;
    } catch {
      return invalid(raw, "ERR_COORDINATOR_OUTPUT_JSON_INVALID");
    }
  }

  const returnedAction = safeReturnedAction(candidate);
  if (returnedAction !== undefined && !PRODUCT_ACTIONS.includes(returnedAction as ProductAction)) {
    return invalid(candidate, "ERR_COORDINATOR_ACTION_INVALID", { returnedAction });
  }

  const parsed = productActionTransportSchema.safeParse(candidate);
  if (!parsed.success) {
    return invalid(candidate, "ERR_COORDINATOR_OUTPUT_SCHEMA_INVALID", {
      schemaPath: schemaPath(parsed.error.issues[0]?.path ?? []),
      returnedAction,
    });
  }

  const decision = parsed.data;
  if (!allowedActions.includes(decision.action)) {
    return invalid(candidate, "ERR_COORDINATOR_ACTION_NOT_ALLOWED", {
      returnedAction: decision.action,
    });
  }

  if (decision.action === "request_clarification") {
    if (decision.question === null || decision.question.trim().length === 0) {
      return invalid(candidate, "ERR_COORDINATOR_OUTPUT_SCHEMA_INVALID", {
        schemaPath: "question",
        returnedAction: decision.action,
      });
    }
    if (decision.reason !== null) {
      return invalid(candidate, "ERR_COORDINATOR_OUTPUT_SCHEMA_INVALID", {
        schemaPath: "reason",
        returnedAction: decision.action,
      });
    }
    return {
      decision: productActionDecisionSchema.parse({
        action: decision.action,
        question: decision.question,
        reasoningSummary: decision.reasoningSummary,
      }),
    };
  }

  if (decision.action === "decline") {
    if (decision.reason === null || decision.reason.trim().length === 0) {
      return invalid(candidate, "ERR_COORDINATOR_OUTPUT_SCHEMA_INVALID", {
        schemaPath: "reason",
        returnedAction: decision.action,
      });
    }
    if (decision.question !== null) {
      return invalid(candidate, "ERR_COORDINATOR_OUTPUT_SCHEMA_INVALID", {
        schemaPath: "question",
        returnedAction: decision.action,
      });
    }
    return {
      decision: productActionDecisionSchema.parse({
        action: decision.action,
        reason: decision.reason,
        reasoningSummary: decision.reasoningSummary,
      }),
    };
  }

  if (decision.question !== null || decision.reason !== null) {
    return invalid(candidate, "ERR_COORDINATOR_OUTPUT_SCHEMA_INVALID", {
      schemaPath: decision.question !== null ? "question" : "reason",
      returnedAction: decision.action,
    });
  }
  return {
    decision: productActionDecisionSchema.parse({
      action: decision.action,
      reasoningSummary: decision.reasoningSummary,
    }),
  };
}

/** Backward-compatible strict parser used by existing callers and tests. */
export function productActionFromTransport(
  raw: unknown,
  allowedActions: readonly ProductAction[],
): ProductActionDecision | undefined {
  const result = validateProductActionTransport(raw, allowedActions);
  return "decision" in result ? result.decision : undefined;
}

const PRODUCT_ACTION_DESCRIPTIONS: Record<ProductAction, string> = {
  create_specification:
    "produce a structured engineering specification of the design; reads only, writes nothing to the user's project",
  prepare_implementation:
    "prepare a reviewed implementation proposal for the user's selected project; nothing is written until they approve the exact proposal",
  request_clarification: "ask the user one clarifying question",
  decline: "decline work outside the Design Engineer's scope",
};

export interface ProductActionFact {
  readonly key: string;
  readonly value: string | boolean;
}

export interface ProductActionPromptInput {
  readonly instructions: string;
  readonly request: string;
  readonly allowedActions: readonly ProductAction[];
  /** Safe, host-derived facts only — never secrets, ids, or raw config. */
  readonly facts: readonly ProductActionFact[];
  readonly clarifications?: readonly DecisionPromptClarification[] | undefined;
  readonly repairFeedback?: ProductActionRepairFeedback | undefined;
}

export interface ProductActionRepairFeedback {
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly errorCode: CoordinatorOutputErrorCode;
  readonly schemaPath?: string | undefined;
  readonly returnedAction?: string | undefined;
  readonly allowedActions: readonly ProductAction[];
}

function productActionResponseSchema(allowedActions: readonly ProductAction[]): JsonSchemaObject {
  return {
    type: "object",
    properties: {
      action: { type: "string", enum: [...allowedActions] },
      question: { type: ["string", "null"], maxLength: 400 },
      reason: { type: ["string", "null"], maxLength: 400 },
      reasoningSummary: { type: "string", maxLength: 400 },
    },
    required: ["action", "question", "reason", "reasoningSummary"],
    additionalProperties: false,
  };
}

/** Builds the messages and response schema for one product-action decision. */
export function buildProductActionPrompt(input: ProductActionPromptInput): {
  readonly messages: readonly ModelMessage[];
  readonly responseSchema: JsonSchemaObject;
} {
  const system = [
    input.instructions,
    "",
    "You are the routing decision for one bounded request. Interpret what the user " +
      "wants and answer with exactly one structured decision matching the schema.",
    "",
    "Available actions:",
    ...input.allowedActions.map((action) => `- ${action}: ${PRODUCT_ACTION_DESCRIPTIONS[action]}`),
    "",
    "You may only choose from the actions listed above. You cannot name workflows, " +
      "tools, commands, or files. Choosing prepare_implementation never writes " +
      "anything by itself — a separate explicit approval always follows.",
    "When the situation says the user selected a design and destination for " +
      "implementation and preparation is permitted, choose prepare_implementation " +
      "without asking a generic specification-versus-implementation question. " +
      "Ask for clarification only when a concrete required detail is genuinely missing.",
    "",
    REASONING_INSTRUCTION,
    ...(input.repairFeedback === undefined
      ? []
      : [
          "",
          "Your previous Coordinator response was invalid.",
          `Attempt: ${input.repairFeedback.attempt} of ${input.repairFeedback.maxAttempts}`,
          `Failure: ${input.repairFeedback.errorCode}`,
          ...(input.repairFeedback.schemaPath !== undefined
            ? [`Schema field: ${input.repairFeedback.schemaPath}`]
            : []),
          ...(input.repairFeedback.returnedAction !== undefined
            ? [`Returned action: ${input.repairFeedback.returnedAction}`]
            : []),
          `Allowed actions: ${input.repairFeedback.allowedActions.join(", ")}`,
          "Return only an object satisfying the required Coordinator schema.",
        ]),
  ].join("\n");

  const user = [
    `Request: ${input.request.length > 0 ? input.request : "(empty)"}`,
    "",
    "Situation:",
    ...input.facts.map((fact) => `- ${fact.key}: ${String(fact.value)}`),
    ...summarizeClarifications(input.clarifications),
  ].join("\n");

  return {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    responseSchema: productActionResponseSchema(input.allowedActions),
  };
}
