// packages/capabilities/figma-mcp/src/resolve-frames.test.ts
import { describe, expect, test } from "bun:test";
import type { FigmaNodeSnapshot } from "@designflow/sdk";
import { resolveFigmaFrames } from "./resolve-frames";

function node(overrides: Partial<FigmaNodeSnapshot> & Pick<FigmaNodeSnapshot, "id" | "name">): FigmaNodeSnapshot {
  return {
    type: "FRAME",
    childIds: [],
    fills: [],
    strokes: [],
    effects: [],
    exportSettings: [],
    interactions: [],
    properties: {},
    ...overrides,
  };
}

describe("explicit node id resolution", () => {
  test("an explicit node id resolves regardless of name", () => {
    const nodes = [node({ id: "1:1", name: "Header" })];
    const result = resolveFigmaFrames(nodes, ["1:1"], []);
    expect(result.resolved).toEqual([{ id: "1:1", name: "Header", path: ["Header"] }]);
  });

  test("a missing explicit node id is reported, not silently dropped", () => {
    const result = resolveFigmaFrames([], ["9:9"], []);
    expect(result.missing).toEqual(["9:9"]);
    expect(result.resolved).toEqual([]);
  });

  test("an explicit node id resolves even when the node is hidden", () => {
    const nodes = [node({ id: "1:1", name: "Header", visible: false })];
    const result = resolveFigmaFrames(nodes, ["1:1"], []);
    expect(result.resolved).toHaveLength(1);
  });
});

describe("full-path frame resolution", () => {
  test("a nested path resolves via parent chain", () => {
    const nodes = [
      node({ id: "1:1", name: "layout" }),
      node({ id: "1:2", name: "Dashboard", parentId: "1:1" }),
    ];
    const result = resolveFigmaFrames(nodes, [], ["layout/Dashboard"]);
    expect(result.resolved).toEqual([{ id: "1:2", name: "Dashboard", path: ["layout", "Dashboard"] }]);
  });
});

describe("exact name resolution", () => {
  test("an exact, unique frame name resolves", () => {
    const nodes = [node({ id: "1:1", name: "Header" })];
    const result = resolveFigmaFrames(nodes, [], ["Header"]);
    expect(result.resolved).toEqual([{ id: "1:1", name: "Header", path: ["Header"] }]);
  });

  test("duplicate names produce a structured ambiguity, never a silent guess", () => {
    const nodes = [node({ id: "1:1", name: "Header" }), node({ id: "1:2", name: "Header" })];
    const result = resolveFigmaFrames(nodes, [], ["Header"]);
    expect(result.resolved).toEqual([]);
    expect(result.ambiguities).toHaveLength(1);
    expect(result.ambiguities[0]?.candidates.map((c) => c.id).sort()).toEqual(["1:1", "1:2"]);
  });

  test("a hidden node with a colliding name does not create a false ambiguity", () => {
    const nodes = [
      node({ id: "1:1", name: "Header", visible: true }),
      node({ id: "1:2", name: "Header", visible: false }),
    ];
    const result = resolveFigmaFrames(nodes, [], ["Header"]);
    expect(result.resolved).toEqual([{ id: "1:1", name: "Header", path: ["Header"] }]);
  });
});

describe("case-insensitive fallback", () => {
  test("case-insensitive exact match resolves when no exact-case match exists", () => {
    const nodes = [node({ id: "1:1", name: "header" })];
    const result = resolveFigmaFrames(nodes, [], ["Header"]);
    expect(result.resolved).toEqual([{ id: "1:1", name: "header", path: ["header"] }]);
  });
});

describe("missing frames", () => {
  test("a frame name matching nothing is reported as missing", () => {
    const result = resolveFigmaFrames([node({ id: "1:1", name: "Header" })], [], ["Footer"]);
    expect(result.missing).toEqual(["Footer"]);
    expect(result.resolved).toEqual([]);
  });
});

describe("multiple selected frames", () => {
  test("several requested frames each resolve independently", () => {
    const nodes = [node({ id: "1:1", name: "Header" }), node({ id: "1:2", name: "Footer" })];
    const result = resolveFigmaFrames(nodes, [], ["Header", "Footer"]);
    expect(result.resolved.map((frame) => frame.name).sort()).toEqual(["Footer", "Header"]);
  });

  test("no fuzzy matching — a near-miss name is reported missing, not guessed", () => {
    const nodes = [node({ id: "1:1", name: "Header" })];
    const result = resolveFigmaFrames(nodes, [], ["Heade"]);
    expect(result.missing).toEqual(["Heade"]);
  });
});
