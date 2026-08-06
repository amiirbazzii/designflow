import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCliContext, type CliContext } from "../services/cli-runner";
import { settingsCommand } from "./settings";
import { ScriptedTerminal } from "../ui/terminal";

const homes: string[] = [];
const contexts: CliContext[] = [];
const providerEnv = ["OPENROUTER", "API", "KEY"].join("_");

/** A home whose `config.json` is written before the context reads it. */
function context(settings: Record<string, unknown> = {}): CliContext {
  const home = mkdtempSync(join(tmpdir(), "designflow-settings-"));
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

async function transcript(created: CliContext): Promise<string> {
  const terminal = new ScriptedTerminal();
  expect(await settingsCommand(created, terminal)).toBe(0);
  return terminal.transcript;
}

afterEach(() => {
  for (const created of contexts.splice(0)) created.close();
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
  delete process.env.DESIGNFLOW_HOME;
  delete process.env[providerEnv];
});

describe("designflow settings", () => {
  test("names the provider the way a person would, never as a raw id", async () => {
    const output = await transcript(context());

    // The canonical id stays what DesignFlow compares; only the line a
    // person reads is translated. Both the summary and the per-role rows
    // must agree — one of them printing "openrouter" was the whole bug.
    expect(output).toContain("OpenRouter");
    expect(output).not.toContain("openrouter");
  });


  test("shows all five specialized agents with distinct profile ids", async () => {
    const output = await transcript(context());

    for (const role of [
      "Design Engineer Coordinator",
      "Figma Specification Specialist",
      "Implementation Specialist",
      "Visual Validation Specialist",
      "Visual Correction Specialist (beta)",
    ]) {
      expect(output).toContain(role);
    }

    const profileIds = [...output.matchAll(/Profile:\s+(\S+)/g)].map((match) => match[1]);
    expect(profileIds).toHaveLength(5);
    expect(new Set(profileIds).size).toBe(5);
  });

  test("attributes an overridden field to the override and leaves the rest built-in", async () => {
    const output = await transcript(
      context({
        models: { profiles: { "figma-specification-default": { model: "override/model-slug" } } },
      }),
    );

    expect(output).toContain("override/model-slug (override)");
    // One override does not relabel everything else.
    expect(output.match(/\(override\)/g) ?? []).toHaveLength(1);
    expect(output).toContain("(built-in)");
  });

  test("shows configuration and model mode, and no credential value", async () => {
    process.env[providerEnv] = "sk-or-settings-test-sentinel";
    const output = await transcript(context());

    expect(output).toContain("Configuration");
    expect(output).toContain("config.json");
    expect(output).toContain("live reasoning");
    expect(output).toContain("value never read or stored");
    expect(output).not.toContain("sk-or-settings-test-sentinel");
  });

  test("without a credential it names the deterministic fallback", async () => {
    expect(await transcript(context())).toContain("deterministic fallback");
  });

  test("shows Figma metadata as names and a target, never a URL, command line or value", async () => {
    process.env["FIGMA_ACCESS_TOKEN"] = "secret-value-not-for-display";
    try {
      const output = await transcript(
        context({
          figmaMcp: {
            command: "/opt/private/tools/figma-server",
            args: ["--token", "secret-value-not-for-display"],
            envPassthrough: ["FIGMA_ACCESS_TOKEN"],
          },
        }),
      );

      expect(output).toContain("FIGMA_ACCESS_TOKEN");
      expect(output).toContain("figma-server");
      expect(output).not.toContain("secret-value-not-for-display");
      expect(output).not.toContain("/opt/private");
    } finally {
      delete process.env["FIGMA_ACCESS_TOKEN"];
    }
  });

  test("an unusable Figma block is labeled as such", async () => {
    expect(await transcript(context({ figmaMcp: { transport: "http" } }))).toContain(
      "present but not usable",
    );
  });

  test("labels every feature tier and claims nothing about production", async () => {
    const output = await transcript(context());

    expect(output).toContain("Design specification: supported");
    expect(output).toContain("Implementation proposal and apply: supported");
    expect(output).toContain("Visual correction: beta");
    expect(output).toContain("Legacy scaffold workflow: compatibility-only");
    expect(output.toLowerCase()).not.toContain("production");
    // Internal vocabulary stays out of a user-facing screen.
    expect(output).not.toContain("design-to-code");
    expect(output).not.toContain("settings.experimental");
  });
});
