// packages/capabilities/figma-mcp/src/parse-figma-source.ts
import { z } from "zod";
import { DesignFlowError } from "@designflow/sdk";

/**
 * Deterministic Figma source interpretation.
 *
 * Replaces Stage 2's "any string is a design file" behaviour with a real
 * parser: a production run must name an actual Figma URL or file key, never
 * arbitrary free text. Nothing here fetches anything — this is pure string
 * interpretation, exactly the same boundary `resolveNodeInput` keeps between
 * "what a node's input is" and "what a capability does with it."
 */

const SUPPORTED_HOSTS = new Set(["www.figma.com", "figma.com"]);

export const parsedFigmaSourceSchema = z
  .object({
    originalInput: z.string().min(1),
    sourceType: z.enum(["figma-url", "figma-file-key"]),
    fileKey: z.string().min(1),
    nodeIds: z.array(z.string().min(1)).default([]),
    requestedFrames: z.array(z.string().min(1)).default([]),
    branchKey: z.string().min(1).optional(),
    normalizedUrl: z.string().min(1).optional(),
  })
  .strict();

export type ParsedFigmaSource = z.infer<typeof parsedFigmaSourceSchema>;

export class FigmaSourceInvalidError extends DesignFlowError {
  public constructor(reason: string, originalInput: string) {
    super("ERR_FIGMA_SOURCE_INVALID", `Invalid Figma source: ${reason}`, {
      // The raw input travels in metadata for diagnostics — it is
      // whatever the user typed, never a credential or a header, so this
      // carries no secret-redaction risk the way an MCP response would.
      originalInput,
    });
    this.name = "FigmaSourceInvalidError";
    Object.setPrototypeOf(this, FigmaSourceInvalidError.prototype);
  }
}

/**
 * A bare file key: 20-ish alphanumeric characters, no slashes, no scheme.
 * Figma's own file keys are not a fixed length, so this is deliberately
 * permissive about length and only rejects the shapes that clearly are not
 * a key at all (whitespace, path separators, a URL scheme).
 */
const BARE_FILE_KEY_PATTERN = /^[A-Za-z0-9]{6,}$/;

/** `123-456` (Figma's URL encoding) or `123:456` (the API's normalized form). */
function normalizeNodeId(raw: string): string | null {
  const trimmed = raw.trim();
  if (/^\d+:\d+$/.test(trimmed)) return trimmed;

  const dashMatch = /^(\d+)-(\d+)$/.exec(trimmed);
  if (dashMatch) return `${dashMatch[1]}:${dashMatch[2]}`;

  return null;
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/**
 * Parses a `designFile` worker input into a validated, typed source
 * reference.
 *
 * Supports:
 *   - a modern Figma design/file URL (`/design/<key>/...` or `/file/<key>/...`),
 *     optionally carrying `node-id`, `branch-id` and other query parameters;
 *   - a bare file key, for a caller that already resolved one;
 *   - `frames` supplied alongside the URL/key, for frame-name resolution.
 *
 * Rejects, rather than silently accepting:
 *   - a host other than `figma.com`/`www.figma.com`;
 *   - a URL with no file key segment;
 *   - a string that is neither a recognised URL nor a plausible bare key.
 *
 * `allowFixtureNames` exists only for the internal fixture workflow
 * (`design-to-code-agent-foundation`'s successor still uses plain names like
 * `homepage.fig` in tests) — production parsing never sets it, so a
 * production run cannot silently treat arbitrary text as a real document the
 * way Stage 2's fixture path did.
 */
export function parseFigmaSource(
  input: string,
  options?: { readonly frames?: readonly string[]; readonly allowFixtureNames?: boolean },
): ParsedFigmaSource {
  const originalInput = input;
  const frames = options?.frames ?? [];

  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new FigmaSourceInvalidError("the source was empty", originalInput);
  }

  if (looksLikeUrl(trimmed)) {
    return parseUrl(trimmed, originalInput, frames);
  }

  if (BARE_FILE_KEY_PATTERN.test(trimmed)) {
    return parsedFigmaSourceSchema.parse({
      originalInput,
      sourceType: "figma-file-key",
      fileKey: trimmed,
      nodeIds: [],
      requestedFrames: dedupe(frames),
    });
  }

  if (options?.allowFixtureNames === true) {
    return parsedFigmaSourceSchema.parse({
      originalInput,
      sourceType: "figma-file-key",
      fileKey: trimmed,
      nodeIds: [],
      requestedFrames: dedupe(frames),
    });
  }

  throw new FigmaSourceInvalidError(
    "expected a figma.com design/file URL or a bare file key",
    originalInput,
  );
}

function looksLikeUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://") || value.includes("figma.com/");
}

function parseUrl(trimmed: string, originalInput: string, frames: readonly string[]): ParsedFigmaSource {
  let url: URL;
  try {
    url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
  } catch {
    throw new FigmaSourceInvalidError("could not be parsed as a URL", originalInput);
  }

  if (!SUPPORTED_HOSTS.has(url.hostname)) {
    throw new FigmaSourceInvalidError(`unsupported host: ${url.hostname}`, originalInput);
  }

  // `/design/<key>/<slug>` or `/file/<key>/<slug>` — the two path shapes
  // Figma's own share links use.
  const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
  const kindIndex = segments.findIndex((segment) => segment === "design" || segment === "file");

  const fileKey = kindIndex !== -1 ? segments[kindIndex + 1] : undefined;

  if (fileKey === undefined || fileKey.length === 0) {
    throw new FigmaSourceInvalidError("no file key found in the URL path", originalInput);
  }

  const nodeIdParam = url.searchParams.get("node-id");
  const nodeIds = dedupe(
    (nodeIdParam?.split(",") ?? [])
      .map((raw) => normalizeNodeId(raw))
      .filter((value): value is string => value !== null),
  );

  const branchKey = url.searchParams.get("branch-id") ?? undefined;

  // Rebuilt from only the fields this parser actually recognises — never
  // the original query string verbatim, which may carry a tracking
  // parameter, a share-link token, or other values this parser has no
  // business repeating into an artifact or a log line.
  const normalizedUrl = new URL(`https://www.figma.com/design/${fileKey}`);
  if (nodeIdParam !== null) normalizedUrl.searchParams.set("node-id", nodeIdParam);

  return parsedFigmaSourceSchema.parse({
    originalInput,
    sourceType: "figma-url",
    fileKey,
    nodeIds,
    requestedFrames: dedupe(frames),
    ...(branchKey !== undefined ? { branchKey } : {}),
    normalizedUrl: normalizedUrl.toString(),
  });
}
