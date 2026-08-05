// apps/designflow-cli/src/sigint-acceptance.test.ts
//
// Process-level SIGINT acceptance: a real child process runs the real
// composition root against the fake MCP server, receives a real SIGINT
// mid-run, and must cancel gracefully — exit 130, execution persisted as
// `cancelled`, no orphaned MCP child. Deterministic: the parent waits for
// explicit stdout markers, never a timer, and the fake server's 120s tool
// delay guarantees the run is still in flight when the signal lands.
//
// Platform note: POSIX signal delivery (`child.kill("SIGINT")`) is exercised
// on macOS and Linux. On Windows, Node emulates SIGINT differently for
// detached processes, so this suite is gated there; the SignalCoordinator's
// behavior itself is covered cross-platform by its unit tests.

import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

function fakeServerPath(): string {
  const packageDir = fileURLToPath(new URL(".", `file://${require.resolve("@designflow/mcp/package.json")}`));
  return `${packageDir}test/fixtures/fake-server/fake-server-entry.ts`;
}

const FIXTURE_ENTRY = fileURLToPath(new URL("../test/fixtures/sigint-subprocess-entry.ts", import.meta.url));

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const describeOnPosix = process.platform === "win32" ? describe.skip : describe;

describeOnPosix("CLI SIGINT acceptance (real subprocess)", () => {
  test("first SIGINT cancels gracefully: exit 130, cancelled record, no orphan MCP child", async () => {
    const home = mkdtempSync(join(tmpdir(), "designflow-sigint-"));
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

    const child = spawn("bun", ["run", FIXTURE_ENTRY], {
      env: {
        ...process.env,
        DESIGNFLOW_HOME: home,
        FAKE_MCP_FIXTURES: JSON.stringify({
          tools: [{ name: "get_document" }],
          // Long enough that the run is guaranteed in flight; never awaited
          // in full because the SIGINT aborts the call.
          delayMs: { get_document: 120_000 },
          pidFilePath: pidFile,
          toolResults: { get_document: { name: "Homepage", document: { id: "0:0", name: "Page", type: "CANVAS", children: [] } } },
        }),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let interrupted = false;
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`SIGINT acceptance timed out; output so far:\n${stdout}`));
      }, 60_000);

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
        // Deterministic trigger: the execution has begun (STARTED) — send
        // exactly one SIGINT. The MCP call is either already blocking on
        // the 120s delay or will be aborted before it begins.
        if (!interrupted && stdout.includes("STARTED\n")) {
          interrupted = true;
          child.kill("SIGINT");
        }
      });
      child.once("exit", (code) => {
        clearTimeout(timeout);
        resolve(code);
      });
      child.once("error", reject);
    });

    try {
      expect(exitCode).toBe(130);
      // Graceful path ran to the end: cleanup marker flushed, not truncated.
      expect(stdout).toContain("Interrupted");
      expect(stdout).toContain("CLOSED");

      // The persisted execution is terminal `cancelled`, never `running`.
      const store = JSON.parse(readFileSync(databasePath, "utf8")) as {
        executions?: Record<string, { status?: string }>;
      };
      const executions = Object.values(store.executions ?? {});
      expect(executions.length).toBeGreaterThan(0);
      for (const execution of executions) {
        expect(execution.status).not.toBe("running");
      }
      expect(executions.some((e) => e.status === "cancelled")).toBe(true);

      // The fake MCP child recorded its pid; it must be gone now.
      if (existsSync(pidFile)) {
        const pid = Number(readFileSync(pidFile, "utf8"));
        expect(Number.isInteger(pid)).toBe(true);
        expect(isProcessAlive(pid)).toBe(false);
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 90_000);
});
