// apps/designflow-cli/src/services/broken-pipe.test.ts
import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { BrokenPipeCoordinator, type PipeErrorSource } from "./broken-pipe";

function epipe(): Error {
  const error = new Error("write EPIPE");
  (error as { code?: string }).code = "EPIPE";
  return error;
}

function harness(): {
  stdout: EventEmitter & PipeErrorSource;
  stderr: EventEmitter & PipeErrorSource;
  coordinator: BrokenPipeCoordinator;
  broken: number;
  unrelated: { stream: string; message: string }[];
} {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const state = { broken: 0, unrelated: [] as { stream: string; message: string }[] };
  const coordinator = new BrokenPipeCoordinator({
    stdout,
    stderr,
    onBrokenPipe: () => { state.broken += 1; },
    onUnrelatedError: (stream, error) => { state.unrelated.push({ stream, message: error.message }); },
  });
  return {
    stdout,
    stderr,
    coordinator,
    get broken() { return state.broken; },
    get unrelated() { return state.unrelated; },
  };
}

describe("BrokenPipeCoordinator", () => {
  test("stdout EPIPE is recognized and marks the stream broken", () => {
    const h = harness();
    h.coordinator.install();
    h.stdout.emit("error", epipe());
    expect(h.coordinator.isBroken("stdout")).toBe(true);
    expect(h.coordinator.isBroken("stderr")).toBe(false);
    expect(h.broken).toBe(1);
  });

  test("stderr EPIPE is recognized without writing anywhere", () => {
    const h = harness();
    h.coordinator.install();
    h.stderr.emit("error", epipe());
    expect(h.coordinator.isBroken("stderr")).toBe(true);
    expect(h.broken).toBe(1);
  });

  test("unrelated stream errors are not swallowed", () => {
    const h = harness();
    h.coordinator.install();
    h.stdout.emit("error", new Error("disk full"));
    expect(h.unrelated).toEqual([{ stream: "stdout", message: "disk full" }]);
    expect(h.coordinator.isBroken("stdout")).toBe(false);
    expect(h.broken).toBe(0);
  });

  test("the default unrelated-error behavior rethrows", () => {
    const stdout = new EventEmitter();
    const coordinator = new BrokenPipeCoordinator({ stdout, stderr: new EventEmitter() });
    coordinator.install();
    // EventEmitter delivers listener throws synchronously to emit().
    expect(() => stdout.emit("error", new Error("genuine failure"))).toThrow("genuine failure");
  });

  test("repeated EPIPE across both streams triggers cancellation exactly once", () => {
    const h = harness();
    h.coordinator.install();
    h.stdout.emit("error", epipe());
    h.stdout.emit("error", epipe());
    h.stderr.emit("error", epipe());
    expect(h.broken).toBe(1);
    expect(h.coordinator.isBroken("stdout")).toBe(true);
    expect(h.coordinator.isBroken("stderr")).toBe(true);
  });

  test("listeners are removed on uninstall and never accumulate across invocations", () => {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    for (let i = 0; i < 20; i++) {
      const coordinator = new BrokenPipeCoordinator({ stdout, stderr });
      coordinator.install();
      coordinator.install();
      expect(stdout.listenerCount("error")).toBe(1);
      expect(stderr.listenerCount("error")).toBe(1);
      coordinator.uninstall();
      coordinator.uninstall();
    }
    expect(stdout.listenerCount("error")).toBe(0);
    expect(stderr.listenerCount("error")).toBe(0);
  });
});
