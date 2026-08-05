// packages/sdk/src/execution-policy.test.ts
import { describe, expect, test } from "bun:test";
import {
  executionPolicySchema,
  policyRuleSchema,
  policyRuleTargetSchema,
} from "./execution-policy";

describe("policy target schema", () => {
  test("a workflowId-only object target is rejected", () => {
    const parsed = policyRuleTargetSchema.safeParse({ workflowId: "design-to-code-implementation" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(JSON.stringify(parsed.error.issues)).toContain("nodeId or a capabilityId");
    }
  });

  test("an empty object target is rejected", () => {
    expect(policyRuleTargetSchema.safeParse({}).success).toBe(false);
  });

  test("nodeId alone is valid", () => {
    expect(policyRuleTargetSchema.safeParse({ nodeId: "apply-approved-file-changes" }).success).toBe(true);
  });

  test("capabilityId alone is valid", () => {
    expect(policyRuleTargetSchema.safeParse({ capabilityId: "implementation.apply" }).success).toBe(true);
  });

  test("workflowId with nodeId is valid", () => {
    expect(
      policyRuleTargetSchema.safeParse({ workflowId: "design-to-code-implementation", nodeId: "create-project-snapshot" }).success,
    ).toBe(true);
  });

  test("workflowId with capabilityId is valid", () => {
    expect(
      policyRuleTargetSchema.safeParse({ workflowId: "design-to-code-implementation", capabilityId: "implementation.snapshot" }).success,
    ).toBe(true);
  });

  test("workflowId with nodeId and capabilityId is valid", () => {
    expect(
      policyRuleTargetSchema.safeParse({ workflowId: "wf", nodeId: "n", capabilityId: "c" }).success,
    ).toBe(true);
  });

  test("string targets remain valid", () => {
    expect(policyRuleTargetSchema.safeParse("generate-code").success).toBe(true);
    expect(policyRuleTargetSchema.safeParse("").success).toBe(false);
  });

  test("a persisted or configured policy with a workflowId-only rule fails clearly at its parsing boundary", () => {
    const parsed = executionPolicySchema.safeParse({
      id: "p",
      name: "P",
      rules: [{ id: "r", type: "require_approval", target: { workflowId: "wf-only" } }],
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(JSON.stringify(parsed.error.issues)).toContain("nodeId or a capabilityId");
    }
  });

  test("a rule with a valid object target parses", () => {
    expect(
      policyRuleSchema.safeParse({ id: "r", type: "deny_capability", target: { capabilityId: "implementation.apply" } }).success,
    ).toBe(true);
  });
});
