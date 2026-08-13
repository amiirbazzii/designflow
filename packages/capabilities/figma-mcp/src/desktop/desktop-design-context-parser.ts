// packages/capabilities/figma-mcp/src/desktop/desktop-design-context-parser.ts

/**
 * Extracts per-node design facts from the Figma Desktop MCP
 * `get_design_context` response.
 *
 * The Desktop server returns generated React+Tailwind code in which every
 * element carries a `data-node-id` attribute and a `className` whose utility
 * tokens are emitted from the node's real properties (e.g. `bg-[#f9f9f9]`,
 * `rounded-[16px]`, `text-[24px]`, `font-['Poppins:Medium']`,
 * `gap-[8px]`). Only those closed, machine-generated token forms are read
 * here — arbitrary prose is never scraped, nothing is evaluated, and a token
 * that does not match a known form is ignored rather than guessed at.
 */

export interface DesignContextNodeFacts {
  readonly characters?: string;
  /** Solid background color as a CSS color string (hex or named). */
  readonly backgroundColor?: string;
  /** Solid text color as a CSS color string (hex or named). */
  readonly textColor?: string;
  /** Solid border color as a CSS color string (hex or named). */
  readonly borderColor?: string;
  readonly cornerRadius?: number;
  readonly itemSpacing?: number;
  readonly layoutMode?: "HORIZONTAL" | "VERTICAL";
  readonly opacity?: number;
  readonly fontFamily?: string;
  readonly fontStyle?: string;
  readonly fontSizePx?: number;
}

const ELEMENT_PATTERN = /<([a-zA-Z][a-zA-Z0-9]*)\s+([^>]*?)data-node-id="([^"]+)"([^>]*?)(\/?)>/g;
const CLASS_PATTERN = /className="([^"]*)"/;

/** Parses one design-context code block into a map of node id → extracted facts. */
export function parseDesignContextFacts(code: string): ReadonlyMap<string, DesignContextNodeFacts> {
  const facts = new Map<string, DesignContextNodeFacts>();

  ELEMENT_PATTERN.lastIndex = 0;
  for (let match = ELEMENT_PATTERN.exec(code); match !== null; match = ELEMENT_PATTERN.exec(code)) {
    const tag = match[1]!;
    const attributes = `${match[2] ?? ""} ${match[4] ?? ""}`;
    const nodeId = match[3]!;
    const selfClosing = match[5] === "/";

    const className = CLASS_PATTERN.exec(attributes)?.[1] ?? "";
    const extracted: Mutable<DesignContextNodeFacts> = {};

    const background = colorToken(className, "bg");
    if (background !== undefined) extracted.backgroundColor = background;
    const textColor = colorToken(className, "text");
    if (textColor !== undefined) extracted.textColor = textColor;
    const borderColor = colorToken(className, "border");
    if (borderColor !== undefined) extracted.borderColor = borderColor;

    const radius = pxToken(className, "rounded");
    if (radius !== undefined) extracted.cornerRadius = radius;
    const gap = pxToken(className, "gap");
    if (gap !== undefined) extracted.itemSpacing = gap;
    const fontSize = pxToken(className, "text");
    if (fontSize !== undefined) extracted.fontSizePx = fontSize;

    if (/\bflex-col\b/.test(className)) extracted.layoutMode = "VERTICAL";
    else if (/\bflex\b/.test(className)) extracted.layoutMode = "HORIZONTAL";

    const opacity = /\bopacity-\[(\d*\.?\d+)\]/.exec(className)?.[1];
    if (opacity !== undefined) {
      const value = Number(opacity);
      if (Number.isFinite(value) && value >= 0 && value <= 1) extracted.opacity = value;
    }

    const font = fontToken(className);
    if (font !== undefined) {
      extracted.fontFamily = font.family;
      if (font.style !== undefined) extracted.fontStyle = font.style;
    }

    if (!selfClosing) {
      const characters = innerText(code, ELEMENT_PATTERN.lastIndex, tag);
      if (characters !== undefined && characters.length > 0) extracted.characters = characters;
    }

    if (Object.keys(extracted).length > 0) {
      const existing = facts.get(nodeId);
      // First occurrence wins per fact: the same node id never legitimately
      // appears twice in one generated tree, so later duplicates only fill gaps.
      facts.set(nodeId, existing === undefined ? extracted : { ...extracted, ...existing });
    }
  }

  return facts;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const NAMED_COLORS = new Set(["white", "black", "transparent"]);

function colorToken(className: string, prefix: string): string | undefined {
  const bracketed = new RegExp(`\\b${prefix}-\\[(#[0-9a-fA-F]{3,8})\\]`).exec(className)?.[1];
  if (bracketed !== undefined) return bracketed.toLowerCase();
  const named = new RegExp(`\\b${prefix}-(white|black)\\b`).exec(className)?.[1];
  return named !== undefined && NAMED_COLORS.has(named) ? named : undefined;
}

function pxToken(className: string, prefix: string): number | undefined {
  const raw = new RegExp(`\\b${prefix}-\\[(\\d*\\.?\\d+)px\\]`).exec(className)?.[1];
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function fontToken(className: string): { family: string; style?: string } | undefined {
  const quoted = /font-\[(?:family-name:var\(--[a-zA-Z0-9-]+,)?'([^:']+)(?::([^']+))?'\)?\]/.exec(className);
  if (quoted === null) return undefined;
  const family = quoted[1]!;
  const style = quoted[2];
  return style !== undefined ? { family, style } : { family };
}

/**
 * Reads the direct text content following an opening tag up to the matching
 * closing tag, tolerating one level of `{`template`}` wrapping. Returns
 * `undefined` when the content contains nested elements (text belongs to the
 * nested nodes, not this one).
 */
function innerText(code: string, from: number, tag: string): string | undefined {
  const close = code.indexOf(`</${tag}>`, from);
  if (close === -1) return undefined;
  const raw = code.slice(from, close);
  if (raw.includes("<")) return undefined;
  const unwrapped = raw.replace(/\{\s*`([\s\S]*?)`\s*\}/g, "$1");
  const collapsed = unwrapped.replace(/\s+/g, " ").trim();
  return collapsed.length > 0 ? collapsed : undefined;
}

// ── Structural tree parsing (DF-SPEC-04) ────────────────────────
//
// The same generated code is also a structural source: every element carries
// `data-node-id` — including descendants INSIDE component instances, which
// the `get_metadata` outline omits entirely — and component instances appear
// as capitalized tags whose JSX props are the instance's real Figma
// component property values (e.g. `<NavigationMenuV3 variant="Expenses">`).
// This parser turns that closed grammar into a nested tree so the snapshot
// builder can materialize instance descendants as real evidence nodes.

export interface DesignContextTreeNode {
  readonly nodeId: string;
  readonly tag: string;
  /** The element's `data-name` attribute — Figma's own layer name. */
  readonly name?: string | undefined;
  /** Set when the tag is capitalized: the generated component's name. */
  readonly componentName?: string | undefined;
  /** JSX string props on a component tag — real instance property values. */
  readonly propertyValues?: Readonly<Record<string, string>> | undefined;
  readonly facts: DesignContextNodeFacts;
  readonly widthPx?: number | undefined;
  readonly heightPx?: number | undefined;
  readonly paddingXPx?: number | undefined;
  readonly paddingYPx?: number | undefined;
  readonly text?: string | undefined;
  readonly children: readonly DesignContextTreeNode[];
}

const TREE_TAG_START_PATTERN = /<(\/?)([A-Za-z][A-Za-z0-9]*)/g;
const TREE_ATTRIBUTE_PATTERN = /([a-zA-Z_-]+)="([^"]*)"/g;

/**
 * Finds the end of one opening tag, tolerating the full JSX attribute
 * grammar the Desktop server emits: quoted strings, expression props
 * (`img={imgIcon}`, `{...props}`) and boolean props. A `>` inside a string or
 * inside braces does not end the tag.
 *
 * Field evidence (run d840ab80): instances whose generated tag carried an
 * expression prop — icon-only Buttons, the first history item, the navigation
 * menu — were skipped entirely by an attributes-must-be-quoted-pairs grammar,
 * so their descendants and property values never reached the snapshot even
 * though the transport had supplied them.
 */
function scanOpeningTag(
  code: string,
  from: number,
): { attributes: string; end: number; selfClosing: boolean } | undefined {
  let quote: string | undefined;
  let braceDepth = 0;
  for (let index = from; index < code.length; index += 1) {
    const char = code[index]!;
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      continue;
    }
    if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (char === ">" && braceDepth === 0) {
      const attributes = code.slice(from, index);
      return { attributes, end: index + 1, selfClosing: attributes.trimEnd().endsWith("/") };
    }
  }
  return undefined;
}

interface MutableTreeNode {
  nodeId: string;
  tag: string;
  name?: string;
  componentName?: string;
  propertyValues?: Record<string, string>;
  facts: DesignContextNodeFacts;
  widthPx?: number;
  heightPx?: number;
  paddingXPx?: number;
  paddingYPx?: number;
  text?: string;
  children: MutableTreeNode[];
}

function factsFromClassName(className: string): DesignContextNodeFacts {
  const extracted: Mutable<DesignContextNodeFacts> = {};
  const background = colorToken(className, "bg");
  if (background !== undefined) extracted.backgroundColor = background;
  const textColor = colorToken(className, "text");
  if (textColor !== undefined) extracted.textColor = textColor;
  const borderColor = colorToken(className, "border");
  if (borderColor !== undefined) extracted.borderColor = borderColor;
  const radius = pxToken(className, "rounded");
  if (radius !== undefined) extracted.cornerRadius = radius;
  const gap = pxToken(className, "gap");
  if (gap !== undefined) extracted.itemSpacing = gap;
  const fontSize = pxToken(className, "text");
  if (fontSize !== undefined) extracted.fontSizePx = fontSize;
  if (/\bflex-col\b/.test(className)) extracted.layoutMode = "VERTICAL";
  else if (/\bflex\b/.test(className)) extracted.layoutMode = "HORIZONTAL";
  const opacity = /\bopacity-\[(\d*\.?\d+)\]/.exec(className)?.[1];
  if (opacity !== undefined) {
    const value = Number(opacity);
    if (Number.isFinite(value) && value >= 0 && value <= 1) extracted.opacity = value;
  }
  const font = fontToken(className);
  if (font !== undefined) {
    extracted.fontFamily = font.family;
    if (font.style !== undefined) extracted.fontStyle = font.style;
  }
  return extracted;
}

/** Parses the design-context code into nested trees rooted at top-level elements. */
export function parseDesignContextTree(code: string): readonly DesignContextTreeNode[] {
  const roots: MutableTreeNode[] = [];
  // Each stack frame is either a real node or an anonymous passthrough
  // (an element without data-node-id) whose children attach to the nearest
  // real ancestor.
  const stack: (MutableTreeNode | undefined)[] = [];

  const attach = (node: MutableTreeNode): void => {
    const parent = [...stack].reverse().find((entry) => entry !== undefined);
    if (parent !== undefined) parent.children.push(node);
    else roots.push(node);
  };

  TREE_TAG_START_PATTERN.lastIndex = 0;
  for (let match = TREE_TAG_START_PATTERN.exec(code); match !== null; match = TREE_TAG_START_PATTERN.exec(code)) {
    if (match[1] === "/") {
      stack.pop();
      continue;
    }
    const tag = match[2]!;
    const scanned = scanOpeningTag(code, TREE_TAG_START_PATTERN.lastIndex);
    if (scanned === undefined) break;
    TREE_TAG_START_PATTERN.lastIndex = scanned.end;
    const rawAttributes = scanned.attributes;
    const selfClosing = scanned.selfClosing;

    const attributes: Record<string, string> = {};
    TREE_ATTRIBUTE_PATTERN.lastIndex = 0;
    for (let attr = TREE_ATTRIBUTE_PATTERN.exec(rawAttributes); attr !== null; attr = TREE_ATTRIBUTE_PATTERN.exec(rawAttributes)) {
      attributes[attr[1]!] = attr[2]!;
    }

    const nodeId = attributes["data-node-id"];
    if (nodeId === undefined || nodeId.length === 0) {
      if (!selfClosing) stack.push(undefined);
      continue;
    }

    const className = attributes["className"] ?? "";
    const isComponentTag = /^[A-Z]/.test(tag);
    const propertyValues: Record<string, string> = {};
    for (const [key, value] of Object.entries(attributes)) {
      if (key === "className" || key.startsWith("data-") || key === "style" || key === "key") continue;
      propertyValues[key] = value;
    }

    const node: MutableTreeNode = {
      nodeId,
      tag,
      ...(attributes["data-name"] !== undefined ? { name: attributes["data-name"] } : {}),
      ...(isComponentTag ? { componentName: tag } : {}),
      ...(isComponentTag && Object.keys(propertyValues).length > 0 ? { propertyValues } : {}),
      facts: factsFromClassName(className),
      children: [],
    };
    const widthPx = pxToken(className, "w");
    if (widthPx !== undefined) node.widthPx = widthPx;
    const heightPx = pxToken(className, "h");
    if (heightPx !== undefined) node.heightPx = heightPx;
    const paddingXPx = pxToken(className, "px");
    if (paddingXPx !== undefined) node.paddingXPx = paddingXPx;
    const paddingYPx = pxToken(className, "py");
    if (paddingYPx !== undefined) node.paddingYPx = paddingYPx;

    if (!selfClosing) {
      const text = innerText(code, scanned.end, tag);
      if (text !== undefined && text.length > 0) node.text = text;
    }

    attach(node);
    if (!selfClosing) stack.push(node);
  }

  return roots;
}
