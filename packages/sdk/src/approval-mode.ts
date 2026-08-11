import { z } from "zod";

export const approvalModeSchema = z.enum(["manual", "designflow"]);
export type ApprovalMode = z.infer<typeof approvalModeSchema>;

export const approvalAuthorizationSchema = z.object({
  schemaVersion: z.literal("1"),
  mode: approvalModeSchema,
  selectedAt: z.number().int().nonnegative(),
  source: z.enum(["user", "legacy-default"]),
  scope: z.object({
    projectId: z.string().min(1).optional(),
    destination: z.string().min(1).optional(),
  }).strict(),
}).strict();

export type ApprovalAuthorization = z.infer<typeof approvalAuthorizationSchema>;

export const APPROVAL_AUTHORIZATION_METADATA_KEY = "designflowApproval";

export function approvalAuthorizationFromInput(
  input: unknown,
  fallbackSelectedAt = Date.now(),
): ApprovalAuthorization {
  const value = asRecord(input);
  const requestedMode = approvalModeSchema.safeParse(value?.approvalMode);
  const mode = requestedMode.success ? requestedMode.data : "manual";
  const selectedAt = typeof value?.approvalSelectedAt === "number" && Number.isInteger(value.approvalSelectedAt) && value.approvalSelectedAt >= 0
    ? value.approvalSelectedAt
    : fallbackSelectedAt;
  const project = asRecord(value?.project);
  const destination = asRecord(value?.destination);

  return approvalAuthorizationSchema.parse({
    schemaVersion: "1",
    mode,
    selectedAt,
    source: requestedMode.success ? "user" : "legacy-default",
    scope: {
      ...(typeof project?.id === "string" ? { projectId: project.id } : {}),
      ...(typeof destination?.path === "string" ? { destination: destination.path } : {}),
    },
  });
}

export function stripApprovalModeInput(input: unknown): unknown {
  const value = asRecord(input);
  if (value === undefined) return input;
  const { approvalMode: _approvalMode, approvalSelectedAt: _approvalSelectedAt, ...rest } = value;
  return rest;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
