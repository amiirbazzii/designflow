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
    const resourceRules = validatedPolicy.rules.filter((r) => r.type === "resource_limit");

    for (const rule of denyRules) {
      this.evaluateDenyRule(rule, validatedContext, violations);
    }

    if (allowRules.length > 0) {
      this.evaluateAllowRules(allowRules, validatedContext, violations);
    }

    for (const rule of approvalRules) {
      this.evaluateApprovalRule(rule, validatedContext, violations);
    }

    for (const rule of resourceRules) {
      this.evaluateResourceRule(rule, validatedContext, violations);
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

  private targetMatches(
    target: PolicyRule["target"],
    context: PolicyContext,
    capabilityId: string,
  ): boolean {
    if (typeof target === "string") return target === capabilityId;
    if (target === undefined) return false;
    if (target.workflowId !== undefined && target.workflowId !== context.workflowId) return false;
    if (target.capabilityId !== undefined && target.capabilityId !== capabilityId) return false;
    const nodeId = typeof context.metadata?.nodeId === "string" ? context.metadata.nodeId : undefined;
    if (target.nodeId !== undefined && target.nodeId !== nodeId) return false;
    return nodeId !== undefined || target.capabilityId !== undefined;
  }

  private evaluateResourceRule(
    _rule: PolicyRule,
    _context: PolicyContext,
    _violations: PolicyEvaluationResult["violations"],
  ): void {
    // Store rule only - no runtime resource tracking yet
  }
}
