// packages/core/src/policy/in-memory-policy-evaluator.test.ts
import { describe, expect, test, beforeEach } from "bun:test";
import { InMemoryPolicyEvaluator } from "./in-memory-policy-evaluator";
import type { ExecutionPolicy, PolicyContext } from "@designflow/sdk";

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
          { id: "approval-1", type: "require_approval", target: "cap-a" },
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

    test("require_approval does not fire for a capability the execution never touches", async () => {
      const policy: ExecutionPolicy = {
        id: "policy-1",
        name: "Approval Policy",
        rules: [
          { id: "approval-1", type: "require_approval", target: "cap-z" },
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

    test("node-bound approval fires only at the targeted workflow node", async () => {
      const policy: ExecutionPolicy = { id: "policy-node", name: "Node approval", rules: [{ id: "approval-node", type: "require_approval", target: { workflowId: "wf-1", nodeId: "write-node" } }] };
      const before = await evaluator.evaluate(policy, { workflowId: "wf-1", capabilityIds: ["write-cap"] });
      const atTarget = await evaluator.evaluate(policy, { workflowId: "wf-1", capabilityIds: ["write-cap"], metadata: { nodeId: "write-node" } });
      expect(before.allowed).toBe(true);
      expect(atTarget.allowed).toBe(false);
      expect(atTarget.violations[0]?.ruleId).toBe("approval-node");
    });
  });

  describe("object target semantics", () => {
    test("a workflowId-only rule is rejected at the evaluation parsing boundary, never silently ignored", async () => {
      const policy: ExecutionPolicy = {
        id: "policy-wf-only",
        name: "Workflow-only target",
        rules: [{ id: "bad-rule", type: "require_approval", target: { workflowId: "wf-1" } }],
      };

      // Identical rejection regardless of caller context shape — the exact
      // divergence L1-01 reproduced (pre-flight matched nothing, per-node
      // matched everything) can no longer occur because neither path gets
      // to interpret the rule.
      await expect(evaluator.evaluate(policy, { workflowId: "wf-1", capabilityIds: ["cap-a"] })).rejects.toThrow();
      await expect(
        evaluator.evaluate(policy, { workflowId: "wf-1", capabilityIds: ["cap-a"], metadata: { nodeId: "n1" } }),
      ).rejects.toThrow();
    });

    test("every supplied field must match: a workflow mismatch prevents a capability match", async () => {
      const policy: ExecutionPolicy = {
        id: "p",
        name: "P",
        rules: [{ id: "deny-1", type: "deny_capability", target: { workflowId: "wf-other", capabilityId: "cap-a" } }],
      };
      const result = await evaluator.evaluate(policy, { workflowId: "wf-1", capabilityIds: ["cap-a"] });
      expect(result.allowed).toBe(true);
    });

    test("a capability mismatch prevents a match", async () => {
      const policy: ExecutionPolicy = {
        id: "p",
        name: "P",
        rules: [{ id: "deny-1", type: "deny_capability", target: { workflowId: "wf-1", capabilityId: "cap-other" } }],
      };
      const result = await evaluator.evaluate(policy, { workflowId: "wf-1", capabilityIds: ["cap-a"] });
      expect(result.allowed).toBe(true);
    });

    test("a node mismatch prevents a match", async () => {
      const policy: ExecutionPolicy = {
        id: "p",
        name: "P",
        rules: [{ id: "approval-1", type: "require_approval", target: { nodeId: "node-b" } }],
      };
      const result = await evaluator.evaluate(policy, {
        workflowId: "wf-1",
        capabilityIds: ["cap-a"],
        metadata: { nodeId: "node-a" },
      });
      expect(result.allowed).toBe(true);
    });

    test("a capabilityId-only target matches identically with and without node metadata", async () => {
      const policy: ExecutionPolicy = {
        id: "p",
        name: "P",
        rules: [{ id: "deny-1", type: "deny_capability", target: { capabilityId: "cap-a" } }],
      };

      const preFlight = await evaluator.evaluate(policy, { workflowId: "wf-1", capabilityIds: ["cap-a"] });
      const perNode = await evaluator.evaluate(policy, {
        workflowId: "wf-1",
        capabilityIds: ["cap-a"],
        metadata: { nodeId: "any-node" },
      });

      expect(preFlight.allowed).toBe(false);
      expect(perNode.allowed).toBe(false);
      expect(preFlight.violations[0]?.ruleId).toBe("deny-1");
      expect(perNode.violations[0]?.ruleId).toBe("deny-1");
    });

    test("a fully specified target matches exactly its node, workflow, and capability", async () => {
      const policy: ExecutionPolicy = {
        id: "p",
        name: "P",
        rules: [{ id: "approval-1", type: "require_approval", target: { workflowId: "wf-1", nodeId: "n1", capabilityId: "cap-a" } }],
      };
      const match = await evaluator.evaluate(policy, { workflowId: "wf-1", capabilityIds: ["cap-a"], metadata: { nodeId: "n1" } });
      const wrongCap = await evaluator.evaluate(policy, { workflowId: "wf-1", capabilityIds: ["cap-b"], metadata: { nodeId: "n1" } });
      expect(match.allowed).toBe(false);
      expect(match.violations).toHaveLength(1);
      expect(wrongCap.allowed).toBe(true);
    });

    test("a structurally invalid target smuggled past the schema fails loudly, never silently open", async () => {
      const policy: ExecutionPolicy = {
        id: "p",
        name: "P",
        rules: [{ id: "deny-1", type: "deny_capability", target: { capabilityId: "cap-a" } }],
      };
      // Corrupt the already-typed object through an internal unchecked
      // mutation — the schema cannot see this, so the evaluator must.
      const rule = policy.rules[0] as { target?: unknown };
      rule.target = { workflowId: "wf-1" };

      await expect(evaluator.evaluate(policy, { workflowId: "wf-1", capabilityIds: ["cap-a"] })).rejects.toThrow(
        "nodeId or a capabilityId",
      );
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
          { id: "approval-1", type: "require_approval", target: "cap-a" },
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
          { id: "approval-1", type: "require_approval", target: "cap-a" },
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
        rules: [{ id: "approval-1", type: "require_approval", target: "cap-a" }],
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
