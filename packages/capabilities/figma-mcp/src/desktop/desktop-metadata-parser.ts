// packages/capabilities/figma-mcp/src/desktop/desktop-metadata-parser.ts

/**
 * Parses the Figma Desktop MCP `get_metadata` outline into a raw nested node
 * tree compatible with `normalizeFigmaNodeTree`.
 *
 * The Desktop server returns the selected subtree as an XML-like outline in a
 * text content block:
 *
 * ```xml
 * <frame id="1026:6098" name="iPhone 16 Pro Max - 14" x="-1922" y="-6261" width="440" height="1092">
 *   <rounded-rectangle id="1026:6100" name="splash" x="24" y="20" width="24" height="24" />
 *   <instance id="1026:6103" name="Button" x="333" y="12" width="91" height="40" hidden="true" />
 * </frame>
 * ```
 *
 * This is a closed grammar produced by the server, not free prose: every node
 * is one tag whose attributes are double-quoted. Anything that does not match
 * that grammar is skipped rather than guessed at.
 */

export interface RawDesktopNode {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  readonly visible?: boolean;
  readonly children: RawDesktopNode[];
}

const TAG_PATTERN = /<([a-z][a-z0-9-]*)((?:\s+[a-z-]+="[^"]*")*)\s*(\/?)>|<\/([a-z][a-z0-9-]*)\s*>/gi;
const ATTRIBUTE_PATTERN = /([a-z-]+)="([^"]*)"/gi;

/**
 * Parses the outline text into a single raw tree rooted at `rootId`, or
 * `undefined` when no tag with that id exists in the text.
 */
export function parseDesktopMetadataOutline(text: string, rootId: string): RawDesktopNode | undefined {
  interface OpenFrame {
    readonly node: MutableNode;
  }
  interface MutableNode {
    id: string;
    name: string;
    type: string;
    absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
    visible?: boolean;
    children: MutableNode[];
  }

  const roots: MutableNode[] = [];
  const stack: OpenFrame[] = [];

  TAG_PATTERN.lastIndex = 0;
  for (let match = TAG_PATTERN.exec(text); match !== null; match = TAG_PATTERN.exec(text)) {
    const closingTag = match[4];
    if (closingTag !== undefined) {
      // A closing tag pops its frame; mismatches simply end the innermost frame.
      stack.pop();
      continue;
    }

    const tag = match[1]!;
    const attributes = readAttributes(match[2] ?? "");
    const selfClosing = match[3] === "/";

    const id = attributes.get("id");
    const name = attributes.get("name");
    if (id === undefined || id.length === 0 || name === undefined || name.length === 0) {
      // Not a node tag from the outline grammar (e.g. markup inside a name); skip it,
      // and do not open a frame for it even when it is not self-closing.
      continue;
    }

    const node: MutableNode = {
      id,
      name,
      type: tag.toUpperCase().replaceAll("-", "_"),
      children: [],
    };

    const bounds = readBounds(attributes);
    if (bounds !== undefined) node.absoluteBoundingBox = bounds;
    if (attributes.get("hidden") === "true") node.visible = false;

    const parent = stack[stack.length - 1];
    if (parent !== undefined) {
      parent.node.children.push(node);
    } else {
      roots.push(node);
    }

    if (!selfClosing) stack.push({ node });
  }

  return findById(roots, rootId);
}

function readAttributes(source: string): Map<string, string> {
  const attributes = new Map<string, string>();
  ATTRIBUTE_PATTERN.lastIndex = 0;
  for (let match = ATTRIBUTE_PATTERN.exec(source); match !== null; match = ATTRIBUTE_PATTERN.exec(source)) {
    attributes.set(match[1]!.toLowerCase(), match[2]!);
  }
  return attributes;
}

function readBounds(
  attributes: Map<string, string>,
): { x: number; y: number; width: number; height: number } | undefined {
  const x = numberAttribute(attributes, "x");
  const y = numberAttribute(attributes, "y");
  const width = numberAttribute(attributes, "width");
  const height = numberAttribute(attributes, "height");
  if (x === undefined || y === undefined || width === undefined || height === undefined) return undefined;
  return { x, y, width, height };
}

function numberAttribute(attributes: Map<string, string>, name: string): number | undefined {
  const raw = attributes.get(name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function findById(roots: readonly RawDesktopNode[], id: string): RawDesktopNode | undefined {
  for (const root of roots) {
    if (root.id === id) return root;
    const nested = findById(root.children, id);
    if (nested !== undefined) return nested;
  }
  return undefined;
}
