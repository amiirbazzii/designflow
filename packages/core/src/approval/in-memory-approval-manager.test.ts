// packages/core/src/approval/in-memory-approval-manager.test.ts
import { describe, expect, test, beforeEach } from "bun:test";
import { isApprovalExpired } from "@designflow/sdk";
import {
  InMemoryApprovalManager,
  ApprovalStateTransitionError,
  ApprovalNotFoundError,
  ApprovalExpiredError,
} from "./in-memory-approval-manager";

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

  describe("expiry", () => {
    test("createRequest defaults expiresAt to roughly seven days out", async () => {
      const before = Date.now();
      const request = await manager.createRequest("exec-1", "wf-1", "reason");
      const after = Date.now();

      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      expect(request.expiresAt).toBeGreaterThanOrEqual(before + sevenDaysMs);
      expect(request.expiresAt).toBeLessThanOrEqual(after + sevenDaysMs);
    });

    test("an expired pending request cannot be approved", async () => {
      const request = await manager.createRequest("exec-1", "wf-1", "reason", Date.now() - 1);

      await expect(manager.approve(request.id)).rejects.toThrow(ApprovalExpiredError);
    });

    test("an expired pending request cannot be rejected", async () => {
      const request = await manager.createRequest("exec-1", "wf-1", "reason", Date.now() - 1);

      await expect(manager.reject(request.id)).rejects.toThrow(ApprovalExpiredError);
    });

    test("an approved request is never reported as expired, no matter its expiresAt", async () => {
      const request = await manager.createRequest("exec-1", "wf-1", "reason", Date.now() + 10);
      const approved = await manager.approve(request.id);

      // `isApprovalExpired` is the single source of truth every manager
      // consults — a settled request stays reading as what it settled as,
      // even once wall-clock time passes its (now irrelevant) `expiresAt`.
      expect(isApprovalExpired(approved, Date.now() + 1_000_000)).toBe(false);
    });

    test("expireStale marks a stale pending request expired and is idempotent", async () => {
      const stale = await manager.createRequest("exec-1", "wf-1", "reason", Date.now() - 1);
      const fresh = await manager.createRequest("exec-2", "wf-2", "reason", Date.now() + 100_000);

      const first = await manager.expireStale(Date.now());
      expect(first.map((request) => request.id)).toEqual([stale.id]);
      expect((await manager.get(stale.id))?.status).toBe("expired");
      expect((await manager.get(fresh.id))?.status).toBe("pending");

      const second = await manager.expireStale(Date.now());
      expect(second).toEqual([]);
    });

    test("expireStale never touches an already-decided request", async () => {
      // Decided while still within its window...
      const request = await manager.createRequest("exec-1", "wf-1", "reason", Date.now() + 50);
      await manager.reject(request.id, "handled before expiry check ran");

      // ...then `expireStale` runs long after that same `expiresAt` passed.
      // A decided request is never `pending`, so it is never a candidate.
      const expired = await manager.expireStale(Date.now() + 1_000_000);
      expect(expired).toEqual([]);
      expect((await manager.get(request.id))?.status).toBe("rejected");
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