import { spawn } from "node:child_process";
import { implementationValidationReportSchema, projectImplementationContextV1Schema, type ImplementationValidationReport } from "@designflow/sdk";
import { ImplementationError } from "./errors";

export interface ValidationOptions { timeoutMs?: number; maxOutputBytes?: number; signal?: AbortSignal; }

const CHECK_NAMES = ["format", "typecheck", "lint", "build", "test"] as const;
const redact = (value: string) => value.replace(/([A-Za-z0-9_-]*(?:token|secret|password|credential)[A-Za-z0-9_-]*\s*[=:]\s*)[^\s\n]+/gi, "$1[REDACTED]");

interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly duration: number;
  readonly timedOut: boolean;
  readonly truncated: boolean;
}

async function run(executable: string, args: string[], cwd: string, options: ValidationOptions): Promise<CommandResult> {
  return await new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(executable, args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const limit = options.maxOutputBytes ?? 100_000;
    let stdout = "";
    let stderr = "";
    let bytes = 0;
    let timedOut = false;
    let truncated = false;
    let settled = false;

    const append = (target: "stdout" | "stderr", chunk: Buffer): void => {
      if (truncated) return;
      const remaining = Math.max(0, limit - bytes);
      const text = chunk.subarray(0, remaining).toString();
      bytes += Buffer.byteLength(text);
      if (target === "stdout") stdout += text;
      else stderr += text;
      if (bytes >= limit) {
        truncated = true;
        child.kill();
      }
    };
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, options.timeoutMs ?? 120_000);
    const abort = (): void => { child.kill(); };
    options.signal?.addEventListener("abort", abort, { once: true });
    // A signal that aborted before the listener attached still kills the
    // child — otherwise a pre-cancelled validation would run to completion.
    if (options.signal?.aborted === true) child.kill();
    child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));
    child.on("error", (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      resolve({ code: code ?? 1, stdout, stderr, duration: Date.now() - started, timedOut, truncated });
    });
  });
}

export async function validateProject(rawContext: unknown, root: string, options: ValidationOptions = {}): Promise<ImplementationValidationReport["checks"]> {
  const context = projectImplementationContextV1Schema.parse(rawContext);
  const checks: ImplementationValidationReport["checks"] = [];
  const commands = [context.commands.format, context.commands.typecheck, context.commands.lint, context.commands.build, context.commands.test];

  // Cancellation is a hard stop, never a partial verdict: a cancelled
  // validation must not produce a report at all (a killed required check
  // reads as "failed" and an aborted optional check could read as "passed
  // overall"), so the caller's rollback-on-throw path handles it instead.
  const throwIfCancelled = (): void => {
    if (options.signal?.aborted === true) {
      throw new ImplementationError(
        "ERR_VALIDATION_CANCELLED",
        "Project validation was cancelled before completion.",
      );
    }
  };

  for (const [index, command] of commands.entries()) {
    throwIfCancelled();
    const name = CHECK_NAMES[index]! as "format" | "typecheck" | "lint" | "build" | "test";
    if (!command) {
      checks.push({ name, status: "unavailable", required: false, summary: "No safe project-declared command was found." });
      continue;
    }
    try {
      const result = await run(command.executable, command.args, root, options);
      throwIfCancelled();
      const output = redact(`${result.stdout}${result.stderr}`.slice(-2_000));
      const summary = result.timedOut
        ? "Command timed out."
        : result.code === 0
          ? "Command completed successfully."
          : output || "Command failed.";
      checks.push({
        name,
        status: result.code === 0 ? "passed" : "failed",
        required: command.required,
        command: [command.executable, ...command.args],
        commandReference: [command.executable, ...command.args].join(" "),
        exitCode: result.code,
        durationMs: result.duration,
        timedOut: result.timedOut,
        stdout: redact(result.stdout.slice(-2_000)),
        stderr: redact(result.stderr.slice(-2_000)),
        ...(result.truncated ? { summary: `${summary} Output was bounded.` } : { summary }),
      });
    } catch (error) {
      if (error instanceof ImplementationError) throw error;
      checks.push({ name, status: "failed", required: command.required, command: [command.executable, ...command.args], commandReference: [command.executable, ...command.args].join(" "), summary: "Command could not be started." });
    }
  }
  return checks;
}

export function makeValidationReport(input: Omit<ImplementationValidationReport, "schemaVersion">): ImplementationValidationReport { return implementationValidationReportSchema.parse({ schemaVersion: "1", ...input }); }
