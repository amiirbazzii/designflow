// packages/agents/src/catalog/design-engineer-agent.ts
import {
  agentManifestSchema,
  modelProfileSchema,
  type Agent,
  type AgentContext,
  type AgentDecision,
  type AgentManifest,
  type AgentTask,
  type ModelProfile,
  type ToolResult,
  type CoordinatorOutputDiagnostic,
} from "@designflow/sdk";

import {
  buildProductActionPrompt,
  validateProductActionTransport,
  type CoordinatorOutputErrorCode,
  type ProductAction,
  type ProductActionFact,
  type ProductActionDecision,
  type ProductActionRepairFeedback,
} from "../decision-prompt";
import { CoordinatorOutputAttemptsExhaustedError } from "../errors";


/**
 * The Design Engineer's agent.
 *
 * One manifest, two interchangeable strategies for how `decide` is actually
 * reached — a deliberate split, because "does this agent use a model" and
 * "what may this agent do" are different questions with different owners.
 * The manifest — id, `allowedWorkflows`, `allowedTools`, `modelProfileId` —
 * is the reviewed, reused answer to the second question, unaffected by which
 * strategy a given install runs. The strategy is a runtime choice made once,
 * at composition-root wiring time, never per-request and never by the agent
 * guessing whether a credential happens to be configured.
 *
 * **`deterministicDesignEngineerStrategy`** is Stage 36 unchanged: it
 * classifies the request with `classify-design-task` and decides from the
 * result. No model, no network, works offline, and is what every test in
 * this package still exercises by default through `designEngineerAgent`.
 *
 * **`modelDesignEngineerStrategy`** calls the agent's configured model — the
 * profile named on this very manifest — and turns its structured answer into
 * an `AgentDecision`. It reuses the *same* classifier tool first, folding the
 * result into the model's prompt as bounded context, which is what "tool
 * results may inform the model request" means concretely here.
 *
 * Neither strategy silently becomes the other. A model failure — timeout,
 * rate limit, invalid output, anything — does not fall back to running the
 * classifier logic on its own; it declines, honestly, with a safe reason. A
 * decision-maker that quietly swapped its own reasoning process on failure
 * would be exactly the "silent fallback to deterministic mode" this stage was
 * told not to build.
 */

/**
 * One constant rather than a literal repeated in two places.
 *
 * The manifest's `modelProfileId` and the shipped default profile's `id`
 * below must always name the same thing — this is what makes that structural
 * rather than a fact someone has to remember to keep in sync by hand.
 */
const MODEL_PROFILE_ID = "design-engineer-default";

export const designEngineerAgentManifest: AgentManifest = agentManifestSchema.parse({
  id: "design-engineer-agent",
  name: "Design Engineer Agent",
  description: "Decides how a Design Engineer request should be carried out",
  version: "0.3.0",
  instructions:
    "You coordinate the Design Engineer. Understand what the user wants from a " +
    "Figma design: choose create_specification to document or analyze it; choose " +
    "prepare_implementation only when they want code changes prepared for their " +
    "selected project; ask one clarifying question when the goal is unclear; " +
    "decline work that is not about a design.",
  allowedWorkflows: ["design-to-code", "design-to-code-implementation", "design-to-code-figma-specification"],
  allowedTools: ["classify-design-task"],
  /**
   * A reference, not a configuration. Naming a profile here does not, by
   * itself, cause a single model call — that only happens when the
   * composition root wires this manifest to `modelDesignEngineerStrategy`
   * *and* the profile actually resolves. The deterministic strategy never
   * reads this field at all.
   */
  modelProfileId: MODEL_PROFILE_ID,
  metadata: {
    author: "DesignFlow",
  },
});

/**
 * The model this agent uses when nothing overrides it.
 *
 * Owned here, next to the manifest that names it, rather than reconstructed
 * inside the CLI's composition root — a host wiring this agent up should
 * never have to know or repeat a profile id that already lives on the
 * manifest it is installing. `mergeModelProfileOverrides` (in
 * `@designflow/models`) is what lets a local config replace `model` for this
 * one profile without touching this file, this agent, or any other agent's
 * default.
 *
 * The concrete slug is a starting point, not a commitment: cheap and fast
 * enough for a decision that only ever picks among a short list of named
 * workflows, never generates code itself. Nothing about the architecture
 * depends on this exact choice.
 */
export const designEngineerDefaultModelProfile: ModelProfile = modelProfileSchema.parse({
  id: MODEL_PROFILE_ID,
  providerId: "openrouter",
  model: "openai/gpt-4o-mini",
});

const CLASSIFIER = "classify-design-task";
export const FIGMA_SPECIFICATION_WORKFLOW_ID = "design-to-code-figma-specification";

/** The kinds of request that describe work `design-to-code` can do. */
const ACTIONABLE = new Set(["new_component", "modify_component", "page"]);
const IMPLEMENTATION_WORKFLOW_ID = "design-to-code-implementation";

function wantsImplementation(task: AgentTask, context: AgentContext): boolean {
  if (!context.availableWorkflows.includes(IMPLEMENTATION_WORKFLOW_ID)) return false;
  const input = task.input;
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
  const record = input as Record<string, unknown>;
  // Project presence is where changes COULD go, never permission to prepare
  // them: implementation routing additionally requires the host-collected,
  // user-visible journey consent. The later exact-proposal approval remains
  // a separate, unbypassed gate.
  return (
    (typeof record.projectId === "string" || typeof record.project === "object")
    && record.projectWriteConsent === true
  );
}

function wantsRealFigmaSpecification(task: AgentTask, context: AgentContext): boolean {
  if (!context.availableWorkflows.includes(FIGMA_SPECIFICATION_WORKFLOW_ID)) return false;
  const input = task.input;
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
  const mode = (input as Record<string, unknown>).figmaSourceMode;
  return typeof mode === "string" && mode !== "placeholder";
}

// ── Product-action routing facts (MVP-3B reconciliation) ────────
//
// The deterministic host resolves what is PERMITTED; the coordinator
// interprets what is WANTED among those permissions. These facts are the
// bridge: safe, host-derived booleans — never secrets, ids, or raw config.

interface DesignRoutingFacts {
  readonly specificationAvailable: boolean;
  readonly implementationAvailable: boolean;
  readonly projectSelected: boolean;
  readonly projectWriteConsent: boolean;
}

function buildRoutingFacts(task: AgentTask, context: AgentContext): DesignRoutingFacts {
  const input = typeof task.input === "object" && task.input !== null && !Array.isArray(task.input)
    ? (task.input as Record<string, unknown>)
    : {};
  return {
    specificationAvailable: wantsRealFigmaSpecification(task, context),
    implementationAvailable: wantsImplementation(task, context),
    projectSelected: typeof input.projectId === "string" || typeof input.project === "object",
    projectWriteConsent: input.projectWriteConsent === true,
  };
}

function allowedActionsFor(facts: DesignRoutingFacts): ProductAction[] {
  return [
    ...(facts.specificationAvailable ? (["create_specification"] as const) : []),
    ...(facts.implementationAvailable ? (["prepare_implementation"] as const) : []),
    "request_clarification",
    "decline",
  ];
}

/**
 * Conservative intent reading for the deterministic strategy. Explicit
 * specification vocabulary (or an explicit do-not-change instruction)
 * always wins; explicit implementation vocabulary selects implementation
 * only when it is actually permitted. Neither list is load-bearing for
 * safety — translation and post-validation are.
 */
const SPECIFICATION_INTENT = /\b(document(?:ation)?|describe|inspect|analy[sz]e|specif\w*|spec|review|audit|explain)\b/i;
const NO_WRITE_INTENT = /\b(?:do\s+not|don'?t|no|without)\s+(?:chang\w*|modify\w*|touch\w*|writ\w*)\b/i;
const IMPLEMENTATION_INTENT = /\b(implement\w*|build|apply|integrat\w*|convert)\b/i;
const DESIGN_VOCABULARY = /\b(design|figma|frame|component|page|screen|ui|mockup|layout)\b/i;

function hasSpecificationIntent(text: string): boolean {
  return SPECIFICATION_INTENT.test(text) || NO_WRITE_INTENT.test(text);
}

const SETUP_CLARIFICATION = {
  type: "request_clarification",
  question:
    "I work from a connected Figma design. Connect Figma (run `designflow doctor` to check the setup), then tell me which design to build from.",
  reasoningSummary: "No supported journey is available for this request: no real Figma source (and no consented project) was provided.",
} as const;

/** Deterministic translation: product action → workflow. Never model-owned. */
function runFor(action: "create_specification" | "prepare_implementation", task: AgentTask, reasoningSummary: string): AgentDecision {
  return {
    type: "run_workflow",
    workflowId: action === "prepare_implementation" ? IMPLEMENTATION_WORKFLOW_ID : FIGMA_SPECIFICATION_WORKFLOW_ID,
    ...(task.input !== undefined ? { input: task.input } : {}),
    reasoningSummary,
  };
}

/**
 * Whether there is anything at all to act on.
 *
 * The floor beneath both strategies, not a replacement for either. A request
 * that is blank *and* carries no structured input describes no work — there
 * is nothing to classify and nothing worth spending a model call on.
 */
function hasSomethingToDo(task: AgentTask): boolean {
  if (task.request.trim().length > 0) return true;

  const { input } = task;
  if (input === undefined || input === null) return false;

  if (typeof input === "object") return Object.keys(input).length > 0;

  return String(input).trim().length > 0;
}

/**
 * The request as one string for the classifier, and for the model prompt.
 *
 * The prose request when there is one, with the structured input's values
 * appended — a CLI form produces `{designFile: "homepage.fig"}` and no prose,
 * and classifying an empty string would call every form submission unknown.
 */
function describe(task: AgentTask): string {
  const parts = [task.request];

  const { input } = task;
  if (typeof input === "object" && input !== null && !Array.isArray(input)) {
    for (const value of Object.values(input)) {
      parts.push(Array.isArray(value) ? value.join(" ") : String(value));
    }
  }

  // A resumed session's clarification answer is the only thing left to
  // classify when the original request/input was empty — see `readyToDecide`.
  if (!hasSomethingToDo(task)) {
    for (const clarification of readClarifications(task)) parts.push(clarification.answer);
  }

  return parts.filter((part) => part.length > 0).join(" ");
}

/**
 * The clarification exchange a session-resumed task carries, or none.
 *
 * `AgentTask.context` is `Record<string, unknown>` at the SDK boundary — this
 * agent depends on `@designflow/sdk` alone, never on `@designflow/product`,
 * so a resumed session's context arrives exactly as untyped as a fresh
 * task's does and must be narrowed the same defensive way
 * `readClassification` narrows a tool result: re-checked rather than
 * trusted, and silently absent rather than thrown on anything unexpected.
 */
function readClarifications(
  task: AgentTask,
): readonly { question: string; answer: string }[] {
  const { context } = task;
  if (typeof context !== "object" || context === null) return [];

  const clarifications = (context as { clarifications?: unknown }).clarifications;
  if (!Array.isArray(clarifications)) return [];

  return clarifications.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];

    const question = (entry as { question?: unknown }).question;
    const answer = (entry as { answer?: unknown }).answer;

    return typeof question === "string" && typeof answer === "string"
      ? [{ question, answer }]
      : [];
  });
}

/**
 * Whether there is now anything to act on — the original request/input, OR a
 * clarification answer a resumed session carries.
 *
 * A session that started with a genuinely empty request/input (reachable
 * through the product API's `POST /workers/:id/tasks` with an empty body,
 * unlike the CLI's interactive form, which always fills a placeholder) is
 * resumed by `AgentSessionService.answerSession` re-routing with that same
 * empty `originalRequest`/`originalInput` — the answer only ever lands in
 * `task.context.clarifications`. `hasSomethingToDo` alone never sees it, and
 * without this, the session would ask the same question forever.
 */
function readyToDecide(task: AgentTask): boolean {
  return hasSomethingToDo(task) || readClarifications(task).length > 0;
}

/**
 * What the classifier said, or null when it could not be consulted.
 *
 * Null covers every failure mode identically — not installed, not permitted,
 * timed out, over budget, malformed output. Both strategies fall back the
 * same way for all of them, so distinguishing them here would be detail
 * without a decision attached.
 */
function readClassification(result: ToolResult): { taskType: string; confidence: number } | null {
  if (result.type !== "success") return null;

  const { output } = result;
  if (typeof output !== "object" || output === null) return null;

  const taskType = (output as { taskType?: unknown }).taskType;
  const confidence = (output as { confidence?: unknown }).confidence;

  // Re-checked rather than trusted. The tool runtime already parsed this
  // against the tool's own output schema, but the agent holds `unknown` and
  // narrowing it here is cheaper than importing the tool package — which the
  // agent layer must not do, because it would depend on the tools it calls.
  return typeof taskType === "string" && typeof confidence === "number"
    ? { taskType, confidence }
    : null;
}

async function classify(
  task: AgentTask,
  context: AgentContext,
): Promise<{ taskType: string; confidence: number } | null> {
  if (!context.availableTools.includes(CLASSIFIER)) return null;

  return readClassification(
    await context.tools.call({
      id: `${task.workerId}-classify`,
      toolId: CLASSIFIER,
      input: { request: describe(task) },
    }),
  );
}

// ── The deterministic strategy ──────────────────────────────────

/**
 * `Agent["decide"]` shaped, taking the manifest explicitly.
 *
 * A plain function type rather than a class or an object with one method,
 * because a strategy is exactly one decision — nothing here has state that
 * outlives a single call, and giving it a bigger shape than that would
 * invite adding some.
 */
export type DesignEngineerStrategy = (
  task: AgentTask,
  context: AgentContext,
  manifest: AgentManifest,
) => Promise<AgentDecision>;

/**
 * Stage 36, unchanged. The tool call is load-bearing: a recognised kind of
 * design work runs the workflow, `unknown` asks a question instead — deleting
 * the classifier call changes the outcome, which is the only honest test of
 * whether a tool matters.
 */
export const deterministicDesignEngineerStrategy: DesignEngineerStrategy = async (
  task,
  context,
  _manifest,
) => {
  const facts = buildRoutingFacts(task, context);

  // Hard prerequisite short-circuits: with no supported route there is no
  // meaningful product decision to interpret. The legacy scaffold is never
  // an answer.
  if (!facts.specificationAvailable && !facts.implementationAvailable) {
    return { ...SETUP_CLARIFICATION };
  }

  if (!readyToDecide(task)) {
    return {
      type: "request_clarification",
      question:
        "Which design should I build? Name a design file, or describe what you want made.",
      reasoningSummary: "The request named nothing to work from.",
    };
  }

  const text = describe(task);

  // Intent first: an explicit specification request stays specification even
  // when a consented project makes implementation permitted.
  if (hasSpecificationIntent(text) && facts.specificationAvailable) {
    return runFor("create_specification", task, "The request asks for documentation or analysis, so the design-specification journey will be used.");
  }

  if (IMPLEMENTATION_INTENT.test(text) && !facts.implementationAvailable) {
    return {
      type: "request_clarification",
      question: facts.projectSelected
        ? "Preparing implementation changes needs your explicit go-ahead for the selected project. Run again and confirm when asked, or ask for a design specification instead."
        : "Preparing implementation changes needs a registered project. Select one with --project (see `designflow projects`), or ask for a design specification instead.",
      reasoningSummary: "The request asks for implementation, but its prerequisites (project and explicit consent) are not in place.",
    };
  }

  const classification = await classify(task, context);

  // A request that describes nothing recognisable gets a question — or a
  // decline when it does not even sound like design work.
  if (classification !== null && !ACTIONABLE.has(classification.taskType)
      && !IMPLEMENTATION_INTENT.test(text) && !hasSpecificationIntent(text)) {
    if (!DESIGN_VOCABULARY.test(text)) {
      return {
        type: "decline",
        reason: "That is outside the Design Engineer's scope. I turn Figma designs into specifications and reviewed code changes.",
        reasoningSummary: "The request did not describe design work.",
      };
    }
    return {
      type: "request_clarification",
      question:
        "What would you like from this design — an engineering specification, or prepared code changes for your project?",
      reasoningSummary: "The request did not make the desired outcome recognisable.",
    };
  }

  // Defaults: journey consent is an explicit, user-visible product choice
  // ("Prepare changes for this project?" answered yes this run) — it is the
  // intent signal for form-style requests that carry no prose. Without it,
  // the read-only specification journey is the default.
  if (facts.implementationAvailable) {
    return runFor("prepare_implementation", task, "A registered project was selected and implementation was explicitly consented to this run, so the implementation journey will be used.");
  }

  return runFor("create_specification", task,
    classification === null
      ? "A real Figma source is connected, so the design-specification journey will be used."
      : `The request looks like ${classification.taskType.replace(/_/g, " ")}; the design-specification journey will be used.`);
};

// ── The model strategy ──────────────────────────────────────────

/**
 * Calls the agent's configured model and turns its structured answer into an
 * `AgentDecision`.
 *
 * The model never sees this manifest's `allowedTools` beyond the classifier's
 * result already folded into its prompt, never sees a credential, and never
 * chooses workflow *input* — only which permitted workflow, or whether to ask
 * or decline. Whatever it answers is re-validated by `modelDecisionSchema`
 * here, and then faces the same allow-list enforcement every decision faces
 * in `AgentRuntime`, model-backed or not.
 */
/** A short, safe explanation for a model failure — never the provider's own message. */
function declineForModelFailure(code: string): AgentDecision {
  const reason =
    code === "ERR_MODEL_SCHEMA_UNSUPPORTED"
      ? "The configured model rejected the required structured-output schema."
      : code === "ERR_MODEL_OUTPUT_UNSUPPORTED"
        ? "The configured model cannot return the required structured output."
        : code === "ERR_MODEL_RATE_LIMITED" || code === "ERR_MODEL_UNAVAILABLE"
          ? "The configured model is temporarily unavailable."
          : code === "ERR_MODEL_TIMEOUT"
            ? "The model took too long to respond."
            : code === "ERR_AGENT_MODEL_BUDGET_EXCEEDED"
              ? "This request needed more from the model than is allowed at once."
              : "The model could not be reached.";

  return {
    type: "decline",
    reason,
    reasoningSummary: "The configured model call did not succeed.",
  };
}

const MAX_COORDINATOR_ATTEMPTS = 2;

function repairableModelFailureCode(code: string): CoordinatorOutputErrorCode | undefined {
  switch (code) {
    case "ERR_MODEL_OUTPUT_EMPTY":
      return "ERR_COORDINATOR_OUTPUT_EMPTY";
    case "ERR_MODEL_OUTPUT_JSON_INVALID":
      return "ERR_COORDINATOR_OUTPUT_JSON_INVALID";
    case "ERR_MODEL_OUTPUT_TRUNCATED":
      return "ERR_COORDINATOR_OUTPUT_TRUNCATED";
    default:
      return undefined;
  }
}

function coordinatorDiagnostic(
  attempt: number,
  allowedActions: readonly ProductAction[],
  issue: {
    readonly errorCode: CoordinatorOutputErrorCode;
    readonly schemaPath?: string | undefined;
    readonly returnedAction?: string | undefined;
    readonly outputLength: number;
    readonly truncated: boolean;
  },
): CoordinatorOutputDiagnostic {
  return {
    attempt,
    maxAttempts: MAX_COORDINATOR_ATTEMPTS,
    errorCode: issue.errorCode,
    allowedActions: [...allowedActions],
    outputLength: issue.outputLength,
    truncated: issue.truncated,
    ...(issue.schemaPath !== undefined ? { schemaPath: issue.schemaPath } : {}),
    ...(issue.returnedAction !== undefined ? { returnedAction: issue.returnedAction } : {}),
  };
}

function reportCoordinatorDiagnostic(
  context: AgentContext,
  diagnostic: CoordinatorOutputDiagnostic,
): void {
  context.reportCoordinatorOutputFailure?.(diagnostic);
}

/**
 * The genuine coordinator: interprets the user's intent among the product
 * actions the deterministic host currently permits, through the agent's own
 * configured model profile. The model sees product actions and safe facts —
 * never workflow ids, secrets, or config — and its answer is re-validated
 * against the allowed set and translated deterministically afterwards. A
 * model answer can narrow behavior but can never broaden authority.
 */
export const modelDesignEngineerStrategy: DesignEngineerStrategy = async (
  task,
  context,
  manifest,
) => {
  const facts = buildRoutingFacts(task, context);

  // Hard prerequisite short-circuits: no supported route, or nothing to
  // interpret — no model call is spent on a decision that cannot exist.
  if (!facts.specificationAvailable && !facts.implementationAvailable) {
    return { ...SETUP_CLARIFICATION };
  }

  if (!readyToDecide(task)) {
    return {
      type: "request_clarification",
      question:
        "Which design should I build? Name a design file, or describe what you want made.",
      reasoningSummary: "The request named nothing to work from.",
    };
  }

  const allowedActions = allowedActionsFor(facts);

  // The same classifier the deterministic strategy uses, folded into the
  // prompt as a bounded fact.
  const classification = await classify(task, context);

  const promptFacts: ProductActionFact[] = [
    { key: "a real Figma design source is connected", value: facts.specificationAvailable },
    { key: "a registered project is selected", value: facts.projectSelected },
    { key: "the user explicitly consented this run to preparing project changes", value: facts.projectWriteConsent },
    { key: "preparing implementation changes is currently permitted", value: facts.implementationAvailable },
    ...(classification !== null
      ? [{ key: "a deterministic classifier read the request as", value: classification.taskType }]
      : []),
  ];

  const clarifications = readClarifications(task);

  let repairFeedback: ProductActionRepairFeedback | undefined;
  let decision: ProductActionDecision | undefined;

  for (let attempt = 1; attempt <= MAX_COORDINATOR_ATTEMPTS; attempt += 1) {
    if (attempt > 1 && context.signal.aborted) {
      return declineForModelFailure("ERR_MODEL_ABORTED");
    }

    const { messages, responseSchema } = buildProductActionPrompt({
      instructions: manifest.instructions,
      request: describe(task),
      allowedActions,
      facts: promptFacts,
      ...(clarifications.length > 0 ? { clarifications } : {}),
      ...(repairFeedback !== undefined ? { repairFeedback } : {}),
    });

    const result = await context.model.generate({
      messages,
      responseSchema,
      maxOutputTokens: 300,
    });

    if (result.type === "failure") {
      const errorCode = repairableModelFailureCode(result.code);
      if (errorCode === undefined) return declineForModelFailure(result.code);

      const diagnostic = coordinatorDiagnostic(attempt, allowedActions, {
        errorCode,
        outputLength: 0,
        truncated: errorCode === "ERR_COORDINATOR_OUTPUT_TRUNCATED",
      });
      reportCoordinatorDiagnostic(context, diagnostic);

      if (attempt === MAX_COORDINATOR_ATTEMPTS) {
        throw new CoordinatorOutputAttemptsExhaustedError([
          ...(repairFeedback === undefined ? [] : [repairFeedback]),
          diagnostic,
        ]);
      }
      repairFeedback = {
        attempt: diagnostic.attempt,
        maxAttempts: diagnostic.maxAttempts,
        errorCode,
        allowedActions: [...allowedActions],
      };
      continue;
    }

    const validation = validateProductActionTransport(result.output, allowedActions);
    if ("failure" in validation) {
      const diagnostic = coordinatorDiagnostic(attempt, allowedActions, validation.failure);
      reportCoordinatorDiagnostic(context, diagnostic);

      if (attempt === MAX_COORDINATOR_ATTEMPTS) {
        throw new CoordinatorOutputAttemptsExhaustedError([
          ...(repairFeedback === undefined ? [] : [repairFeedback]),
          diagnostic,
        ]);
      }
      repairFeedback = {
        attempt: diagnostic.attempt,
        maxAttempts: diagnostic.maxAttempts,
        errorCode: validation.failure.errorCode,
        allowedActions: [...allowedActions],
        ...(validation.failure.schemaPath !== undefined
          ? { schemaPath: validation.failure.schemaPath }
          : {}),
        ...(validation.failure.returnedAction !== undefined
          ? { returnedAction: validation.failure.returnedAction }
          : {}),
      };
      continue;
    }

    decision = validation.decision;
    break;
  }

  if (decision === undefined) {
    throw new CoordinatorOutputAttemptsExhaustedError(
      repairFeedback === undefined ? [] : [repairFeedback],
    );
  }

  // Deterministic translation + post-decision revalidation: even a decision
  // that passed the allowed-set check is re-checked against live
  // prerequisites before it becomes a workflow.
  if (decision.action === "create_specification") {
    if (!facts.specificationAvailable) return { ...SETUP_CLARIFICATION };
    return runFor("create_specification", task, decision.reasoningSummary);
  }

  if (decision.action === "prepare_implementation") {
    if (!facts.implementationAvailable) {
      return {
        type: "request_clarification",
        question:
          "Preparing implementation changes needs a registered project and your explicit go-ahead. Select a project and confirm when asked, or ask for a design specification instead.",
        reasoningSummary: "The model chose implementation, but its prerequisites are not in place.",
      };
    }
    return runFor("prepare_implementation", task, decision.reasoningSummary);
  }

  if (decision.action === "request_clarification") {
    return {
      type: "request_clarification",
      question: decision.question,
      reasoningSummary: decision.reasoningSummary,
    };
  }

  return {
    type: "decline",
    reason: decision.reason,
    reasoningSummary: decision.reasoningSummary,
  };
};

// ── The agent itself ─────────────────────────────────────────────

class DesignEngineerAgent implements Agent {
  public readonly manifest: AgentManifest;
  private readonly strategy: DesignEngineerStrategy;

  public constructor(manifest: AgentManifest, strategy: DesignEngineerStrategy) {
    this.manifest = manifest;
    this.strategy = strategy;
  }

  public decide(task: AgentTask, context: AgentContext): Promise<AgentDecision> {
    return this.strategy(task, context, this.manifest);
  }
}

/**
 * Builds a Design Engineer agent with an explicit strategy.
 *
 * The one place mode selection happens. There is no branch inside `decide`
 * that inspects an environment variable or guesses whether a credential is
 * configured — a caller (the CLI's composition root, or a test) decides once,
 * up front, which strategy this agent runs for its entire lifetime.
 */
export function createDesignEngineerAgent(
  strategy: DesignEngineerStrategy = deterministicDesignEngineerStrategy,
): Agent {
  return new DesignEngineerAgent(designEngineerAgentManifest, strategy);
}

/**
 * The deterministic Design Engineer, ready to register.
 *
 * The default for every test, and for any host that has not explicitly opted
 * into model mode — offline, no credential required, byte-identical to Stage
 * 36's behaviour.
 */
export const designEngineerAgent: Agent = createDesignEngineerAgent();
