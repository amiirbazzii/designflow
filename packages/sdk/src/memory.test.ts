// packages/sdk/src/memory.test.ts
import { describe, expect, test } from "bun:test";
import { agentMemorySchema, memoryProposalSchema } from "./memory";

const NOW = "2026-08-01T00:00:00.000Z";

function memory(overrides: Record<string, unknown> = {}) {
  return {
    id: "mem-1",
    scope: "agent",
    agentId: "design-engineer-agent",
    key: "prefer.existingComponents",
    value: true,
    source: "user_approved",
    createdAt: NOW,
    updatedAt: NOW,
    status: "active",
    ...overrides,
  };
}

describe("agentMemorySchema scope rules", () => {
  test("accepts agent scope with agentId only", () => {
    expect(() => agentMemorySchema.parse(memory())).not.toThrow();
  });

  test("rejects agent scope missing agentId", () => {
    expect(() => agentMemorySchema.parse(memory({ agentId: undefined }))).toThrow();
  });

  test("rejects agent scope carrying projectId", () => {
    expect(() => agentMemorySchema.parse(memory({ projectId: "proj-1" }))).toThrow();
  });

  test("accepts project scope with projectId only", () => {
    expect(() =>
      agentMemorySchema.parse(memory({ scope: "project", agentId: undefined, projectId: "proj-1" })),
    ).not.toThrow();
  });

  test("rejects project scope missing projectId", () => {
    expect(() => agentMemorySchema.parse(memory({ scope: "project", agentId: undefined }))).toThrow();
  });

  test("accepts project_agent scope with both ids", () => {
    expect(() =>
      agentMemorySchema.parse(memory({ scope: "project_agent", projectId: "proj-1" })),
    ).not.toThrow();
  });

  test("rejects project_agent scope missing projectId", () => {
    expect(() => agentMemorySchema.parse(memory({ scope: "project_agent" }))).toThrow();
  });

  test("rejects a secret-like value", () => {
    expect(() => agentMemorySchema.parse(memory({ value: "sk-abcdefghijk12345" }))).toThrow();
  });

  test("rejects unknown fields (strict)", () => {
    expect(() => agentMemorySchema.parse({ ...memory(), extra: 1 })).toThrow();
  });
});

describe("memoryProposalSchema", () => {
  function proposal(overrides: Record<string, unknown> = {}) {
    return {
      id: "prop-1",
      proposedByAgentId: "design-engineer-agent",
      scope: "agent",
      key: "prefer.existingComponents",
      value: true,
      rationaleSummary: "Prefer existing design-system components.",
      createdAt: NOW,
      expiresAt: "2026-08-31T00:00:00.000Z",
      status: "pending",
      ...overrides,
    };
  }

  test("accepts a well-formed pending proposal", () => {
    expect(() => memoryProposalSchema.parse(proposal())).not.toThrow();
  });

  test("project_agent scope requires projectId", () => {
    expect(() => memoryProposalSchema.parse(proposal({ scope: "project_agent" }))).toThrow();
  });

  test("rejects an overlong rationale", () => {
    expect(() =>
      memoryProposalSchema.parse(proposal({ rationaleSummary: "x".repeat(600) })),
    ).toThrow();
  });
});
