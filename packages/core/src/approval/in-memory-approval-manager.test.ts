import { describe, expect, test, beforeEach } from "bun:test";
import { InMemoryApprovalManager, ApprovalStateTransitionError, ApprovalNotFoundError } from "./in-memory-approval-manager";
import type { ApprovalRequest } from "@designflow/sdk";

// ── Tests ───────────────────────────────────────────────────────

describe("InMemoryApprovalManager", () => {
  let manager: InMemoryApprovalManager;

  beforeEach(() => {
    manager = new InMemoryApprovalManager();
  });

  describe("createRequest", () => {
    test("creates a pending approval request", async () => {
      const request = await manager.createRequest(
        "exec-1",
        "wf-1",
        "Approval required by policy",
      );

      expect(request.id).toBeDefined();
      expect(request.executionId).toBe("exec-1");
      expect(request.workflowId).toBe("wf-1");
      expect(request.status).toBe("pending");
      expect(request.reason).toBe("Approval required by policy");
      expect(request.createdAt).toBeGreaterThan(0);
      expect(request.resolvedAt).toBeUndefined();
    });

    test("creates unique ids for each request", async () => {
      const r1 = await manager.createRequest("exec-1", "wf-1", "reason 1");
      const r2 = await manager.createRequest("exec-2", "wf-2", "reason 2");

      expect(r1.id).not.toBe(r2.id);
    });
  });

  describe("approve", () => {
    test("approves a pending request", async () => {
      const request = await manager.createRequest("exec-1", "wf-1", "reason");

      const approved = await manager.approve(request.id);

      expect(approved.status).toBe("approved");
      expect(approved.resolvedAt).toBeGreaterThan(0);
      expect(approved.createdAt).toBe(request.createdAt);
    });

    test("approve with comment stores comment in metadata", async () => {
      const request = await manager.createRequest("exec-1", "wf-1", "reason");

      const approved = await manager.approve(request.id, "Looks good");

      expect(approved.status).toBe("approved");
      expect(approved.metadata?.comment).toBe("Looks good");
    });

    test("approving already approved request throws", async () => {
      const request = await manager.createRequest("exec-1", "wf-1", "reason");
      await manager.approve(request.id);

      await expect(manager.approve(request.id)).rejects.toThrow(ApprovalStateTransitionError);
    });

    test("approving non-existent request throws", async () => {
      await expect(manager.approve("nonexistent")).rejects.toThrow(ApprovalNotFoundError);
    });
  });

  describe("reject", () => {
    test("rejects a pending request", async () => {
      const request = await manager.createRequest("exec-1", "wf-1", "reason");

      const rejected = await manager.reject(request.id);

      expect(rejected.status).toBe("rejected");
      expect(rejected.resolvedAt).toBeGreaterThan(0);
    });

    test("reject with comment stores comment in metadata", async () => {
      const request = await manager.createRequest("exec-1", "wf-1", "reason");

      const rejected = await manager.reject(request.id, "Not approved");

      expect(rejected.status).toBe("rejected");
      expect(rejected.metadata?.comment).toBe("Not approved");
    });

    test("rejecting already rejected request throws", async () => {
      const request = await manager.createRequest("exec-1", "wf-1", "reason");
      await manager.reject(request.id);

      await expect(manager.reject(request.id)).rejects.toThrow(ApprovalStateTransitionError);
    });

    test("rejecting non-existent request throws", async () => {
      await expect(manager.reject("nonexistent")).rejects.toThrow(ApprovalNotFoundError);
    });
  });

  describe("state transitions", () => {
    test("invalid transition: approved -> rejected throws", async () => {
      const request = await manager.createRequest("exec-1", "wf-1", "reason");
      await manager.approve(request.id);

      await expect(manager.reject(request.id)).rejects.toThrow(ApprovalStateTransitionError);
    });

    test("invalid transition: rejected -> approved throws", async () => {
      const request = await manager.createRequest("exec-1", "wf-1", "reason");
      await manager.reject(request.id);

      await expect(manager.approve(request.id)).rejects.toThrow(ApprovalStateTransitionError);
    });

    test("error message contains source and target statuses", async () => {
      const request = await manager.createRequest("exec-1", "wf-1", "reason");
      await manager.approve(request.id);

      try {
        await manager.reject(request.id);
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(ApprovalStateTransitionError);
        if (error instanceof ApprovalStateTransitionError) {
          expect(error.message).toContain("approved");
          expect(error.message).toContain("rejected");
        }
      }
    });
  });

  describe("get", () => {
    test("returns null for non-existent request", async () => {
      const result = await manager.get("nonexistent");
      expect(result).toBeNull();
    });

    test("returns request after creation", async () => {
      const request = await manager.createRequest("exec-1", "wf-1", "reason");
      const result = await manager.get(request.id);

      expect(result).not.toBeNull();
      expect(result!.id).toBe(request.id);
      expect(result!.status).toBe("pending");
    });

    test("returns request after approval", async () => {
      const request = await manager.createRequest("exec-1", "wf-1", "reason");
      await manager.approve(request.id);
      const result = await manager.get(request.id);

      expect(result!.status).toBe("approved");
    });

    test("returns request after rejection", async () => {
      const request = await manager.createRequest("exec-1", "wf-1", "reason");
      await manager.reject(request.id);
      const result = await manager.get(request.id);

      expect(result!.status).toBe("rejected");
    });
  });
});