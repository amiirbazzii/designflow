import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// design-engineer-agent.ts is covered separately below: since the MVP-3B
// reconciliation its model strategy decides over PRODUCT ACTIONS (never
// workflow ids), converting the provider transport through
// validateProductActionTransport instead of modelDecisionFromTransport.
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

describe("design engineer product-action transport boundary", () => {
  test("design-engineer-agent.ts validates the provider transport via the shared validator", () => {
    const source = readFileSync(join(import.meta.dir, "design-engineer-agent.ts"), "utf8");
    expect(source).toContain("validateProductActionTransport(result.output, allowedActions)");
    // The model never sees or selects workflow ids: translation is a
    // deterministic mapping applied after validation.
    expect(source).not.toContain("modelDecisionFromTransport");
  });
});
