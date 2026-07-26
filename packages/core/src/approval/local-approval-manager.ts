import { join } from "node:path";
import { mkdir, readdir } from "node:fs/promises";
import { approvalRequestSchema } from "@designflow/sdk";
import type { ApprovalRequest, ApprovalManager } from "@designflow/sdk";
import { DesignFlowError } from "@designflow/sdk";
import {
  ApprovalStateTransitionError,
  ApprovalNotFoundError,
} from "./in-memory-approval-manager";

// ── Error Codes ─────────────────────────────────────────────────

const ErrorCodes = {
  SAVE_FAILED: "ERR_APPROVAL_SAVE",
  LOAD_FAILED: "ERR_APPROVAL_LOAD",
  DIRECTORY_FAILED: "ERR_APPROVAL_DIRECTORY",
  LIST_FAILED: "ERR_APPROVAL_LIST",
} as const;

// ── Allowed Transitions ─────────────────────────────────────────

const ALLOWED_TRANSITIONS: Record<string, ReadonlySet<string>> = {
  pending: new Set(["approved", "rejected"]),
};

function assertValidTransition(
  approvalId: string,
  currentStatus: string,
  targetStatus: string,
): void {
  const allowed = ALLOWED_TRANSITIONS[currentStatus];

  if (allowed === undefined || !allowed.has(targetStatus)) {
    throw new ApprovalStateTransitionError(approvalId, currentStatus, targetStatus);
  }
}

// ── Helpers ─────────────────────────────────────────────────────

function isNodeError(
  error: unknown,
): error is { code: string; message: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as Record<string, unknown>).code === "string"
  );
}

const APPROVAL_DIR = ".designflow/approvals";

// ── LocalApprovalManager ────────────────────────────────────────

export class LocalApprovalManager implements ApprovalManager {
  private readonly basePath: string;

  public constructor(basePath?: string) {
    this.basePath = basePath ?? APPROVAL_DIR;
  }

  public async createRequest(
    executionId: string,
    workflowId: string,
    reason: string,
  ): Promise<ApprovalRequest> {
    const request: ApprovalRequest = {
      id: crypto.randomUUID(),
      executionId,
      workflowId,
      status: "pending",
      reason,
      createdAt: Date.now(),
    };

    const validated = approvalRequestSchema.parse(request);
    await this.writeApproval(validated);
    return validated;
  }

  public async approve(
    approvalId: string,
    comment?: string,
  ): Promise<ApprovalRequest> {
    const request = await this.readApproval(approvalId);

    if (request === null) {
      throw new ApprovalNotFoundError(approvalId);
    }

    assertValidTransition(approvalId, request.status, "approved");

    const updated: ApprovalRequest = {
      ...request,
      status: "approved",
      resolvedAt: Date.now(),
      metadata: {
        ...request.metadata,
        ...(comment !== undefined ? { comment } : {}),
      },
    };

    const validated = approvalRequestSchema.parse(updated);
    await this.writeApproval(validated);
    return validated;
  }

  public async reject(
    approvalId: string,
    comment?: string,
  ): Promise<ApprovalRequest> {
    const request = await this.readApproval(approvalId);

    if (request === null) {
      throw new ApprovalNotFoundError(approvalId);
    }

    assertValidTransition(approvalId, request.status, "rejected");

    const updated: ApprovalRequest = {
      ...request,
      status: "rejected",
      resolvedAt: Date.now(),
      metadata: {
        ...request.metadata,
        ...(comment !== undefined ? { comment } : {}),
      },
    };

    const validated = approvalRequestSchema.parse(updated);
    await this.writeApproval(validated);
    return validated;
  }

  public async get(approvalId: string): Promise<ApprovalRequest | null> {
    return this.readApproval(approvalId);
  }

  // ── File System ─────────────────────────────────────────────

  private approvalPath(approvalId: string): string {
    return join(this.basePath, `${approvalId}.json`);
  }

  private async ensureDir(dir: string): Promise<void> {
    try {
      await mkdir(dir, { recursive: true });
    } catch (error) {
      throw new DesignFlowError(
        ErrorCodes.DIRECTORY_FAILED,
        "Failed to create approvals directory",
        { dir, error: String(error) },
      );
    }
  }

  private async readApproval(approvalId: string): Promise<ApprovalRequest | null> {
    try {
      const filePath = this.approvalPath(approvalId);
      const file = Bun.file(filePath);
      const exists = await file.exists();

      if (!exists) return null;

      const raw = await file.json();
      return approvalRequestSchema.parse(raw);
    } catch (error) {
      if (error instanceof DesignFlowError) throw error;
      throw new DesignFlowError(
        ErrorCodes.LOAD_FAILED,
        `Failed to load approval: ${approvalId}`,
        { approvalId, error: String(error) },
      );
    }
  }

  private async writeApproval(approval: ApprovalRequest): Promise<void> {
    try {
      const filePath = this.approvalPath(approval.id);
      const dir = filePath.substring(0, filePath.lastIndexOf("/"));
      await this.ensureDir(dir);

      const tmpPath = `${filePath}.tmp`;
      const json = JSON.stringify(approval, null, 2);
      await Bun.write(tmpPath, json);

      const { rename } = await import("node:fs/promises");
      await rename(tmpPath, filePath);
    } catch (error) {
      throw new DesignFlowError(
        ErrorCodes.SAVE_FAILED,
        `Failed to save approval: ${approval.id}`,
        { approvalId: approval.id, error: String(error) },
      );
    }
  }

  public async listApprovals(): Promise<readonly string[]> {
    try {
      const entries = await readdir(this.basePath);
      return entries
        .filter((entry) => entry.endsWith(".json"))
        .map((entry) => entry.replace(/\.json$/, ""));
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw new DesignFlowError(
        ErrorCodes.LIST_FAILED,
        "Failed to list approvals",
        { basePath: this.basePath, error: String(error) },
      );
    }
  }
}