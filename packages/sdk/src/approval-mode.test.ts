import { describe, expect, test } from "bun:test";
import {
  approvalAuthorizationFromInput,
  approvalAuthorizationSchema,
  stripApprovalModeInput,
} from "./approval-mode";

describe("approval authorization", () => {
  test("defaults legacy input to a manual authorization", () => {
    const authorization = approvalAuthorizationFromInput(
      { project: { id: "project-1" }, destination: { path: "/add" } },
      123,
    );

    expect(authorization).toEqual({
      schemaVersion: "1",
      mode: "manual",
      selectedAt: 123,
      source: "legacy-default",
      scope: { projectId: "project-1", destination: "/add" },
    });
  });

  test("preserves the explicit mode and bounded scope", () => {
    const authorization = approvalAuthorizationFromInput({
      approvalMode: "designflow",
      approvalSelectedAt: 456,
      project: { id: "project-1" },
      destination: { path: "/add" },
    });

    expect(approvalAuthorizationSchema.parse(authorization).mode).toBe("designflow");
    expect(authorization.scope).toEqual({ projectId: "project-1", destination: "/add" });
  });

  test("removes approval controls before workflow input reaches agents", () => {
    expect(stripApprovalModeInput({
      approvalMode: "designflow",
      approvalSelectedAt: 456,
      destination: { path: "/add" },
    })).toEqual({ destination: { path: "/add" } });
  });

  test("rejects unknown persisted authorization modes", () => {
    expect(approvalAuthorizationSchema.safeParse({
      schemaVersion: "1",
      mode: "everything",
      selectedAt: 1,
      source: "user",
      scope: {},
    }).success).toBe(false);
  });
});
