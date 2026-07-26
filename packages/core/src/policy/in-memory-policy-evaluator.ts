import {
  executionPolicySchema,
  policyContextSchema,
} from "@designflow/sdk";
import type {
  ExecutionPolicy,
  PolicyContext,
  PolicyEvaluationResult,
  PolicyEvaluator,
  PolicyRule,
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

    const deniedCapability = rule.target;

    for (const capabilityId of context.capabilityIds) {
      if (capabilityId === deniedCapability) {
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
        .filter(
          (r): r is PolicyRule & { target: string } =>
            r.target !== undefined,
        )
        .map((r) => r.target),
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
    _context: PolicyContext,
    violations: PolicyEvaluationResult["violations"],
  ): void {
    violations.push({
      ruleId: rule.id,
      type: "approval_required",
      message: `Approval required by policy rule "${rule.id}"`,
    });
  }

  private evaluateResourceRule(
    rule: PolicyRule,
    _context: PolicyContext,
    _violations: PolicyEvaluationResult["violations"],
  ): void {
    // Store rule only - no runtime resource tracking yet
  }
}
