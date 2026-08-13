// packages/capabilities/figma-mcp/src/normalize-nodes.test.ts
import { describe, expect, test } from "bun:test";
import { normalizeFigmaNodeTree } from "../../normalization/normalize-nodes";

describe("hierarchy preservation", () => {
  test("flattens a nested tree while recording parent/child links", () => {
    const root = {
      id: "0:0",
      name: "Page",
      type: "CANVAS",
      children: [
        {
          id: "1:1",
          name: "layout",
          type: "FRAME",
          children: [{ id: "1:2", name: "Dashboard", type: "FRAME", children: [] }],
        },
      ],
    };

    const { nodes } = normalizeFigmaNodeTree(root);
    const byId = new Map(nodes.map((node) => [node.id, node]));

    expect(byId.get("1:1")?.parentId).toBe("0:0");
    expect(byId.get("1:2")?.parentId).toBe("1:1");
    expect(byId.get("1:1")?.childIds).toEqual(["1:2"]);
  });

  test("preserves child order", () => {
    const root = {
      id: "0:0",
      name: "Page",
      type: "CANVAS",
      children: [
        { id: "1:1", name: "First", type: "FRAME" },
        { id: "1:2", name: "Second", type: "FRAME" },
        { id: "1:3", name: "Third", type: "FRAME" },
      ],
    };

    const { nodes } = normalizeFigmaNodeTree(root);
    expect(nodes[0]?.childIds).toEqual(["1:1", "1:2", "1:3"]);
  });
});

describe("layout fields", () => {
  test("captures auto-layout fields when present", () => {
    const root = {
      id: "1:1",
      name: "Row",
      type: "FRAME",
      layoutMode: "HORIZONTAL",
      itemSpacing: 8,
      paddingLeft: 4,
      paddingRight: 4,
      paddingTop: 2,
      paddingBottom: 2,
      primaryAxisAlignItems: "CENTER",
    };

    const { nodes } = normalizeFigmaNodeTree(root);
    expect(nodes[0]).toMatchObject({
      layoutMode: "HORIZONTAL",
      itemSpacing: 8,
      padding: { top: 2, right: 4, bottom: 2, left: 4 },
      primaryAxisAlignItems: "CENTER",
    });
  });

  test("omits layout fields entirely rather than fabricating zeros", () => {
    const root = { id: "1:1", name: "Text", type: "TEXT" };
    const { nodes } = normalizeFigmaNodeTree(root);
    expect(nodes[0]?.layoutMode).toBeUndefined();
    expect(nodes[0]?.padding).toBeUndefined();
  });
});

describe("typography", () => {
  test("captures characters and text alignment", () => {
    const root = {
      id: "1:1",
      name: "Label",
      type: "TEXT",
      characters: "Hello",
      style: { textAlignHorizontal: "CENTER" },
    };
    const { nodes } = normalizeFigmaNodeTree(root);
    expect(nodes[0]?.characters).toBe("Hello");
    expect(nodes[0]?.textAlignHorizontal).toBe("CENTER");
  });
});

describe("component/instance relationship", () => {
  test("captures componentId and variant properties", () => {
    const root = {
      id: "1:1",
      name: "Button",
      type: "INSTANCE",
      componentId: "comp:1",
      componentProperties: { size: "large" },
    };
    const { nodes } = normalizeFigmaNodeTree(root);
    expect(nodes[0]?.componentId).toBe("comp:1");
    expect(nodes[0]?.variantProperties).toEqual({ size: "large" });
  });
});

describe("malformed node data", () => {
  test("a node with no id/name/type is skipped with a warning, not thrown", () => {
    const root = { id: "1:1", name: "Page", type: "CANVAS", children: [{ garbage: true }] };
    const { nodes, warnings } = normalizeFigmaNodeTree(root);
    expect(nodes).toHaveLength(1);
    expect(warnings.length).toBeGreaterThan(0);
  });
});

describe("unrecognised fields", () => {
  test("anything not explicitly modeled is preserved under properties, never dropped", () => {
    const root = { id: "1:1", name: "Odd", type: "FRAME", somethingNew: { deeply: "nested" } };
    const { nodes } = normalizeFigmaNodeTree(root);
    expect(nodes[0]?.properties.somethingNew).toEqual({ deeply: "nested" });
  });
});

describe("deterministic ordering and stable hashing", () => {
  test("normalizing the same tree twice produces byte-identical output", () => {
    const root = {
      id: "1:1",
      name: "Row",
      type: "FRAME",
      children: [{ id: "1:2", name: "Cell", type: "TEXT", characters: "hi" }],
    };
    const first = normalizeFigmaNodeTree(root);
    const second = normalizeFigmaNodeTree(structuredClone(root));
    expect(JSON.stringify(first.nodes)).toBe(JSON.stringify(second.nodes));
  });
});
