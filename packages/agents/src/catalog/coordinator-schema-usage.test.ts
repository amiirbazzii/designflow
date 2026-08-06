import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// design-engineer-agent.ts is deliberately absent since MVP-3B: its model
// strategy no longer routes via a model call at all — deterministic
// prerequisites fully determine the permitted outcome, so there is no
// provider transport to convert.
const coordinatorFiles = [
  "product-manager-agent.ts",
  "qa-reviewer-agent.ts",
  "research-analyst-agent.ts",
] as const;

describe("coordinator model transport boundary", () => {
  for (const file of coordinatorFiles) {
    test(`${file} converts the provider transport before making a decision`, () => {
      const source = readFileSync(join(import.meta.dir, file), "utf8");
      expect(source).toContain("modelDecisionFromTransport");
      expect(source).toContain("modelDecisionFromTransport(result.output, context.availableWorkflows)");
      expect(source).not.toContain("modelDecisionSchema.safeParse(result.output)");
    });
  }
});
