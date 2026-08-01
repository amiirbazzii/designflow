// packages/core/src/approval/local-approval-manager.test.ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { LocalApprovalManager } from "./local-approval-manager";
import {
  ApprovalStateTransitionError,
  ApprovalNotFoundError,
  ApprovalExpiredError,
} from "./in-memory-approval-manager";
import { unlink, readdir } from "node:fs/promises";

const TEST_DIR = ".designflow-test-approvals";

async function cleanTestDir(): Promise<void> {
  try {
    const entries = await readdir(TEST_DIR);
    for (const entry of entries) {
      await unlink(`${TEST_DIR}/${entry}`);
    }
    await unlink(TEST_DIR);
  } catch {
    // ignore
  }
}

// ── Tests ───────────────────────────────────────────────────────

describe("LocalApprovalManager", () => {
  let manager: LocalApprovalManager;

  beforeEach(async () => {
    await cleanTestDir();
    manager = new LocalApprovalManager(TEST_DIR);
  });

  afterEach(async () => {
    await cleanTestDir();
  });

  describe("createRequest", () => {
    test("creates a pending approval request on disk", async () => {
      const request = await manager.createRequest(
        "exec-1",
        "wf-1",
        "Approval required by policy",
      );

      expect(request.id).toBeDefined();
      expect(request.status).toBe("pending");
      expect(request.resolvedAt).toBeUndefined();
    });

    test("persists to disk so another manager instance can read it", async () => {
      const request = await manager.createRequest("exec-1", "wf-1", "reason");

      const manager2 = new LocalApprovalManager(TEST_DIR);
      const loaded = await manager2.get(request.id);

      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe(request.id);
      expect(loaded!.status).toBe("pending");
      expect(loaded!.reason).toBe("reason");
    });
  });

  describe("approve", () => {
    test("approves a pending request and persists", async () => {
      const request = await manager.createRequest("exec-1", "wf-1", "reason");

      const approved = await manager.approve(request.id);

      expect(approved.status).toBe("approved");
      expect(approved.resolvedAt).toBeGreaterThan(0);

      const manager2 = new LocalApprovalManager(TEST_DIR);
      const loaded = await manager2.get(request.id);
      expect(loaded!.status).toBe("approved");
    });

    test("approve with comment stores comment in metadata", async () => {
      const request = await manager.createRequest("exec-1", "wf-1", "reason");

      const approved = await manager.approve(request.id, "Looks good");

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
    test("rejects a pending request and persists", async () => {
      const request = await manager.createRequest("exec-1", "wf-1", "reason");

      const rejected = await manager.reject(request.id);

      expect(rejected.status).toBe("rejected");
      expect(rejected.resolvedAt).toBeGreaterThan(0);

      const manager2 = new LocalApprovalManager(TEST_DIR);
      const loaded = await manager2.get(request.id);
      expect(loaded!.status).toBe("rejected");
    });

    test("reject with comment stores comment in metadata", async () => {
      const request = await manager.createRequest("exec-1", "wf-1", "reason");

      const rejected = await manager.reject(request.id, "Not approved");

      expect(rejected.metadata?.comment).toBe("Not approved");
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
  });

  describe("validate on read", () => {
    test("get validates data with approvalRequestSchema", async () => {
      const request = await manager.createRequest("exec-1", "wf-1", "reason");

      const loaded = await manager.get(request.id);
      expect(loaded).not.toBeNull();
      expect(loaded!.status).toBe("pending");
    });
  });

  describe("expiry", () => {
    test("an expired pending request cannot be approved or rejected", async () => {
      const request = await manager.createRequest("exec-1", "wf-1", "reason", Date.now() - 1);

      await expect(manager.approve(request.id)).rejects.toThrow(ApprovalExpiredError);
      await expect(manager.reject(request.id)).rejects.toThrow(ApprovalExpiredError);
    });

    test("expireStale persists expired to disk and is idempotent", async () => {
      const stale = await manager.createRequest("exec-1", "wf-1", "reason", Date.now() - 1);
      const fresh = await manager.createRequest("exec-2", "wf-2", "reason", Date.now() + 100_000);

      const first = await manager.expireStale(Date.now());
      expect(first.map((request) => request.id)).toEqual([stale.id]);

      const manager2 = new LocalApprovalManager(TEST_DIR);
      expect((await manager2.get(stale.id))?.status).toBe("expired");
      expect((await manager2.get(fresh.id))?.status).toBe("pending");

      const second = await manager.expireStale(Date.now());
      expect(second).toEqual([]);
    });
  });

  describe("listApprovals", () => {
    test("lists all approval IDs", async () => {
      const r1 = await manager.createRequest("exec-1", "wf-1", "reason1");
      const r2 = await manager.createRequest("exec-2", "wf-1", "reason2");

      const ids = await manager.listApprovals();
      expect(ids.length).toBe(2);
      expect(ids).toContain(r1.id);
      expect(ids).toContain(r2.id);
    });

    test("returns empty list for empty directory", async () => {
      const ids = await manager.listApprovals();
      expect(ids).toEqual([]);
    });
  });
});