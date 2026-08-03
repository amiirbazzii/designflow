// apps/designflow-cli/src/ui/errors.ts
import { DesignFlowError } from "@designflow/sdk";
import { ZodError } from "zod";

/**
 * Turns a thrown value into something worth reading.
 *
 * A stack trace tells a user that the program broke and nothing about what to
 * do next. Every error the CLI surfaces answers two questions instead:
 *
 *   what went wrong   — in the user's terms, not the engine's
 *   what to try next  — a command they can actually run
 *
 * Stack traces are still available, behind `DESIGNFLOW_DEBUG=1`, because "no
 * stack traces by default" must not mean "no way to diagnose this". The default
 * is for the person using DesignFlow; the flag is for whoever has to fix it.
 *
 * Mapping is by error *code*, never by matching on message text: codes are the
 * contract `DesignFlowError` publishes, and prose is not.
 */

export interface UserFacingError {
  /** What went wrong, in one line. */
  readonly problem: string;
  /** What to do about it. */
  readonly suggestion: string;
}

const LIST_WORKERS = "Run  designflow list  to see who is available.";

const SEE_SESSIONS = "Run  designflow sessions  to see its current status.";

const PACKAGING_PROBLEM =
  "This is a packaging problem rather than something you did — please report it.";

const NOTHING_STARTED_REPORT =
  "Nothing was started. Please report this — a worker should not be able to do that.";

const TRY_AGAIN = "Nothing was started. Try again — if it keeps happening, please report it.";

const DUPLICATE_COMPONENT =
  "One of them has to go — check any worker packages you have added.";

/**
 * Domain codes the CLI can say something useful about.
 *
 * An unmapped code is not a bug — it falls through to the error's own message,
 * which is written by the layer that raised it and is usually specific enough.
 * What the fallback adds is the suggestion, which domain errors do not carry.
 */
const BY_CODE: Readonly<Record<string, UserFacingError>> = {
  ERR_WORKER_NOT_FOUND: {
    problem: "No AI Worker by that name is installed.",
    suggestion: LIST_WORKERS,
  },
  ERR_WORKER_ALREADY_REGISTERED: {
    problem: "Two workers are installed under the same name.",
    suggestion:
      "One of them has to go — check any worker packages you have added.",
  },
  ERR_WORKFLOW_NOT_FOUND: {
    problem: "That worker needs a workflow this installation does not have.",
    suggestion: `Nothing was started. ${LIST_WORKERS}`,
  },
  ERR_CAPABILITY_NOT_FOUND: {
    problem: "A step in that workflow is missing its implementation.",
    suggestion:
      "This is a packaging problem rather than something you did — please report it.",
  },
  ERR_EXECUTION_NOT_FOUND: {
    problem: "That run could not be found.",
    suggestion: "Run  designflow history  to see the runs that do exist.",
  },
  ERR_NO_PENDING_APPROVAL: {
    problem: "That run is not waiting for a decision.",
    suggestion: "It has already been approved, rejected, or has finished.",
  },
  ERR_VALIDATION_FAILED: {
    problem: "The details given for that run were not usable.",
    suggestion: "Start it again and check each answer as you go.",
  },

  // Agent failures. A person hires a worker and never learns that an agent
  // decided anything on its behalf, so none of these say "agent" — an
  // unmapped code would fall through to the raw message, which names the
  // agent, the workflow it tried to reach and the allow-list it broke.
  ERR_AGENT_NOT_FOUND: {
    problem: "That worker is missing a part it needs to decide what to do.",
    suggestion: `Nothing was started. ${PACKAGING_PROBLEM}`,
  },
  ERR_AGENT_ALREADY_REGISTERED: {
    problem: "Two workers are installed with the same internal component.",
    suggestion: `Nothing was started. ${DUPLICATE_COMPONENT}`,
  },
  ERR_AGENT_RUNTIME_UNAVAILABLE: {
    problem: "That worker cannot be started in this installation.",
    suggestion: `Nothing was started. ${PACKAGING_PROBLEM}`,
  },
  ERR_AGENT_TASK_INVALID: {
    problem: "The details given for that run were not usable.",
    suggestion: "Nothing was started. Start it again and check each answer as you go.",
  },
  ERR_AGENT_DECISION_INVALID: {
    problem: "That worker could not settle on what to do, so nothing was started.",
    suggestion:
      "Try again — if it keeps happening, please report it. Nothing was written.",
  },
  ERR_AGENT_WORKFLOW_NOT_ALLOWED: {
    // A safety refusal, so it says plainly that DesignFlow stopped it. This is
    // the one the user is most entitled to hear about, and the one whose raw
    // message leaks the most.
    problem:
      "That worker tried to do something it is not permitted to do, so DesignFlow stopped it.",
    suggestion:
      "Nothing was started. Please report this — a worker should not be able to ask for that.",
  },
  ERR_AGENT_WORKFLOW_UNAVAILABLE: {
    problem: "That worker needs a workflow this installation does not have.",
    suggestion: `Nothing was started. ${LIST_WORKERS}`,
  },
  ERR_AGENT_INVOCATION_REQUEST_INVALID: {
    problem: "That worker could not put together what it needed internally.",
    suggestion: `Nothing was started. ${PACKAGING_PROBLEM}`,
  },
  ERR_AGENT_INVOCATION_OUTPUT_INVALID: {
    problem: "That worker's AI sent back something unusable.",
    suggestion: TRY_AGAIN,
  },
  ERR_AGENT_INVOCATION_FAILED: {
    problem: "That worker could not finish an internal step.",
    suggestion: TRY_AGAIN,
  },

  // Tool failures. A tool is something a worker consults while working out
  // what to do; a person never asked for one and should not have to learn the
  // word. These say what it means for their request instead — and in almost
  // every case it means nothing was started.
  ERR_AGENT_TOOL_BUDGET_EXCEEDED: {
    problem: "That worker asked for too much information at once and was stopped.",
    suggestion: NOTHING_STARTED_REPORT,
  },
  ERR_TOOL_NOT_FOUND: {
    problem: "That worker is missing something it needs to look things up.",
    suggestion: `Nothing was started. ${PACKAGING_PROBLEM}`,
  },
  ERR_TOOL_ALREADY_REGISTERED: {
    problem: "Two workers are installed with the same internal component.",
    suggestion: `Nothing was started. ${DUPLICATE_COMPONENT}`,
  },
  ERR_TOOL_NOT_ALLOWED: {
    // A refusal worth stating plainly, like its workflow counterpart.
    problem: "That worker tried to look something up it is not permitted to read.",
    suggestion: NOTHING_STARTED_REPORT,
  },
  ERR_TOOL_CALL_INVALID: {
    problem: "That worker could not look something up it needed.",
    suggestion: TRY_AGAIN,
  },
  ERR_TOOL_INPUT_INVALID: {
    problem: "That worker could not look something up it needed.",
    suggestion: TRY_AGAIN,
  },
  ERR_TOOL_OUTPUT_INVALID: {
    problem: "Something that worker looked up came back unusable.",
    suggestion: TRY_AGAIN,
  },
  ERR_TOOL_RESULT_INVALID: {
    problem: "Something that worker looked up came back unusable.",
    suggestion: TRY_AGAIN,
  },
  ERR_TOOL_TIMEOUT: {
    problem: "That worker took too long looking something up.",
    suggestion: "Nothing was started. Try again — it may just have been slow.",
  },
  ERR_TOOL_ABORTED: {
    problem: "That was cancelled before anything started.",
    suggestion: "Nothing was written. Start it again when you are ready.",
  },
  ERR_TOOL_EXECUTION_FAILED: {
    problem: "That worker could not look something up it needed.",
    suggestion: TRY_AGAIN,
  },

  // Model failures. A worker's AI is an implementation detail the same way
  // its tools and its workflow are — nobody asked for OpenRouter, a provider
  // or a model slug, so none of these say those words. The one exception is
  // the missing-credential case: setting it is the actual fix, so that one
  // names exactly what to set.
  ERR_MODEL_PROFILE_NOT_FOUND: {
    problem: "That worker's AI is not configured in this installation.",
    suggestion: `Nothing was started. ${PACKAGING_PROBLEM}`,
  },
  ERR_MODEL_PROFILE_ALREADY_REGISTERED: {
    problem: "Two workers are installed with the same internal component.",
    suggestion: `Nothing was started. ${DUPLICATE_COMPONENT}`,
  },
  ERR_MODEL_PROVIDER_NOT_FOUND: {
    problem: "That worker's AI is not configured in this installation.",
    suggestion: `Nothing was started. ${PACKAGING_PROBLEM}`,
  },
  ERR_MODEL_PROVIDER_ALREADY_REGISTERED: {
    problem: "Two workers are installed with the same internal component.",
    suggestion: `Nothing was started. ${DUPLICATE_COMPONENT}`,
  },
  ERR_MODEL_REQUEST_INVALID: {
    problem: "That worker could not put together what it needed to ask its AI.",
    suggestion: TRY_AGAIN,
  },
  ERR_MODEL_RESPONSE_INVALID: {
    problem: "That worker's AI sent back something unusable.",
    suggestion: TRY_AGAIN,
  },
  ERR_MODEL_OUTPUT_INVALID: {
    problem: "That worker's AI sent back something unusable.",
    suggestion: TRY_AGAIN,
  },
  ERR_MODEL_AUTHENTICATION: {
    problem: "That worker's AI rejected the configured credential.",
    suggestion:
      "Nothing was started. Check OPENROUTER_API_KEY, or report this if it looks correct.",
  },
  ERR_MODEL_RATE_LIMITED: {
    problem: "That worker's AI is being rate-limited right now.",
    suggestion: "Nothing was started. Wait a moment and try again.",
  },
  ERR_MODEL_UNAVAILABLE: {
    problem: "That worker's AI is temporarily unavailable.",
    suggestion: "Nothing was started. Try again shortly.",
  },
  ERR_MODEL_TIMEOUT: {
    problem: "That worker's AI took too long to respond.",
    suggestion: "Nothing was started. Try again — it may just have been slow.",
  },
  ERR_MODEL_ABORTED: {
    problem: "That was cancelled before anything started.",
    suggestion: "Nothing was written. Start it again when you are ready.",
  },
  ERR_MODEL_PROVIDER_FAILED: {
    problem: "That worker's AI could not be reached.",
    suggestion: TRY_AGAIN,
  },
  ERR_MODEL_CONFIGURATION_INVALID: {
    problem: "That worker's AI is configured incorrectly.",
    suggestion:
      "Nothing was started. Check your local configuration, or report this.",
  },
  ERR_MODEL_API_KEY_MISSING: {
    // The one code allowed to name the real thing: setting the credential is
    // the actual fix, and a person cannot act on "a credential is missing"
    // without knowing which one.
    problem: "OpenRouter is not configured for that worker's AI.",
    suggestion: "Nothing was started. Set OPENROUTER_API_KEY and try again.",
  },
  ERR_AGENT_MODEL_BUDGET_EXCEEDED: {
    problem: "That worker asked its AI for too much at once and was stopped.",
    suggestion: NOTHING_STARTED_REPORT,
  },

  // Session failures. A session is the conversation behind a clarifying
  // question, and the vocabulary here matches what `designflow sessions`
  // already shows — never "agent", never a decision type, never an internal
  // status code.
  ERR_SESSION_NOT_FOUND: {
    problem: "No conversation by that id was found.",
    suggestion: SEE_SESSIONS,
  },
  ERR_SESSION_ALREADY_EXISTS: {
    problem: "Two conversations were started under the same id.",
    suggestion: `Nothing was started. ${PACKAGING_PROBLEM}`,
  },
  ERR_SESSION_INVALID: {
    problem: "That request could not be understood.",
    suggestion: TRY_AGAIN,
  },
  ERR_SESSION_STATE_INVALID: {
    problem: "That conversation cannot be changed the way you asked.",
    suggestion: `Nothing was started. ${SEE_SESSIONS}`,
  },
  ERR_SESSION_NOT_WAITING: {
    problem: "That conversation is not waiting for an answer.",
    suggestion: `It has already finished or was cancelled. ${SEE_SESSIONS}`,
  },
  ERR_SESSION_EXPIRED: {
    problem: "That conversation has expired.",
    suggestion: "Nothing was started. Run the worker again to start a new one.",
  },
  ERR_SESSION_TURN_LIMIT_EXCEEDED: {
    problem: "That conversation asked too many questions and was stopped.",
    suggestion: "Nothing was started. Run the worker again with more detail up front.",
  },
  ERR_SESSION_ANSWER_INVALID: {
    problem: "That answer could not be recorded.",
    suggestion: TRY_AGAIN,
  },
  ERR_SESSION_CANCELLED: {
    problem: "That conversation was cancelled.",
    suggestion: "Nothing was started. Run the worker again to start a new one.",
  },
  ERR_SESSION_STORE_FAILED: {
    problem: "DesignFlow could not save that conversation.",
    suggestion:
      "Nothing was started. Check available disk space, or report this if it keeps happening.",
  },
  ERR_SESSION_CONFLICT: {
    problem: "That conversation had already moved on by the time this reached it.",
    suggestion: `Nothing was started. ${SEE_SESSIONS}`,
  },

  // Project failures. Vocabulary matches what `designflow projects` already
  // shows — a project, its path, its facts — never a store name or a version.
  ERR_PROJECT_NOT_FOUND: {
    problem: "No project with that id was found.",
    suggestion: "Run  designflow projects  to see the ones that do exist.",
  },
  ERR_PROJECT_ALREADY_EXISTS: {
    problem: "Two projects were registered under the same id.",
    suggestion: PACKAGING_PROBLEM,
  },
  ERR_PROJECT_INVALID: {
    problem: "That project request could not be understood.",
    suggestion: TRY_AGAIN,
  },
  ERR_PROJECT_CONFLICT: {
    problem: "That project was changed by something else at the same time.",
    suggestion: TRY_AGAIN,
  },
  ERR_PROJECT_PATH_INVALID: {
    problem: "That project path could not be used.",
    suggestion: "Check that the path exists and is readable, then try again.",
  },
  ERR_PROJECT_CONTEXT_NOT_FOUND: {
    problem: "That project has no recorded facts yet.",
    suggestion: "Inspect it with  designflow projects inspect <project-id>",
  },
  ERR_PROJECT_CONTEXT_INVALID: {
    problem: "That project's facts could not be updated.",
    suggestion: TRY_AGAIN,
  },
  ERR_PROJECT_CONTEXT_CONFLICT: {
    problem: "That project's facts were changed by something else at the same time.",
    suggestion: TRY_AGAIN,
  },
  ERR_PROJECT_CONTEXT_TOO_LARGE: {
    problem: "That project has recorded more facts than DesignFlow keeps.",
    suggestion: "Remove some facts, or report this if the project is not unusually large.",
  },
  ERR_PROJECT_FACT_INVALID: {
    problem: "That fact could not be recorded.",
    suggestion: TRY_AGAIN,
  },

  // Memory failures. A person only ever hears about memory in the vocabulary
  // `designflow memory` already uses — "remembered", "scope", "proposal" —
  // never a raw scope enum value or an internal agent id.
  ERR_MEMORY_NOT_FOUND: {
    problem: "No memory with that id was found.",
    suggestion: "Run  designflow memory  to see what is remembered.",
  },
  ERR_MEMORY_ALREADY_EXISTS: {
    problem: "Two memories were recorded under the same id.",
    suggestion: PACKAGING_PROBLEM,
  },
  ERR_MEMORY_INVALID: {
    problem: "That could not be remembered.",
    suggestion: "Check the value given — DesignFlow will not remember anything that looks like a credential.",
  },
  ERR_MEMORY_CONFLICT: {
    problem: "That memory was changed by something else at the same time.",
    suggestion: TRY_AGAIN,
  },
  ERR_MEMORY_SCOPE_INVALID: {
    problem: "That scope needs more detail — which project, or which agent.",
    suggestion: "See  designflow memory add --help  for what each scope needs.",
  },
  ERR_MEMORY_EXPIRED: {
    problem: "That memory has expired.",
    suggestion: "Nothing was used from it.",
  },
  ERR_MEMORY_REVOKED: {
    problem: "That memory has been revoked.",
    suggestion: "Nothing was used from it.",
  },
  ERR_MEMORY_APPROVAL_REQUIRED: {
    problem: "That proposal needs to be approved by someone other than whoever suggested it.",
    suggestion: "Nothing was remembered.",
  },
  ERR_MEMORY_PROPOSAL_NOT_FOUND: {
    problem: "No proposal with that id was found.",
    suggestion: "Run  designflow memory proposals  to see what is waiting.",
  },
  ERR_MEMORY_PROPOSAL_INVALID: {
    problem: "That proposal could not be understood.",
    suggestion: TRY_AGAIN,
  },
  ERR_MEMORY_PROPOSAL_EXPIRED: {
    problem: "That proposal has expired.",
    suggestion: "Nothing was remembered.",
  },
  ERR_MEMORY_PROPOSAL_STATE_INVALID: {
    problem: "That proposal was already approved or rejected.",
    suggestion: "Run  designflow memory proposals  to see what is still waiting.",
  },

  // Store failures. The store is `~/.designflow`'s single JSON document — a
  // person never chose it and should not have to learn its name, but these
  // are the two failures where the raw message is the most useful thing
  // available: it names the exact file(s) involved.
  ERR_STORE_CORRUPTED: {
    problem: "DesignFlow's local data file could not be read and has been moved aside.",
    suggestion:
      "A fresh, empty store will be created. The original file was kept next to it in case you need to recover anything — set DESIGNFLOW_DEBUG=1 to see its exact path.",
  },
  ERR_STORE_LOCKED: {
    problem: "DesignFlow's local data file is in use by another DesignFlow process.",
    suggestion:
      "Wait for the other command to finish and try again. If nothing else is actually running, it may be a leftover lock from a crash — set DESIGNFLOW_DEBUG=1 to see its exact path and remove it.",
  },
};

/**
 * Filesystem failures, which are the most likely thing to go wrong on a real
 * machine and the least likely to be self-explanatory.
 */
const BY_SYSCALL: Readonly<Record<string, UserFacingError>> = {
  EACCES: {
    problem: "DesignFlow could not read or write its own directory.",
    suggestion:
      "Check the permissions on ~/.designflow, or set DESIGNFLOW_HOME to somewhere writable.",
  },
  EPERM: {
    problem: "DesignFlow was not permitted to write to its own directory.",
    suggestion:
      "Check the permissions on ~/.designflow, or set DESIGNFLOW_HOME to somewhere writable.",
  },
  ENOSPC: {
    problem: "There is no space left on the disk.",
    suggestion: "Free some space and try again — nothing was saved.",
  },
  ENOTDIR: {
    problem: "DesignFlow's directory path runs through a file, not a folder.",
    suggestion:
      "Check DESIGNFLOW_HOME — one of the names in that path is a file.",
  },
  EROFS: {
    problem: "DesignFlow's directory is on a read-only filesystem.",
    suggestion: "Set DESIGNFLOW_HOME to a writable location and try again.",
  },
};

function codeOf(error: unknown): string | undefined {
  if (error instanceof DesignFlowError) return error.code;

  // Node's fs errors carry `code` without extending a class we can name.
  if (typeof error === "object" && error !== null && "code" in error) {
    const code: unknown = (error as { code: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }

  return undefined;
}

export function explainError(error: unknown): UserFacingError {
  const code = codeOf(error);

  if (code !== undefined) {
    const known = BY_CODE[code] ?? BY_SYSCALL[code];
    if (known !== undefined) return known;
  }

  // A validation library's own error, escaping uncaught from some call this
  // file did not anticipate. Its `.message` is a JSON dump of field paths and
  // codes — internal shape, not a sentence — so it gets the same generic
  // treatment a `DesignFlowError` with no mapped code would, rather than
  // reaching a person as raw schema internals.
  if (error instanceof ZodError) {
    return {
      problem: "Something given to that command was not usable.",
      suggestion:
        "Try again — if it keeps happening, set DESIGNFLOW_DEBUG=1 to see the full details.",
    };
  }

  // Only an Error's message or a thrown string is worth showing. Anything else
  // stringifies to noise — `String(undefined)` is the word "undefined", which
  // tells a user nothing and looks like a bug in the message itself.
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  return {
    problem: message.length > 0 ? message : "Something went wrong.",
    suggestion:
      "Try  designflow --help  , or set DESIGNFLOW_DEBUG=1 to see the full details.",
  };
}

/** True when the user has asked for stack traces. */
export function debugEnabled(): boolean {
  const flag = process.env.DESIGNFLOW_DEBUG;
  return flag !== undefined && flag !== "" && flag !== "0" && flag !== "false";
}

/**
 * The block printed when a command fails.
 *
 * `debug` is a parameter rather than an environment read so a test can assert
 * both shapes without mutating the process.
 */
export function formatError(error: unknown, debug = debugEnabled()): string {
  const { problem, suggestion } = explainError(error);
  const lines = ["", problem, "", suggestion, ""];

  if (debug) {
    lines.push(
      error instanceof Error && error.stack !== undefined
        ? error.stack
        : String(error),
      "",
    );
  }

  return lines.join("\n");
}
