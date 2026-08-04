import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectStateFile } from "./state-health";

const current = {
  version: 1,
  executions: {}, lifecycleEvents: [], checkpoints: [], approvals: {}, events: [],
  artifacts: {}, versions: [], relations: [], payloads: {}, traces: {}, sessions: {},
  projects: {}, projectContexts: {}, agentMemories: {}, memoryProposals: {}, feedbackLoopParents: {},
};

describe("read-only persisted-state health", () => {
  test("accepts the current document and does not rewrite it", () => {
    const dir = mkdtempSync(join(tmpdir(), "designflow-state-health-"));
    try {
      const path = join(dir, "runs.json");
      const bytes = JSON.stringify(current);
      writeFileSync(path, bytes);
      expect(inspectStateFile(path)).toMatchObject({ status: "healthy", schemaVersion: 1 });
      expect(Bun.file(path).text()).resolves.toBe(bytes);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("distinguishes supported legacy, future, and corrupt state", () => {
    const dir = mkdtempSync(join(tmpdir(), "designflow-state-health-"));
    try {
      const path = join(dir, "runs.json");
      writeFileSync(path, JSON.stringify({ version: 1, executions: {} }));
      expect(inspectStateFile(path).status).toBe("warning");
      writeFileSync(path, JSON.stringify({ version: 99 }));
      expect(inspectStateFile(path).status).toBe("failed");
      writeFileSync(path, "not-json");
      expect(inspectStateFile(path).status).toBe("failed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
