import type { Capability, CapabilityContext } from "@designflow/sdk";
import { CapabilityExecutionError } from "./errors";

export interface CapabilityRunnerOptions {
  readonly timeout: number | undefined;
  readonly retryPolicy: {
    readonly maxAttempts: number;
    readonly delay: number;
  } | undefined;
}

export class CapabilityRunner {
  public async run<TInput, TOutput>(
    capability: Capability<TInput, TOutput>,
    input: unknown,
    context: CapabilityContext,
    options?: CapabilityRunnerOptions,
  ): Promise<TOutput> {
    let validatedInput: TInput;
    try {
      validatedInput = capability.inputSchema.parse(input);
    } catch (error) {
      throw new CapabilityExecutionError(
        `Input validation failed for capability: ${capability.id}`,
        { capabilityId: capability.id, attempt: 1, cause: error },
      );
    }

    const output = await this.executeWithRetry(
      capability,
      validatedInput,
      context,
      options?.retryPolicy,
      options?.timeout,
    );

    try {
      const validatedOutput = capability.outputSchema.parse(output);
      return validatedOutput;
    } catch (error) {
      throw new CapabilityExecutionError(
        `Output validation failed for capability: ${capability.id}`,
        { capabilityId: capability.id, attempt: 1, cause: error },
      );
    }
  }

  private async executeWithRetry<TInput, TOutput>(
    capability: Capability<TInput, TOutput>,
    input: TInput,
    context: CapabilityContext,
    retryPolicy: CapabilityRunnerOptions["retryPolicy"],
    timeout: number | undefined,
  ): Promise<TOutput> {
    const maxAttempts = retryPolicy?.maxAttempts ?? 1;
    const delayMs = retryPolicy?.delay ?? 0;

    if (maxAttempts <= 1) {
      return this.executeWithTimeout(capability, input, context, timeout, 1);
    }

    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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