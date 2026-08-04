import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCliContext, type CliContext } from "../services/cli-runner";
import { doctorCommand, runDoctor } from "./doctor";
import { ScriptedTerminal } from "../ui/terminal";

const homes: string[] = [];
const contexts: CliContext[] = [];
const providerEnv = ["OPENROUTER", "API", "KEY"].join("_");

function context(): CliContext {
  const home = mkdtempSync(join(tmpdir(), "designflow-doctor-"));
  homes.push(home);
  process.env.DESIGNFLOW_HOME = home;
  const created = createCliContext({ databasePath: join(home, "runs.json") });
  contexts.push(created);
  return created;
}

afterEach(() => {
  for (const created of contexts.splice(0)) created.close();
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
  delete process.env.DESIGNFLOW_HOME;
  delete process.env[providerEnv];
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

  test("reports an invalid state store without starting a workflow", async () => {
    const created = context();
    writeFileSync(join(created.home.layout.home, "runs.json"), "{not-json");
    const report = await runDoctor(created);
    expect(report.checks.find((item) => item.id === "state-store")?.status).toBe("failed");
    expect(existsSync(join(created.home.layout.home, "runs.json"))).toBe(true);
  });
});
