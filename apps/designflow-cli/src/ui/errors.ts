// apps/designflow-cli/src/ui/errors.ts
import { DesignFlowError } from "@designflow/sdk";

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
    suggestion: LIST_WORKERS,
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
