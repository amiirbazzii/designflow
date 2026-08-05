// packages/core/src/policy/in-memory-policy-evaluator.ts
import {
  executionPolicySchema,
  policyContextSchema,
  type ExecutionPolicy,
  type PolicyContext,
  type PolicyEvaluationResult,
  type PolicyEvaluator,
  type PolicyRule,
} from "@designflow/sdk";

import { PolicyViolationError } from "../errors";

// ── In-Memory Policy Evaluator ─────────────────────────────────

export class InMemoryPolicyEvaluator implements PolicyEvaluator {
  public async evaluate(
    policy: ExecutionPolicy,
    context: PolicyContext,
  ): Promise<PolicyEvaluationResult> {
    const validatedPolicy = executionPolicySchema.parse(policy);
    const validatedContext = policyContextSchema.parse(context);

    const violations: PolicyEvaluationResult["violations"] = [];

    const denyRules = validatedPolicy.rules.filter((r) => r.type === "deny_capability");
    const allowRules = validatedPolicy.rules.filter((r) => r.type === "allow_capability");
    const approvalRules = validatedPolicy.rules.filter((r) => r.type === "require_approval");

    for (const rule of denyRules) {
      this.evaluateDenyRule(rule, validatedContext, violations);
    }

    if (allowRules.length > 0) {
      this.evaluateAllowRules(allowRules, validatedContext, violations);
    }

    for (const rule of approvalRules) {
      this.evaluateApprovalRule(rule, validatedContext, violations);
    }

    return {
      allowed: violations.length === 0,
      violations,
    };
  }

  private evaluateDenyRule(
    rule: PolicyRule,
    context: PolicyContext,
    violations: PolicyEvaluationResult["violations"],
  ): void {
    if (rule.target === undefined) return;

    const target = rule.target;

    for (const capabilityId of context.capabilityIds) {
      if (this.targetMatches(target, context, capabilityId)) {
        violations.push({
          ruleId: rule.id,
          type: "capability_denied",
          message: `Capability "${capabilityId}" is denied by policy rule "${rule.id}"`,
        });
      }
    }
  }

  private evaluateAllowRules(
    allowRules: PolicyRule[],
    context: PolicyContext,
    violations: PolicyEvaluationResult["violations"],
  ): void {
    const allowedCapabilities = new Set(
      allowRules
      .filter((r) => typeof r.target === "string")
        .map((r) => r.target as string),
    );

    for (const capabilityId of context.capabilityIds) {
      if (!allowedCapabilities.has(capabilityId)) {
        violations.push({
          ruleId: allowRules[0]?.id ?? "allow_rule",
          type: "capability_not_allowed",
          message: `Capability "${capabilityId}" is not in the allowed capabilities list`,
        });
      }
    }
  }

  private evaluateApprovalRule(
    rule: PolicyRule,
    context: PolicyContext,
    violations: PolicyEvaluationResult["violations"],
  ): void {
    if (rule.target === undefined) return;

    const target = rule.target;
    const humanReason = typeof rule.metadata?.["reason"] === "string" ? rule.metadata["reason"] : undefined;
    const message = humanReason !== undefined
      ? `Approval required: ${humanReason}`
      : "Approval required before this step can continue";

    for (const capabilityId of context.capabilityIds) {
      if (this.targetMatches(target, context, capabilityId)) {
        violations.push({
          ruleId: rule.id,
          type: "approval_required",
          message,
        });
      }
    }
  }

  /**
   * AND semantics over the target's supplied fields, decided by the target
   * alone: every supplied field must match the context; omitted fields
   * impose no condition. A node-scoped selector simply does not match a
   * context that carries no node (e.g. workflow-level pre-flight) — the
   * per-node evaluation enforces it. `workflowId` is a scope qualifier and
   * is never sufficient by itself; the schema rejects such targets, and an
   * invalid target reaching this point through an unchecked internal path
   * fails loudly rather than silently open.
   */
  private targetMatches(
    target: PolicyRule["target"],
    context: PolicyContext,
    capabilityId: string,
  ): boolean {
    if (typeof target === "string") return target === capabilityId;
    if (target === undefined) return false;
    if (target.nodeId === undefined && target.capabilityId === undefined) {
      throw new PolicyViolationError(
        "A policy target must name a nodeId or a capabilityId; a workflowId-only or empty object target is structurally invalid.",
        { workflowId: context.workflowId },
      );
    }
    if (target.workflowId !== undefined && target.workflowId !== context.workflowId) return false;
    if (target.capabilityId !== undefined && target.capabilityId !== capabilityId) return false;
    if (target.nodeId !== undefined) {
      const nodeId = typeof context.metadata?.["nodeId"] === "string" ? context.metadata["nodeId"] : undefined;
      if (target.nodeId !== nodeId) return false;
    }
    return true;
  }
}
