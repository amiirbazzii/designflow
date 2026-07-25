import type { Logger } from "@designflow/sdk";

export class CliLogger implements Logger {
  public info(msg: string, ...args: unknown[]): void {
    console.log(msg, ...args);
  }

  public warn(msg: string, ...args: unknown[]): void {
    console.warn(msg, ...args);
  }

  public error(msg: string, ...args: unknown[]): void {
    console.error(msg, ...args);
  }

  public debug(msg: string, ...args: unknown[]): void {
    if (process.env.DESIGNFLOW_DEBUG) {
      console.log(`[debug] ${msg}`, ...args);
    }
  }
}
