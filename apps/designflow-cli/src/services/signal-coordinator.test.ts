// apps/designflow-cli/src/services/signal-coordinator.test.ts
import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import {
  INTERRUPT_EXIT_CODE,
  SignalCoordinator,
  type SignalSource,
} from "./signal-coordinator";

/** A fake process: real EventEmitter semantics, no real signals. */
function fakeSource(): EventEmitter & SignalSource {
  return new EventEmitter();
}

function coordinator(source: SignalSource & EventEmitter): {
  coordinator: SignalCoordinator;
  notices: string[];
  forcedExits: number[];
} {
  const notices: string[] = [];
  const forcedExits: number[] = [];
  return {
    coordinator: new SignalCoordinator({
      source,
      notify: (line) => notices.push(line),
      forceExit: (code) => forcedExits.push(code),
    }),
    notices,
    forcedExits,
  };
}

describe("SignalCoordinator", () => {
  test("no signal: the operation's own exit code is returned", async () => {
    const source = fakeSource();
    const { coordinator: c } = coordinator(source);
    const code = await c.run(async (signal) => {
      expect(signal.aborted).toBe(false);
      return 0;
    });
    expect(code).toBe(0);
  });

  test("first SIGINT aborts the root signal exactly once, without forcing exit", async () => {
    const source = fakeSource();
    const { coordinator: c, forcedExits, notices } = coordinator(source);

    let observedAbortEvents = 0;
    const code = await c.run(async (signal) => {
      signal.addEventListener("abort", () => { observedAbortEvents += 1; });
      source.emit("SIGINT");
      source.emit("SIGINT");
      return 0;
    });

    // Two emissions: one abort, one forced-exit request — never two aborts.
    expect(observedAbortEvents).toBe(1);
    expect(code).toBe(INTERRUPT_EXIT_CODE);
    expect(forcedExits).toEqual([INTERRUPT_EXIT_CODE]);
    expect(notices.length).toBe(2);
  });

  test("a single interrupt yields exit 130 and no forced exit", async () => {
    const source = fakeSource();
    const { coordinator: c, forcedExits } = coordinator(source);
    const code = await c.run(async (signal) => {
      source.emit("SIGINT");
      expect(signal.aborted).toBe(true);
      return 0;
    });
    expect(code).toBe(INTERRUPT_EXIT_CODE);
    expect(forcedExits).toEqual([]);
  });

  test("second SIGINT requests forced exit 130 with one concise warning", async () => {
    const source = fakeSource();
    const { coordinator: c, forcedExits, notices } = coordinator(source);
    await c.run(async () => {
      source.emit("SIGINT");
      source.emit("SIGINT");
      source.emit("SIGINT");
      return 0;
    });
    expect(forcedExits).toEqual([INTERRUPT_EXIT_CODE]);
    expect(notices.filter((n) => n.includes("Force"))).toHaveLength(1);
  });

  test("handlers are removed after success, failure, and cancellation", async () => {
    const source = fakeSource();

    const { coordinator: ok } = coordinator(source);
    await ok.run(async () => 0);
    expect(source.listenerCount("SIGINT")).toBe(0);
    expect(source.listenerCount("SIGTERM")).toBe(0);

    const { coordinator: failing } = coordinator(source);
    await expect(
      failing.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(source.listenerCount("SIGINT")).toBe(0);

    const { coordinator: cancelled } = coordinator(source);
    await cancelled.run(async () => {
      source.emit("SIGINT");
      return 0;
    });
    expect(source.listenerCount("SIGINT")).toBe(0);
    expect(source.listenerCount("SIGTERM")).toBe(0);
  });

  test("repeated operations never accumulate listeners", async () => {
    const source = fakeSource();
    for (let i = 0; i < 25; i++) {
      const { coordinator: c } = coordinator(source);
      const running = c.run(async () => {
        expect(source.listenerCount("SIGINT")).toBe(1);
        return 0;
      });
      await running;
    }
    expect(source.listenerCount("SIGINT")).toBe(0);
  });

  test("an interrupt before the operation starts is still observed", async () => {
    const source = fakeSource();
    const { coordinator: c } = coordinator(source);
    c.interrupt();
    const code = await c.run(async (signal) => {
      expect(signal.aborted).toBe(true);
      return 0;
    });
    expect(code).toBe(INTERRUPT_EXIT_CODE);
  });

  test("SIGTERM behaves like SIGINT for graceful shutdown", async () => {
    const source = fakeSource();
    const { coordinator: c } = coordinator(source);
    const code = await c.run(async (signal) => {
      source.emit("SIGTERM");
      expect(signal.aborted).toBe(true);
      return 0;
    });
    expect(code).toBe(INTERRUPT_EXIT_CODE);
  });
});
