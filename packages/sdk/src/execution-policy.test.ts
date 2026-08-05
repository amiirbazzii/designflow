// packages/sdk/src/execution-policy.test.ts
import { describe, expect, test } from "bun:test";
import {
  executionPolicySchema,
  policyRuleSchema,
  policyRuleTargetSchema,
  policyRuleTypeSchema,
  type PolicyRuleType,
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

  test("resource_limit is rejected with an actionable message", () => {
    const parsed = policyRuleSchema.safeParse({ id: "limit-1", type: "resource_limit", target: "memory" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const message = JSON.stringify(parsed.error.issues);
      expect(message).toContain("Unsupported policy rule type");
      expect(message).toContain("resource limits are not supported");
    }
  });

  test("the supported rule-type contract is exactly allow, deny, and approval", () => {
    // Source-level contract assertion: the enum's own options are the whole
    // supported surface — resource_limit is absent by construction.
    expect([...policyRuleTypeSchema.options].sort()).toEqual([
      "allow_capability",
      "deny_capability",
      "require_approval",
    ]);
    // Compile-time twin: the inferred public union excludes the removed
    // member (this line fails to typecheck if it ever returns).
    const excluded: "resource_limit" extends PolicyRuleType ? never : true = true;
    expect(excluded).toBe(true);
  });

  test("valid allow, deny, and approval rules still parse", () => {
    expect(policyRuleSchema.safeParse({ id: "a", type: "allow_capability", target: "cap-a" }).success).toBe(true);
    expect(policyRuleSchema.safeParse({ id: "d", type: "deny_capability", target: "cap-b" }).success).toBe(true);
    expect(
      policyRuleSchema.safeParse({ id: "r", type: "require_approval", target: { workflowId: "wf", nodeId: "n" } }).success,
    ).toBe(true);
  });

  test("a rule with a valid object target parses", () => {
    expect(
      policyRuleSchema.safeParse({ id: "r", type: "deny_capability", target: { capabilityId: "implementation.apply" } }).success,
    ).toBe(true);
  });
});
