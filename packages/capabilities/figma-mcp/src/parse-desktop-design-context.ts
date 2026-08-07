// packages/capabilities/figma-mcp/src/parse-desktop-design-context.ts

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
