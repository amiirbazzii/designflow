import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { configSchema } from "./services/config";
import { readFigmaMcpConfig } from "./services/figma-mcp-config";

/**
 * The README's configuration examples, run through the real readers.
 *
 * A configuration example is a promise: someone will paste it. Prose drifts
 * away from a parser silently, so the examples are extracted from the file
 * itself rather than restated here — a block that stops parsing fails this
 * test rather than someone's first evening with the CLI.
 */

const README = readFileSync(join(import.meta.dir, "..", "README.md"), "utf8");

function jsonBlocks(containing: string): unknown[] {
  return [...README.matchAll(/```json\n([\s\S]*?)```/g)]
    .map((match) => match[1] ?? "")
    .filter((body) => body.includes(containing))
    .map((body) => JSON.parse(body) as unknown);
}

describe("README figmaMcp examples", () => {
  test("both transports parse into a usable connection", () => {
    const blocks = jsonBlocks("figmaMcp");
    expect(blocks.length).toBe(2);

    const transports = blocks.map((block) => {
      const parsed = readFigmaMcpConfig(configSchema.parse(block));
      expect(parsed).toBeDefined();
      return parsed?.transport;
    });

    expect(new Set(transports)).toEqual(new Set(["stdio", "http"]));
  });

  test("no example carries a credential value", () => {
    for (const block of jsonBlocks("figmaMcp")) {
      expect(JSON.stringify(block)).not.toMatch(/sk-or-|ghp_|figd_/);
    }
  });
});

describe("README model-profile override example", () => {
  test("uses only fields an override may set", () => {
    const blocks = jsonBlocks("profiles");
    expect(blocks.length).toBe(1);

    const settings = configSchema.parse(blocks[0]).settings;
    const models = settings["models"] as { profiles: Record<string, Record<string, unknown>> };
    const profiles = Object.values(models.profiles);
    expect(profiles.length).toBeGreaterThan(0);

    const supported = ["providerId", "model", "temperature", "maxOutputTokens", "timeoutMs"];
    for (const profile of profiles) {
      for (const key of Object.keys(profile)) expect(supported).toContain(key);
    }
  });
});
