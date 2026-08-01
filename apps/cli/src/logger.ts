// apps/cli/src/logger.ts
import type { Logger } from "@designflow/sdk";

export class CliLogger implements Logger {
  public info(msg: string, ...args: unknown[]): void {
    // eslint-disable-next-line no-console -- this class is the concrete Logger implementation; console is its output sink.
    console.log(msg, ...args);
  }

  public warn(msg: string, ...args: unknown[]): void {
    // eslint-disable-next-line no-console -- this class is the concrete Logger implementation; console is its output sink.
    console.warn(msg, ...args);
  }

  public error(msg: string, ...args: unknown[]): void {
    // eslint-disable-next-line no-console -- this class is the concrete Logger implementation; console is its output sink.
    console.error(msg, ...args);
  }

  public debug(msg: string, ...args: unknown[]): void {
    if (process.env.DESIGNFLOW_DEBUG) {
      // eslint-disable-next-line no-console -- this class is the concrete Logger implementation; console is its output sink.
      console.log(`[debug] ${msg}`, ...args);
    }
  }
}
