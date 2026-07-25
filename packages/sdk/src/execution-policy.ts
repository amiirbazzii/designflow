import { z } from "zod";

// ── Policy Rule Schema ─────────────────────────────────────────

export const policyRuleTypeSchema = z.enum([
  "allow_capability",
  "deny_capability",
  "require_approval",
  "resource_limit",
]);

export type PolicyRuleType = z.infer<typeof policyRuleTypeSchema>;

export const policyRuleSchema = z.object({
  id: z.string().min(1),
  type: policyRuleTypeSchema,
  target: z.string().optional(),
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

export const policyViolationSchema = z.object({
  ruleId: z.string(),
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
