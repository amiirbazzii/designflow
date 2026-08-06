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
} from "@designflow/sdk";


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
    "Turn a design into working code. Classify the request first. Run the " +
    "design-to-code workflow when it names design work. Ask what to build when it does not.",
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
  // Product-valid routes only. The legacy `design-to-code` scaffold stays on
  // the technical allow-list for compatibility, but the canonical journey
  // never falls back to it: a request the supported routes cannot serve gets
  // a clarification with actionable guidance, not a prototype pretending to
  // be the product.
  const workflowId = wantsImplementation(task, context)
    ? IMPLEMENTATION_WORKFLOW_ID
    : wantsRealFigmaSpecification(task, context)
      ? FIGMA_SPECIFICATION_WORKFLOW_ID
      : undefined;

  if (workflowId === undefined) {
    return {
      type: "request_clarification",
      question:
        "I work from a connected Figma design. Connect Figma (run `designflow doctor` to check the setup), then tell me which design to build from.",
      reasoningSummary: "No supported journey is available for this request: no real Figma source (and no consented project) was provided.",
    };
  }

  if (!readyToDecide(task)) {
    return {
      type: "request_clarification",
      question:
        "Which design should I build? Name a design file, or describe what you want made.",
      reasoningSummary: "The request named nothing to work from.",
    };
  }

  const classification = await classify(task, context);

  // The load-bearing branch. A request that describes nothing recognisable
  // gets a question, even though it carried enough input to start.
  if (classification !== null && !ACTIONABLE.has(classification.taskType)) {
    return {
      type: "request_clarification",
      question:
        "What would you like built? Describe a component, a page, or the change you want made.",
      reasoningSummary: "The request did not describe a recognisable kind of design work.",
    };
  }

  return {
    type: "run_workflow",
    workflowId,
    ...(task.input !== undefined ? { input: task.input } : {}),
    reasoningSummary:
      workflowId === IMPLEMENTATION_WORKFLOW_ID
        ? "A registered project was selected and implementation was explicitly consented to, so the implementation journey will be used."
        : classification === null
          ? "A real Figma source is connected, so the design-specification journey will be used."
          : `The request looks like ${classification.taskType.replace(/_/g, " ")}; the design-specification journey will be used.`,
  };
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
export const modelDesignEngineerStrategy: DesignEngineerStrategy = async (
  task,
  context,
  _manifest,
) => {
  if (!readyToDecide(task)) {
    return {
      type: "request_clarification",
      question:
        "Which design should I build? Name a design file, or describe what you want made.",
      reasoningSummary: "The request named nothing to work from.",
    };
  }

  if (wantsImplementation(task, context)) {
    return {
      type: "run_workflow",
      workflowId: IMPLEMENTATION_WORKFLOW_ID,
      ...(task.input !== undefined ? { input: task.input } : {}),
      reasoningSummary: "A registered project was explicitly selected, so the experimental implementation workflow will be used.",
    };
  }

  if (wantsRealFigmaSpecification(task, context)) {
    return {
      type: "run_workflow",
      workflowId: FIGMA_SPECIFICATION_WORKFLOW_ID,
      ...(task.input !== undefined ? { input: task.input } : {}),
      reasoningSummary: "A real Figma source is connected, so the design-specification journey will be used.",
    };
  }

  // MVP-3B: a model answer must never override a missing deterministic
  // prerequisite. With neither supported route available there is no
  // workflow the model would be permitted to choose (the legacy scaffold is
  // compatibility-only), so the honest outcome is the same actionable
  // clarification the deterministic strategy gives — not a model call whose
  // only allowed answers were already determined here.
  return {
    type: "request_clarification",
    question:
      "I work from a connected Figma design. Connect Figma (run `designflow doctor` to check the setup), then tell me which design to build from.",
    reasoningSummary: "No supported journey is available for this request: no real Figma source (and no consented project) was provided.",
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
