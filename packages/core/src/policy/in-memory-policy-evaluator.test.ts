import { describe, expect, test, beforeEach } from "bun:test";
import { InMemoryPolicyEvaluator } from "./in-memory-policy-evaluator";
import type {
  ExecutionPolicy,
  PolicyContext,
  PolicyEvaluationResult,
} from "@designflow/sdk";

// ── Tests ───────────────────────────────────────────────────────

describe("InMemoryPolicyEvaluator", () => {
  let evaluator: InMemoryPolicyEvaluator;

  beforeEach(() => {
    evaluator = new InMemoryPolicyEvaluator();
  });

  describe("allow policy", () => {
    test("allow policy passes for listed capabilities", async () => {
      const policy: ExecutionPolicy = {
        id: "policy-1",
        name: "Allow Policy",
        rules: [
          { id: "allow-1", type: "allow_capability", target: "cap-a" },
          { id: "allow-2", type: "allow_capability", target: "cap-b" },
        ],
      };

      const context: PolicyContext = {
        workflowId: "wf-1",
        capabilityIds: ["cap-a", "cap-b"],
      };

      const result = await evaluator.evaluate(policy, context);

      expect(result.allowed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    test("allow policy blocks unlisted capabilities", async () => {
      const policy: ExecutionPolicy = {
        id: "policy-1",
        name: "Allow Policy",
        rules: [
          { id: "allow-1", type: "allow_capability", target: "cap-a" },
        ],
      };

      const context: PolicyContext = {
        workflowId: "wf-1",
        capabilityIds: ["cap-a", "cap-c"],
      };

      const result = await evaluator.evaluate(policy, context);

      expect(result.allowed).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].ruleId).toBe("allow-1");
      expect(result.violations[0].message).toContain("cap-c");
    });
  });

  describe("deny policy", () => {
    test("deny policy blocks specific capabilities", async () => {
      const policy: ExecutionPolicy = {
        id: "policy-1",
        name: "Deny Policy",
        rules: [
          { id: "deny-1", type: "deny_capability", target: "filesystem.write" },
        ],
      };

      const context: PolicyContext = {
        workflowId: "wf-1",
        capabilityIds: ["cap-a", "filesystem.write"],
      };

      const result = await evaluator.evaluate(policy, context);

      expect(result.allowed).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].ruleId).toBe("deny-1");
      expect(result.violations[0].message).toContain("filesystem.write");
    });

    test("deny policy passes for non-denied capabilities", async () => {
      const policy: ExecutionPolicy = {
        id: "policy-1",
        name: "Deny Policy",
        rules: [
          { id: "deny-1", type: "deny_capability", target: "filesystem.write" },
        ],
      };

      const context: PolicyContext = {
        workflowId: "wf-1",
        capabilityIds: ["cap-a", "cap-b"],
      };

      const result = await evaluator.evaluate(policy, context);

      expect(result.allowed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });
  });

  describe("approval policy", () => {
    test("require_approval blocks execution", async () => {
      const policy: ExecutionPolicy = {
        id: "policy-1",
        name: "Approval Policy",
        rules: [
          { id: "approval-1", type: "require_approval" },
        ],
      };

      const context: PolicyContext = {
        workflowId: "wf-1",
        capabilityIds: ["cap-a"],
      };

      const result = await evaluator.evaluate(policy, context);

      expect(result.allowed).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].ruleId).toBe("approval-1");
      expect(result.violations[0].message).toContain("Approval required");
    });
  });

  describe("resource_limit policy", () => {
    test("resource_limit rules are stored but not enforced", async () => {
      const policy: ExecutionPolicy = {
        id: "policy-1",
        name: "Resource Policy",
        rules: [
          { id: "limit-1", type: "resource_limit", target: "memory", metadata: { maxMB: 512 } },
        ],
      };

      const context: PolicyContext = {
        workflowId: "wf-1",
        capabilityIds: ["cap-a"],
      };

      const result = await evaluator.evaluate(policy, context);

      expect(result.allowed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });
  });

  describe("multiple violations", () => {
    test("multiple violations are returned", async () => {
      const policy: ExecutionPolicy = {
        id: "policy-1",
        name: "Combined Policy",
        rules: [
          { id: "deny-1", type: "deny_capability", target: "filesystem.write" },
          { id: "deny-2", type: "deny_capability", target: "network.request" },
          { id: "approval-1", type: "require_approval" },
        ],
      };

      const context: PolicyContext = {
        workflowId: "wf-1",
        capabilityIds: ["filesystem.write", "network.request", "cap-a"],
      };

      const result = await evaluator.evaluate(policy, context);

      expect(result.allowed).toBe(false);
      expect(result.violations).toHaveLength(3);
    });
  });

  describe("no rules", () => {
    test("empty policy allows execution", async () => {
      const policy: ExecutionPolicy = {
        id: "policy-1",
        name: "Empty Policy",
        rules: [],
      };

      const context: PolicyContext = {
        workflowId: "wf-1",
        capabilityIds: ["cap-a", "cap-b"],
      };

      const result = await evaluator.evaluate(policy, context);

      expect(result.allowed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });
  });

  describe("violation types", () => {
    test("each rule kind emits its machine-readable violation type", async () => {
      const policy: ExecutionPolicy = {
        id: "policy-1",
        name: "Mixed Policy",
        rules: [
          { id: "deny-1", type: "deny_capability", target: "cap-a" },
          { id: "allow-1", type: "allow_capability", target: "cap-a" },
          { id: "approval-1", type: "require_approval" },
        ],
      };

      const context: PolicyContext = {
        workflowId: "wf-1",
        capabilityIds: ["cap-a", "cap-b"],
      };

      const result = await evaluator.evaluate(policy, context);

      expect(result.allowed).toBe(false);

      const types = result.violations.map((v) => v.type).sort();
      expect(types).toEqual([
        "approval_required",
        "capability_denied",
        "capability_not_allowed",
      ]);
    });

    test("an approval-only policy emits only approval_required", async () => {
      const policy: ExecutionPolicy = {
        id: "policy-1",
        name: "Approval Policy",
        rules: [{ id: "approval-1", type: "require_approval" }],
      };

      const context: PolicyContext = {
        workflowId: "wf-1",
        capabilityIds: ["cap-a"],
      };

      const result = await evaluator.evaluate(policy, context);

      expect(result.violations).toHaveLength(1);
      expect(result.violations.every((v) => v.type === "approval_required")).toBe(
        true,
      );
    });
  });
});
