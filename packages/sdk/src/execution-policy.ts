// packages/sdk/src/execution-policy.ts
import { z } from "zod";

// ── Policy Rule Schema ─────────────────────────────────────────

/**
 * The supported policy rule types. Policy-level resource limits are NOT
 * supported in this release: DesignFlow does not expose a policy contract
 * it does not enforce. Deterministic bounds (subprocess timeouts, response
 * size caps, correction-iteration limits) live in their owning layers, not
 * in policy rules. Resource metering is deferred post-MVP.
 */
export const policyRuleTypeSchema = z.enum(
  ["allow_capability", "deny_capability", "require_approval"],
  {
    errorMap: () => ({
      message:
        "Unsupported policy rule type. Supported types: allow_capability, deny_capability, require_approval. Policy-level resource limits are not supported in this release.",
    }),
  },
);

export type PolicyRuleType = z.infer<typeof policyRuleTypeSchema>;

export const policyRuleTargetSchema = z.union([
  z.string().min(1),
  z.object({
    /** Scope qualifier only — never sufficient on its own. */
    workflowId: z.string().min(1).optional(),
    nodeId: z.string().min(1).optional(),
    capabilityId: z.string().min(1).optional(),
  }).strict().refine(
    (target) => target.nodeId !== undefined || target.capabilityId !== undefined,
    {
      message:
        "An object policy target must name a nodeId or a capabilityId; workflowId is only a scope qualifier and is never sufficient on its own.",
    },
  ),
]);

export type PolicyRuleTarget = z.infer<typeof policyRuleTargetSchema>;

export const policyRuleSchema = z.object({
  id: z.string().min(1),
  type: policyRuleTypeSchema,
  target: policyRuleTargetSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type PolicyRule = z.infer<typeof policyRuleSchema>;

// ── Execution Policy Schema ────────────────────────────────────

export const executionPolicySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  rules: z.array(policyRuleSchema),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ExecutionPolicy = z.infer<typeof executionPolicySchema>;

// ── Policy Violation Schema ────────────────────────────────────

/**
 * Machine-readable violation classification. Consumers MUST branch on this
 * rather than on `message` text.
 */
export const policyViolationTypeSchema = z.enum([
  "capability_denied",
  "capability_not_allowed",
  "approval_required",
]);

export type PolicyViolationType = z.infer<typeof policyViolationTypeSchema>;

export const policyViolationSchema = z.object({
  ruleId: z.string(),
  type: policyViolationTypeSchema,
  message: z.string(),
});

export type PolicyViolation = z.infer<typeof policyViolationSchema>;

// ── Policy Evaluation Result Schema ────────────────────────────

export const policyEvaluationResultSchema = z.object({
  allowed: z.boolean(),
  violations: z.array(policyViolationSchema),
});

export type PolicyEvaluationResult = z.infer<typeof policyEvaluationResultSchema>;

// ── Policy Context Schema ──────────────────────────────────────

export const policyContextSchema = z.object({
  workflowId: z.string(),
  capabilityIds: z.array(z.string()),
  environment: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type PolicyContext = z.infer<typeof policyContextSchema>;

// ── Policy Evaluator Interface ─────────────────────────────────

export interface PolicyEvaluator {
  evaluate(
    policy: ExecutionPolicy,
    context: PolicyContext,
  ): Promise<PolicyEvaluationResult>;
}
