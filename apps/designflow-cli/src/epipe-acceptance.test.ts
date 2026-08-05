// apps/designflow-cli/src/epipe-acceptance.test.ts
//
// Process-level broken-pipe acceptance. Two scenarios against real child
// processes: (1) an informational command whose consumer closes the pipe
// early must exit 0 with no stack trace; (2) an active workflow whose
// output pipe breaks must cancel through the root signal, persist a
// `cancelled` execution, clean up the MCP child, and exit 0. Deterministic:
// marker-driven, no sleeps in assertions (the fixture's own heartbeat is
// what makes the broken pipe observable, as in any progress-printing CLI).

import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const MAIN_ENTRY = fileURLToPath(new URL("./main.ts", import.meta.url));
const EPIPE_FIXTURE = fileURLToPath(new URL("../test/fixtures/epipe-subprocess-entry.ts", import.meta.url));
const EPIPE_FAILURE_FIXTURE = fileURLToPath(new URL("../test/fixtures/epipe-failure-entry.ts", import.meta.url));

function fakeServerPath(): string {
  const packageDir = fileURLToPath(new URL(".", `file://${require.resolve("@designflow/mcp/package.json")}`));
  return `${packageDir}test/fixtures/fake-server/fake-server-entry.ts`;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const describeOnPosix = process.platform === "win32" ? describe.skip : describe;

describeOnPosix("broken-pipe acceptance (real subprocesses)", () => {
  test("informational command with an early-closing consumer exits 0 without a stack trace", async () => {
    const home = mkdtempSync(join(tmpdir(), "designflow-epipe-info-"));

    const child = spawn("bun", [MAIN_ENTRY, "workers"], {
      env: { ...process.env, DESIGNFLOW_HOME: home },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`informational EPIPE test timed out; stderr:\n${stderr}`));
      }, 30_000);

      child.stdout.once("data", () => {
        // The consumer got its first chunk and leaves — like `grep -q`.
        child.stdout.destroy();
      });
      child.once("exit", (code) => {
        clearTimeout(timeout);
        resolve(code);
      });
      child.once("error", reject);
    });

    try {
      expect(exitCode).toBe(0);
      expect(stderr).not.toContain("EPIPE");
      expect(stderr).not.toContain("Unhandled");
      expect(stderr).not.toContain("at "); // no stack frames
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 45_000);

  test("a genuine command failure keeps its nonzero exit code even when the consumer closes the pipe mid-flush", async () => {
    const child = spawn("bun", ["run", EPIPE_FAILURE_FIXTURE], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`failing-command EPIPE test timed out; evidence:\n${stderr}`));
      }, 30_000);

      // Consume one chunk (like a pager showing the first screen), then
      // leave while the fixture's 20k-line report is still flushing.
      child.stdout.once("data", () => {
        child.stdout.destroy();
      });
      child.once("exit", (code) => {
        clearTimeout(timeout);
        resolve(code);
      });
      child.once("error", reject);
    });

    // The original failure survives the late EPIPE — never rewritten to 0.
    expect(exitCode).toBe(3);
    expect(stderr).toContain("RESULT-RECORDED");
    expect(stderr).toContain("FINAL:3");
    expect(stderr).not.toContain("write EPIPE");
    expect(stderr).not.toContain("Unhandled");
  }, 45_000);

  test("active workflow with a broken output pipe cancels gracefully, persists cancelled state, and exits 0", async () => {
    const home = mkdtempSync(join(tmpdir(), "designflow-epipe-active-"));
    const pidFile = join(home, "fake-mcp.pid");
    const databasePath = join(home, "history", "runs.json");

    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({
        settings: {
          experimental: { designEngineerFigmaMcp: true },
          figmaMcp: {
            command: "bun",
            args: ["run", fakeServerPath()],
            envPassthrough: ["FAKE_MCP_FIXTURES"],
            captureScreenshots: false,
          },
        },
      }),
    );

    const child = spawn("bun", ["run", EPIPE_FIXTURE], {
      env: {
        ...process.env,
        DESIGNFLOW_HOME: home,
        FAKE_MCP_FIXTURES: JSON.stringify({
          tools: [{ name: "get_document" }],
          delayMs: { get_document: 120_000 },
          pidFilePath: pidFile,
          toolResults: { get_document: { name: "Homepage", document: { id: "0:0", name: "Page", type: "CANVAS", children: [] } } },
        }),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    let severed = false;
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`active EPIPE test timed out; evidence:\n${stderr}`));
      }, 60_000);

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
        // The run has begun; sever the output pipe. The fixture's heartbeat
        // writes discover the closed pipe and trigger cancellation.
        if (!severed && stderr.includes("STARTED\n")) {
          severed = true;
          child.stdout.destroy();
        }
      });
      child.stdout.on("data", () => {});
      child.once("exit", (code) => {
        clearTimeout(timeout);
        resolve(code);
      });
      child.once("error", reject);
    });

    try {
      expect(exitCode).toBe(0);
      expect(stderr).toContain("PIPE-BROKEN");
      expect(stderr).toContain("CLOSED");
      // Quiet cancellation, not a user interrupt: no interrupt notice.
      expect(stderr).not.toContain("Interrupted —");
      expect(stderr).not.toContain("write EPIPE");

      const store = JSON.parse(readFileSync(databasePath, "utf8")) as {
        executions?: Record<string, { status?: string }>;
      };
      const executions = Object.values(store.executions ?? {});
      expect(executions.length).toBeGreaterThan(0);
      for (const execution of executions) {
        expect(execution.status).not.toBe("running");
      }
      expect(executions.some((e) => e.status === "cancelled")).toBe(true);

      if (existsSync(pidFile)) {
        const pid = Number(readFileSync(pidFile, "utf8"));
        expect(isProcessAlive(pid)).toBe(false);
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 90_000);
});
