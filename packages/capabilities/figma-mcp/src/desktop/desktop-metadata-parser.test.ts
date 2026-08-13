// packages/capabilities/figma-mcp/src/desktop/desktop-metadata-parser.test.ts
import { describe, expect, test } from "bun:test";

import { parseDesktopMetadataOutline } from "./desktop-metadata-parser";
import { normalizeFigmaNodeTree } from "../normalize-nodes";

/**
 * Sanitized structural fixture mirroring the real Figma Desktop MCP
 * `get_metadata` response shape (selection line + XML-like outline). Names
 * and content are synthetic; the envelope, nesting, attribute grammar,
 * self-closing tags, and `hidden` attribute reproduce the real contract.
 */
const REAL_SHAPE_OUTLINE = `Currently selected nodes:
- 10:1: Screen A

<frame id="10:1" name="Screen A" x="-100" y="-200" width="440" height="1092">
  <frame id="10:2" name="Header" x="0" y="0" width="440" height="64">
    <rounded-rectangle id="10:3" name="icon" x="24" y="20" width="24" height="24" />
    <text id="10:4" name="Title" x="56" y="17" width="171" height="30" />
    <instance id="10:5" name="Button" x="333" y="12" width="91" height="40" hidden="true" />
  </frame>
  <frame id="10:6" name="Body" x="0" y="64" width="440" height="900">
    <instance id="10:7" name="Text field" x="0" y="0" width="392" height="56" />
  </frame>
  <instance id="10:8" name="Nav" x="0" y="1020" width="440" height="72" />
</frame>`;

describe("parseDesktopMetadataOutline", () => {
  test("parses the full nested tree from the real outline shape", () => {
    const root = parseDesktopMetadataOutline(REAL_SHAPE_OUTLINE, "10:1");
    expect(root).toBeDefined();
    expect(root!.name).toBe("Screen A");
    expect(root!.type).toBe("FRAME");
    expect(root!.children.map((child) => child.id)).toEqual(["10:2", "10:6", "10:8"]);
    expect(root!.absoluteBoundingBox).toEqual({ x: -100, y: -200, width: 440, height: 1092 });
  });

  test("preserves nested children, types, and geometry", () => {
    const root = parseDesktopMetadataOutline(REAL_SHAPE_OUTLINE, "10:1")!;
    const header = root.children[0]!;
    expect(header.children.map((child) => child.type)).toEqual(["ROUNDED_RECTANGLE", "TEXT", "INSTANCE"]);
    expect(header.children[1]!.absoluteBoundingBox).toEqual({ x: 56, y: 17, width: 171, height: 30 });
  });

  test("carries hidden=true as visible: false", () => {
    const root = parseDesktopMetadataOutline(REAL_SHAPE_OUTLINE, "10:1")!;
    const hiddenButton = root.children[0]!.children[2]!;
    expect(hiddenButton.visible).toBe(false);
    expect(root.visible).toBeUndefined();
  });

  test("returns undefined when the root id is absent", () => {
    expect(parseDesktopMetadataOutline(REAL_SHAPE_OUTLINE, "99:99")).toBeUndefined();
    expect(parseDesktopMetadataOutline("no outline here", "10:1")).toBeUndefined();
  });

  test("skips tags without id/name instead of failing", () => {
    const root = parseDesktopMetadataOutline(
      `<frame id="1:1" name="Root" x="0" y="0" width="10" height="10"><line /><text id="1:2" name="T" x="0" y="0" width="5" height="5" /></frame>`,
      "1:1",
    );
    expect(root!.children.map((child) => child.id)).toEqual(["1:2"]);
  });

  test("normalizes into a flat parent-linked node list", () => {
    const root = parseDesktopMetadataOutline(REAL_SHAPE_OUTLINE, "10:1")!;
    const normalized = normalizeFigmaNodeTree(root);
    expect(normalized.nodes.length).toBe(8);
    const rootNode = normalized.nodes[0]!;
    expect(rootNode.childIds).toEqual(["10:2", "10:6", "10:8"]);
    const title = normalized.nodes.find((node) => node.id === "10:4")!;
    expect(title.parentId).toBe("10:2");
    expect(title.type).toBe("TEXT");
    expect(title.absoluteBoundingBox).toEqual({ x: 56, y: 17, width: 171, height: 30 });
  });
});
