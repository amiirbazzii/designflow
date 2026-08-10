import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCliContext, type CliContext } from "../services/cli-runner";
import { doctorCommand, runDoctor } from "./doctor";
import { ScriptedTerminal } from "../ui/terminal";

const homes: string[] = [];
const contexts: CliContext[] = [];
const providerEnv = ["OPENROUTER", "API", "KEY"].join("_");

/** A home whose configuration exists before workflow registration is derived. */
function context(settings: Record<string, unknown> = {}): CliContext {
  const home = mkdtempSync(join(tmpdir(), "designflow-doctor-"));
  homes.push(home);
  process.env.DESIGNFLOW_HOME = home;

  writeFileSync(
    join(home, "config.json"),
    `${JSON.stringify({ version: 1, firstRunCompleted: true, environment: "local", databasePath: "history/runs.json", settings }, null, 2)}\n`,
  );

  const created = createCliContext({ databasePath: join(home, "runs.json") });
  contexts.push(created);
  return created;
}

afterEach(() => {
  for (const created of contexts.splice(0)) created.close();
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
  delete process.env.DESIGNFLOW_HOME;
  delete process.env[providerEnv];
  delete process.env.DESIGNFLOW_AI_GATEWAY_URL;
  delete process.env.DESIGNFLOW_AI_GATEWAY_TOKEN;
});

describe("designflow doctor", () => {
  test("is read-only and never prints credential values", async () => {
    process.env[providerEnv] = "sk-stage7-test-sentinel";
    const created = context();
    const configBefore = readFileSync(created.home.layout.configFile, "utf8");
    const terminal = new ScriptedTerminal();
    expect(await doctorCommand(created, terminal, { json: true })).toBe(0);
    const report = JSON.parse(terminal.transcript) as { checks: Array<{ id: string; detail: string }> };
    const provider = report.checks.find((item) => item.id === "model-provider");
    expect(provider?.detail).toContain("present in the environment");
    expect(terminal.transcript).not.toContain("sk-stage7-test-sentinel");
    expect(readFileSync(created.home.layout.configFile, "utf8")).toBe(configBefore);
  });

  test("reports a persisted AI session without printing its bearer values", async () => {
    process.env.DESIGNFLOW_AI_GATEWAY_URL = "https://project.supabase.co/functions/v1/ai-gateway";
    const created = context();
    mkdirSync(created.home.layout.auth, { recursive: true });
    writeFileSync(created.home.layout.authSessionFile, JSON.stringify({
      version: 1,
      accessToken: "doctor-access-secret",
      refreshToken: "doctor-refresh-secret",
      expiresAt: Date.now() + 60_000,
    }));

    const terminal = new ScriptedTerminal();
    expect(await doctorCommand(created, terminal, { json: true })).toBe(0);
    expect(terminal.transcript).toContain("DesignFlow AI session is available");
    expect(terminal.transcript).not.toContain("doctor-access-secret");
    expect(terminal.transcript).not.toContain("doctor-refresh-secret");
  });

  test("reports an invalid state store without starting a workflow", async () => {
    const created = context();
    writeFileSync(join(created.home.layout.home, "runs.json"), "{not-json");
    const report = await runDoctor(created);
    expect(report.checks.find((item) => item.id === "state-store")?.status).toBe("failed");
    expect(existsSync(join(created.home.layout.home, "runs.json"))).toBe(true);
  });

  test("reports the configured Desktop HTTP MCP endpoint without exposing a session", async () => {
    const created = context({
      figmaMcp: {
        transport: "http",
        url: "http://127.0.0.1:3845/mcp",
      },
    });

    const report = await runDoctor(created);
    const figma = report.checks.find((item) => item.id === "figma");
    expect(figma?.detail).toContain("Figma MCP configured: http://127.0.0.1:3845/mcp");
    expect(figma?.detail.toLowerCase()).not.toContain("mcp-session-id");
  });
});

describe("design engineer readiness", () => {
  test("renders for a specification-only setup and states both implementation gates", async () => {
    const created = context({ figmaMcp: { command: "figma-server" } });

    const terminal = new ScriptedTerminal();
    expect(await doctorCommand(created, terminal)).toBe(0);

    expect(terminal.transcript).toContain("Design Engineer readiness");
    expect(terminal.transcript).toContain("Specification: ready");
    // No project registered, so a proposal cannot be prepared yet — and the
    // two gates are stated regardless.
    expect(terminal.transcript).toContain("Implementation proposal: blocked");
    expect(terminal.transcript).toContain("designflow projects add --name <name> --path <path>");
    expect(terminal.transcript).toContain("approve the exact proposed changes");
    expect(terminal.transcript).toContain("Beta");
    expect(terminal.transcript).toContain("Doctor is read-only");
  });

  test("distinguishes a missing Figma block from an unusable one", async () => {
    const missing = context();
    const missingTerminal = new ScriptedTerminal();
    await doctorCommand(missing, missingTerminal);
    expect(missingTerminal.transcript).toContain("No Figma connection is configured.");
    expect(missingTerminal.transcript).toContain("Add a figmaMcp block");

    const invalid = context({ figmaMcp: { transport: "http" } });
    const invalidTerminal = new ScriptedTerminal();
    await doctorCommand(invalid, invalidTerminal);
    expect(invalidTerminal.transcript).toContain("does not describe a usable server");
    expect(invalidTerminal.transcript).toContain("Fix the figmaMcp block");
  });

  test("reports deterministic mode without naming a credential value", async () => {
    const created = context();
    const terminal = new ScriptedTerminal();
    await doctorCommand(created, terminal);

    expect(terminal.transcript).toContain("Deterministic fallback");
    expect(terminal.transcript).toContain(providerEnv);
    expect(terminal.transcript).not.toContain("sk-or-");
    // Internal vocabulary stays internal: no experimental keys, no workflow ids.
    expect(terminal.transcript).not.toContain("settings.experimental");
    expect(terminal.transcript).not.toContain("design-to-code");
  });

  test("an incomplete setup still exits 0; only a broken installation exits 1", async () => {
    // Nothing configured at all — no credential, no Figma, no project, no
    // Playwright in this environment's optional install.
    const incomplete = context();
    expect(await doctorCommand(incomplete, new ScriptedTerminal())).toBe(0);

    const broken = context();
    writeFileSync(join(broken.home.layout.home, "runs.json"), "{not-json");
    expect(await doctorCommand(broken, new ScriptedTerminal())).toBe(1);
  });
});
