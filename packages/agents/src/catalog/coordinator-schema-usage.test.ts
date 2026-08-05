import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const coordinatorFiles = [
  "design-engineer-agent.ts",
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
