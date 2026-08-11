// apps/designflow-cli/src/tui-pty-acceptance.test.ts
//
// Real-PTY acceptance for the packaged product TUI input lifecycle.
//
// Phase 6B established that component-level tests cannot catch input-ownership
// defects: candidate 6 shipped with an invisible pending `ask()` prompt that
// swallowed every keypress on the terminal-outcome screen while the screen
// itself rendered interactive actions. These tests therefore drive the *built*
// CLI (`dist/main.js`, the exact artifact that is packaged) inside a real
// pseudo-terminal, send actual terminal bytes (Enter, Esc, q, Tab, arrows,
// Ctrl+C), and assert on the rendered screen — never on exit codes alone.
//
// Determinism: model calls go to a local fake gateway that synthesizes valid
// outputs from each request's own responseSchema (no paid AI); the Figma MCP
// server is the repo's fake stdio server configured to fail `get_document`,
// which reproduces the exact field failure "Could not finish retrieving the
// design source." POSIX-only (python3 stdlib pty).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const cliEntry = join(packageRoot, "dist", "main.js");
const driver = join(packageRoot, "test", "pty", "pty-driver.py");
const gatewayScript = join(packageRoot, "test", "pty", "fake-gateway.mjs");
const projectFixture = join(packageRoot, "..", "..", "test-fixtures", "designflow-stage4-project");

function fakeMcpServerPath(): string {
  const mcpPackage = fileURLToPath(new URL(".", `file://${require.resolve("@designflow/mcp/package.json")}`));
  return join(mcpPackage, "test", "fixtures", "fake-server", "fake-server-entry.ts");
}

const hasPython = spawnSync("python3", ["--version"], { stdio: "ignore" }).status === 0;
const describePty = process.platform === "win32" || !hasPython ? describe.skip : describe;

describePty("product TUI input lifecycle (real PTY, built CLI)", () => {
  let gateway: ChildProcess;
  let gatewayPort = 0;
  const homes: string[] = [];

  beforeAll(async () => {
    if (!existsSync(cliEntry)) {
      const build = spawnSync("bun", ["run", "build"], { cwd: packageRoot, stdio: "ignore" });
      if (build.status !== 0) throw new Error("bun run build failed; PTY tests need dist/main.js");
    }
    gateway = spawn("node", [gatewayScript], { stdio: ["ignore", "pipe", "ignore"] });
    gatewayPort = await new Promise<number>((resolve, reject) => {
      let output = "";
      gateway.stdout!.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        const match = /LISTENING (\d+)/.exec(output);
        if (match !== null) resolve(Number(match[1]));
      });
      gateway.on("exit", () => reject(new Error("fake gateway exited before listening")));
    });
  });

  afterAll(() => {
    gateway?.kill();
    for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
  });

  function runScenario(scenario: string, options?: { readonly gatewayReachable?: boolean }): {
    readonly status: number | null;
    readonly stdout: string;
  } {
    const home = mkdtempSync(join(tmpdir(), "designflow-pty-"));
    homes.push(home);
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({
        settings: {
          experimental: { designEngineerFigmaMcp: true },
          figmaMcp: {
            command: "bun",
            args: ["run", fakeMcpServerPath()],
            envPassthrough: ["FAKE_MCP_FIXTURES"],
            captureScreenshots: false,
          },
        },
      }),
    );
    const result = spawnSync("python3", [driver, scenario, cliEntry], {
      encoding: "utf8",
      timeout: 240_000,
      env: {
        ...process.env,
        DESIGNFLOW_HOME: home,
        PTY_PROJECT_DIR: projectFixture,
        DESIGNFLOW_AI_GATEWAY_URL:
          options?.gatewayReachable === false ? "http://127.0.0.1:9" : `http://127.0.0.1:${gatewayPort}`,
        DESIGNFLOW_AI_GATEWAY_TOKEN: "pty-test-session-token",
        FAKE_MCP_FIXTURES: JSON.stringify({
          tools: [{ name: "get_document" }],
          errorTools: ["get_document"],
          toolResults: { get_document: "fixture: document retrieval failed" },
        }),
        TERM: "xterm-256color",
      },
    });
    return { status: result.status, stdout: result.stdout ?? "" };
  }

  test("design-source retrieval failure keeps the terminal outcome interactive: Enter → Details, Esc → back, Back to start restarts, q quits", () => {
    const { status, stdout } = runScenario("design-source-failure");
    expect(stdout).not.toContain("FAIL ");
    expect(stdout).toContain("PASS failure-message");
    expect(stdout).toContain("PASS enter-opens-details");
    expect(stdout).toContain("PASS back-to-start");
    expect(stdout).toContain("PASS new-run-startable");
    expect(stdout).toContain("PASS q-quits");
    expect(status).toBe(0);
  }, 300_000);

  test("model-unreachable outcome keeps Enter / Esc / Tab / arrows / q interactive", () => {
    const { status, stdout } = runScenario("model-unreachable", { gatewayReachable: false });
    expect(stdout).not.toContain("FAIL ");
    expect(stdout).toContain("PASS enter-opens-details");
    expect(stdout).toContain("PASS q-quits");
    expect(status).toBe(0);
  }, 300_000);

  test("Ctrl+C exits from the terminal outcome screen", () => {
    const { status, stdout } = runScenario("ctrl-c");
    expect(stdout).not.toContain("FAIL ");
    expect(stdout).toContain("PASS ctrl-c-exits");
    expect(status).toBe(0);
  }, 300_000);

  test("approval mode: first option persists as manual review, second as DesignFlow approvals", () => {
    // The manual option is asserted inside every journey (approval-label);
    // this scenario explicitly selects the second option.
    const { status, stdout } = runScenario("approval-designflow");
    expect(stdout).not.toContain("FAIL ");
    expect(stdout).toContain("PASS approval-label");
    expect(status).toBe(0);
  }, 300_000);
});
