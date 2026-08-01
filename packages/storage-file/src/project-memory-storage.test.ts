// packages/storage-file/src/project-memory-storage.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DesignFlowError } from "@designflow/sdk";
import { FileStore } from "./store";
import {
  FileAgentMemoryStore,
  FileMemoryProposalStore,
  FileProjectContextStore,
  FileProjectStore,
} from "./adapters";

/**
 * File-store adapter tests for Stage 40's project/memory collections — the
 * same two claims `storage.test.ts` makes for every other collection: each
 * adapter honours its contract, and a fresh `FileStore` over the same path
 * recovers what an earlier one wrote.
 */

const workspaces: string[] = [];

function newPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "designflow-project-memory-"));
  workspaces.push(dir);
  return join(dir, "store.json");
}

afterEach(() => {
  for (const dir of workspaces.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const expectCode = async (promise: Promise<unknown>, code: string): Promise<void> => {
  try {
    await promise;
    throw new Error(`expected rejection with code ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(DesignFlowError);
    expect((error as DesignFlowError).code).toBe(code);
  }
};

const NOW = "2026-08-01T10:00:00.000Z";

const PROJECT = {
  id: "project-1",
  name: "Storefront",
  rootPath: "/repo/storefront",
  createdAt: NOW,
  updatedAt: NOW,
};

describe("FileProjectStore", () => {
  test("persists a project and reads it back", async () => {
    const store = new FileStore(newPath());
    const projects = new FileProjectStore(store);

    await projects.createProject(PROJECT);

    expect((await projects.getProject("project-1"))?.name).toBe("Storefront");
  });

  test("refuses to create a project under an id already in use", async () => {
    const projects = new FileProjectStore(new FileStore(newPath()));
    await projects.createProject(PROJECT);

    await expectCode(projects.createProject(PROJECT), "ERR_PROJECT_ALREADY_EXISTS");
  });

  test("updateProject refuses an unknown project", async () => {
    const projects = new FileProjectStore(new FileStore(newPath()));
    await expectCode(
      projects.updateProject("nope", { updatedAt: NOW }),
      "ERR_PROJECT_NOT_FOUND",
    );
  });

  test("survives a restart", async () => {
    const path = newPath();
    const first = new FileStore(path);
    await new FileProjectStore(first).createProject(PROJECT);
    first.close();

    const reloaded = new FileProjectStore(new FileStore(path));
    expect(await reloaded.listProjects()).toHaveLength(1);
  });

  test("a corrupt project entry is dropped, not thrown", async () => {
    const store = new FileStore(newPath());
    await new FileProjectStore(store).createProject(PROJECT);

    store.mutate((document) => {
      // @ts-expect-error deliberately corrupting a stored record for the test
      document.projects["broken"] = { id: "broken" };
    });

    const projects = new FileProjectStore(store);
    expect(await projects.getProject("broken")).toBeNull();
    expect((await projects.listProjects()).map((p) => p.id)).toEqual(["project-1"]);
  });
});

describe("FileProjectContextStore", () => {
  test("patchFacts creates version 1 from an empty replaceContext, then upserts", async () => {
    const contexts = new FileProjectContextStore(new FileStore(newPath()));

    await contexts.replaceContext("project-1", null, {
      projectId: "project-1",
      version: 1,
      updatedAt: NOW,
      facts: [],
    });

    const updated = await contexts.patchFacts("project-1", 1, [
      { op: "upsert", fact: { key: "project.framework", value: "react", source: "inspection" } },
    ]);

    expect(updated.version).toBe(2);
    expect(updated.facts).toHaveLength(1);
    expect(updated.facts[0]?.value).toBe("react");
  });

  test("replaceContext refuses a stale expectedVersion", async () => {
    const contexts = new FileProjectContextStore(new FileStore(newPath()));
    await contexts.replaceContext("project-1", null, {
      projectId: "project-1",
      version: 1,
      updatedAt: NOW,
      facts: [],
    });

    await expectCode(
      contexts.replaceContext("project-1", null, {
        projectId: "project-1",
        version: 1,
        updatedAt: NOW,
        facts: [],
      }),
      "ERR_PROJECT_CONTEXT_CONFLICT",
    );
  });

  test("patchFacts refuses an unknown project", async () => {
    const contexts = new FileProjectContextStore(new FileStore(newPath()));
    await expectCode(
      contexts.patchFacts("nope", 1, [{ op: "remove", key: "x" }]),
      "ERR_PROJECT_CONTEXT_NOT_FOUND",
    );
  });

  test("survives a restart", async () => {
    const path = newPath();
    const first = new FileStore(path);
    await new FileProjectContextStore(first).replaceContext("project-1", null, {
      projectId: "project-1",
      version: 1,
      updatedAt: NOW,
      facts: [],
    });
    first.close();

    const reloaded = new FileProjectContextStore(new FileStore(path));
    expect((await reloaded.getContext("project-1"))?.version).toBe(1);
  });
});

const MEMORY = {
  id: "memory-1",
  scope: "agent" as const,
  agentId: "design-engineer-agent",
  key: "prefer.existingComponents",
  value: true,
  source: "user_approved" as const,
  createdAt: NOW,
  updatedAt: NOW,
  status: "active" as const,
};

describe("FileAgentMemoryStore", () => {
  test("persists and lists memory", async () => {
    const memories = new FileAgentMemoryStore(new FileStore(newPath()));
    await memories.create(MEMORY);

    expect(await memories.list({ agentId: "design-engineer-agent" })).toHaveLength(1);
  });

  test("revoke sets status and excludes it from an active-only list", async () => {
    const memories = new FileAgentMemoryStore(new FileStore(newPath()));
    await memories.create(MEMORY);

    const revoked = await memories.revoke("memory-1", "2026-08-02T00:00:00.000Z");
    expect(revoked.status).toBe("revoked");

    expect(await memories.list({ status: "active" })).toHaveLength(0);
  });

  test("revoke refuses an unknown id", async () => {
    const memories = new FileAgentMemoryStore(new FileStore(newPath()));
    await expectCode(memories.revoke("nope", NOW), "ERR_MEMORY_NOT_FOUND");
  });

  test("survives a restart", async () => {
    const path = newPath();
    const first = new FileStore(path);
    await new FileAgentMemoryStore(first).create(MEMORY);
    first.close();

    const reloaded = new FileAgentMemoryStore(new FileStore(path));
    expect(await reloaded.get("memory-1")).not.toBeNull();
  });
});

const PROPOSAL = {
  id: "proposal-1",
  proposedByAgentId: "design-engineer-agent",
  scope: "agent" as const,
  key: "prefer.existingComponents",
  value: true,
  rationaleSummary: "Prefer existing design-system components.",
  createdAt: NOW,
  expiresAt: "2026-08-31T00:00:00.000Z",
  status: "pending" as const,
};

describe("FileMemoryProposalStore", () => {
  test("approve transitions status and records who approved it", async () => {
    const proposals = new FileMemoryProposalStore(new FileStore(newPath()));
    await proposals.create(PROPOSAL);

    const approved = await proposals.approve("proposal-1", "user", "2026-08-02T00:00:00.000Z");
    expect(approved.status).toBe("approved");
    expect(approved.resolvedBy).toBe("user");
  });

  test("a resolved proposal cannot be resolved again", async () => {
    const proposals = new FileMemoryProposalStore(new FileStore(newPath()));
    await proposals.create(PROPOSAL);
    await proposals.approve("proposal-1", "user", "2026-08-02T00:00:00.000Z");

    await expectCode(
      proposals.reject("proposal-1", "user", "2026-08-03T00:00:00.000Z"),
      "ERR_MEMORY_PROPOSAL_STATE_INVALID",
    );
  });

  test("survives a restart", async () => {
    const path = newPath();
    const first = new FileStore(path);
    await new FileMemoryProposalStore(first).create(PROPOSAL);
    first.close();

    const reloaded = new FileMemoryProposalStore(new FileStore(path));
    expect(await reloaded.list()).toHaveLength(1);
  });
});
