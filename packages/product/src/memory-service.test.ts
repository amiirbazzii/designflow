// packages/product/src/memory-service.test.ts
import { describe, expect, test } from "bun:test";
import { DesignFlowError } from "@designflow/sdk";
import { InMemoryAgentMemoryStore } from "./memory-store";
import { InMemoryMemoryProposalStore } from "./memory-proposal-store";
import { AgentMemoryService, MemoryProposalService } from "./memory-service";

const NOW = "2026-08-01T00:00:00.000Z";
const LATER = "2026-08-02T00:00:00.000Z";

function services(clock: { current: string }) {
  const memory = new AgentMemoryService({
    store: new InMemoryAgentMemoryStore(),
    now: () => clock.current,
  });
  const proposals = new MemoryProposalService({
    store: new InMemoryMemoryProposalStore(),
    memory,
    now: () => clock.current,
  });

  return { memory, proposals };
}

describe("AgentMemoryService", () => {
  test("addMemory replaces a same-scope same-key memory explicitly", async () => {
    const { memory } = services({ current: NOW });

    const first = await memory.addMemory({
      scope: "agent",
      agentId: "design-engineer-agent",
      key: "prefer",
      value: "a",
      source: "user_approved",
    });

    const second = await memory.addMemory({
      scope: "agent",
      agentId: "design-engineer-agent",
      key: "prefer",
      value: "b",
      source: "user_approved",
    });

    const active = await memory.listMemory({ status: "active" });
    expect(active).toHaveLength(1);
    expect(active[0]?.id).toBe(second.id);

    const revoked = await memory.listMemory({ status: "revoked" });
    expect(revoked.map((m) => m.id)).toEqual([first.id]);
  });

  test("rejects a secret-like value", async () => {
    const { memory } = services({ current: NOW });

    await expect(
      memory.addMemory({
        scope: "agent",
        agentId: "design-engineer-agent",
        key: "credential",
        value: "sk-abcdefghijk12345",
        source: "user_approved",
      }),
    ).rejects.toThrow();
  });
});

describe("MemoryProposalService approval flow", () => {
  test("propose does not create memory", async () => {
    const { memory, proposals } = services({ current: NOW });

    await proposals.propose({
      proposedByAgentId: "design-engineer-agent",
      scope: "agent",
      key: "prefer",
      value: true,
      rationaleSummary: "Prefer existing components.",
    });

    expect(await memory.listMemory()).toHaveLength(0);
  });

  test("approve creates active memory and records resolution", async () => {
    const { memory, proposals } = services({ current: NOW });

    const proposal = await proposals.propose({
      proposedByAgentId: "design-engineer-agent",
      scope: "agent",
      key: "prefer",
      value: true,
      rationaleSummary: "Prefer existing components.",
    });

    const created = await proposals.approve(proposal.id, "user");

    expect(created.status).toBe("active");
    expect(created.source).toBe("user_approved");

    const resolved = await proposals.getProposal(proposal.id);
    expect(resolved?.status).toBe("approved");
  });

  test("reject creates no memory", async () => {
    const { memory, proposals } = services({ current: NOW });

    const proposal = await proposals.propose({
      proposedByAgentId: "design-engineer-agent",
      scope: "agent",
      key: "prefer",
      value: true,
      rationaleSummary: "Prefer existing components.",
    });

    await proposals.reject(proposal.id, "user");

    expect(await memory.listMemory()).toHaveLength(0);
    expect((await proposals.getProposal(proposal.id))?.status).toBe("rejected");
  });

  test("an agent cannot approve its own proposal", async () => {
    const { proposals } = services({ current: NOW });

    const proposal = await proposals.propose({
      proposedByAgentId: "design-engineer-agent",
      scope: "agent",
      key: "prefer",
      value: true,
      rationaleSummary: "Prefer existing components.",
    });

    await expect(proposals.approve(proposal.id, "design-engineer-agent")).rejects.toMatchObject({
      code: "ERR_MEMORY_APPROVAL_REQUIRED",
    });
  });

  test("a rejected proposal cannot be approved afterward", async () => {
    const { proposals } = services({ current: NOW });

    const proposal = await proposals.propose({
      proposedByAgentId: "design-engineer-agent",
      scope: "agent",
      key: "prefer",
      value: true,
      rationaleSummary: "Prefer existing components.",
    });

    await proposals.reject(proposal.id, "user");

    await expect(proposals.approve(proposal.id, "user")).rejects.toBeInstanceOf(DesignFlowError);
  });

  test("an expired proposal cannot be approved", async () => {
    const clock = { current: NOW };
    const { proposals } = services(clock);

    const proposal = await proposals.propose({
      proposedByAgentId: "design-engineer-agent",
      scope: "agent",
      key: "prefer",
      value: true,
      rationaleSummary: "Prefer existing components.",
    });

    clock.current = "2027-01-01T00:00:00.000Z"; // well past the 30-day default expiry

    await expect(proposals.approve(proposal.id, "user")).rejects.toMatchObject({
      code: "ERR_MEMORY_PROPOSAL_EXPIRED",
    });
  });

  test("revoked memory disappears from an active-only list", async () => {
    const { memory, proposals } = services({ current: NOW });

    const proposal = await proposals.propose({
      proposedByAgentId: "design-engineer-agent",
      scope: "agent",
      key: "prefer",
      value: true,
      rationaleSummary: "Prefer existing components.",
    });

    const created = await proposals.approve(proposal.id, "user");
    await memory.revokeMemory(created.id);

    expect(await memory.listMemory({ status: "active" })).toHaveLength(0);
  });
});
