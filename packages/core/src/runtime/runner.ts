// packages/core/src/runtime/runner.ts
import {
  type Capability,
  type CapabilityContext,
  type ExecutionEvent,
  type ExecutionEventPublisher,
  executionEventSchema,
  DesignFlowError,
  boundedAttemptDiagnostics,
  boundedModelCandidates,
} from "@designflow/sdk";

import { CapabilityExecutionError } from "./errors";

export interface CapabilityRunnerOptions {
  readonly timeout: number | undefined;
  readonly retryPolicy: {
    readonly maxAttempts: number;
    readonly delay: number;
  } | undefined;
}

export class CapabilityRunner {
  private readonly eventPublisher: ExecutionEventPublisher;

  public constructor(eventPublisher: ExecutionEventPublisher) {
    this.eventPublisher = eventPublisher;
  }

  public async run<TInput, TOutput>(
    capability: Capability<TInput, TOutput>,
    input: unknown,
    context: CapabilityContext,
    options?: CapabilityRunnerOptions,
  ): Promise<TOutput> {
    const maxAttempts = options?.retryPolicy?.maxAttempts ?? 1;

    await this.publishEvent(context.executionId, "capability.started", {
      capabilityId: capability.id,
      attempt: 1,
      maxAttempts,
    });

    let validatedInput: TInput;
    try {
      validatedInput = capability.inputSchema.parse(input);
    } catch (error) {
      await this.publishEvent(context.executionId, "capability.failed", {
        capabilityId: capability.id,
        attempt: 1,
        error: "Input validation failed",
      });
      throw new CapabilityExecutionError(
        `Input validation failed for capability: ${capability.id}`,
        { capabilityId: capability.id, attempt: 1, cause: error },
      );
    }

    let output: TOutput;
    let lastAttempt = 1;

    try {
      const result = await this.executeWithRetry(
        capability,
        validatedInput,
        context,
        options?.retryPolicy,
        options?.timeout,
        (attempt) => {
          lastAttempt = attempt;
        },
      );
      output = result;
    } catch (error) {
      const attemptDiagnostics =
        error instanceof DesignFlowError
          ? boundedAttemptDiagnostics(error.metadata["failures"])
          : undefined;
      const retryAfterSeconds =
        error instanceof DesignFlowError ? boundedRetryAfterSeconds(error.metadata["retryAfterSeconds"]) : undefined;
      // Ordered-model-policy provenance, carried the same bounded way attempt
      // diagnostics are: one stable code for the run, plus per-candidate facts
      // for the person who has to act on it.
      const modelCandidates =
        error instanceof DesignFlowError ? boundedModelCandidates(error.metadata["modelCandidates"]) : undefined;
      await this.publishEvent(context.executionId, "capability.failed", {
        capabilityId: capability.id,
        attempt: lastAttempt,
        error: error instanceof Error ? error.message : String(error),
        ...(error instanceof DesignFlowError ? { errorCode: error.code } : {}),
        ...(attemptDiagnostics !== undefined ? { attemptDiagnostics } : {}),
        ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
        ...(modelCandidates !== undefined ? { modelCandidates } : {}),
      });
      throw error;
    }

    try {
      const validatedOutput = capability.outputSchema.parse(output);

      await this.publishEvent(context.executionId, "capability.completed", {
        capabilityId: capability.id,
        attempt: lastAttempt,
      });

      return validatedOutput;
    } catch (error) {
      await this.publishEvent(context.executionId, "capability.failed", {
        capabilityId: capability.id,
        attempt: lastAttempt,
        error: "Output validation failed",
      });
      throw new CapabilityExecutionError(
        `Output validation failed for capability: ${capability.id}`,
        { capabilityId: capability.id, attempt: lastAttempt, cause: error },
      );
    }
  }

  private async publishEvent(
    executionId: string,
    type: ExecutionEvent["type"],
    payload?: Record<string, unknown>,
  ): Promise<void> {
    const event = executionEventSchema.parse({
      id: crypto.randomUUID(),
      executionId,
      type,
      timestamp: Date.now(),
      payload,
    });
    await this.eventPublisher.publish(event);
  }

  private async executeWithRetry<TInput, TOutput>(
    capability: Capability<TInput, TOutput>,
    input: TInput,
    context: CapabilityContext,
    retryPolicy: CapabilityRunnerOptions["retryPolicy"],
    timeout: number | undefined,
    onAttempt: (attempt: number) => void,
  ): Promise<TOutput> {
    const maxAttempts = retryPolicy?.maxAttempts ?? 1;
    const delayMs = retryPolicy?.delay ?? 0;

    if (maxAttempts <= 1) {
      onAttempt(1);
      return this.executeWithTimeout(capability, input, context, timeout, 1);
    }

    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      onAttempt(attempt);

      try {
        const result = await this.executeWithTimeout(
          capability,
          input,
          context,
          timeout,
          attempt,
        );
        return result;
      } catch (error) {
        lastError = error;
        if (attempt < maxAttempts) {
          await this.sleepWithSignal(delayMs, context.signal);
        }
      }
    }

    throw new CapabilityExecutionError(
      `Capability execution failed after ${maxAttempts} attempts`,
      {
        capabilityId: capability.id,
        attempt: maxAttempts,
        cause: lastError,
      },
    );
  }

  private async executeWithTimeout<TInput, TOutput>(
    capability: Capability<TInput, TOutput>,
    input: TInput,
    context: CapabilityContext,
    timeout: number | undefined,
    attempt: number,
  ): Promise<TOutput> {
    if (timeout === undefined || timeout <= 0) {
      return capability.execute(context, input);
    }

    const controller = new AbortController();

    const abortParent = (): void => {
      controller.abort();
    };

    if (context.signal.aborted) {
      controller.abort();
    } else {
      context.signal.addEventListener("abort", abortParent, { once: true });
    }

    const runtimeContext: CapabilityContext = {
      ...context,
      signal: controller.signal,
    };

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    try {
      const result = await Promise.race([
        capability.execute(runtimeContext, input),
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            controller.abort();
            reject(
              new CapabilityExecutionError(
                `Capability execution timed out after ${timeout}ms`,
                {
                  capabilityId: capability.id,
                  attempt,
                  cause: "timeout",
                },
              ),
            );
          }, timeout);
        }),
      ]);

      return result;
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
      if (!controller.signal.aborted) {
        controller.abort();
      }
      context.signal.removeEventListener("abort", abortParent);
    }
  }

  private async sleepWithSignal(
    ms: number,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted) {
      throw new CapabilityExecutionError(
        "Execution cancelled during retry delay",
        { cause: "aborted" },
      );
    }

    return new Promise<void>((resolve, reject) => {
      const handle = setTimeout(() => {
        resolve();
      }, ms);

      const onAbort = (): void => {
        clearTimeout(handle);
        reject(
          new CapabilityExecutionError(
            "Execution cancelled during retry delay",
            { cause: "aborted" },
          ),
        );
      };

      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
}

const MAX_RETRY_AFTER_SECONDS = 86_400;

function boundedRetryAfterSeconds(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return Math.min(Math.ceil(value), MAX_RETRY_AFTER_SECONDS);
}
