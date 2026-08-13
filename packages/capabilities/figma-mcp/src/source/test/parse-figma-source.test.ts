// packages/capabilities/figma-mcp/src/parse-figma-source.test.ts
import { describe, expect, test } from "bun:test";
import { FigmaSourceInvalidError, parseFigmaSource } from "../../source/parse-figma-source";

describe("parsing a Figma design/file URL", () => {
  test("a modern /design/ URL", () => {
    const parsed = parseFigmaSource("https://www.figma.com/design/abc123XYZ/Homepage");
    expect(parsed.sourceType).toBe("figma-url");
    expect(parsed.fileKey).toBe("abc123XYZ");
    expect(parsed.nodeIds).toEqual([]);
  });

  test("a legacy /file/ URL", () => {
    const parsed = parseFigmaSource("https://www.figma.com/file/abc123XYZ/Homepage");
    expect(parsed.fileKey).toBe("abc123XYZ");
  });

  test("a bare host without scheme still resolves as a URL", () => {
    const parsed = parseFigmaSource("figma.com/design/abc123XYZ/Homepage");
    expect(parsed.sourceType).toBe("figma-url");
    expect(parsed.fileKey).toBe("abc123XYZ");
  });

  test("a node-id query parameter in Figma's dash encoding is normalized to colon form", () => {
    const parsed = parseFigmaSource(
      "https://www.figma.com/design/abc123XYZ/Homepage?node-id=123-456",
    );
    expect(parsed.nodeIds).toEqual(["123:456"]);
  });

  test("a node-id already in normalized colon form is preserved", () => {
    const parsed = parseFigmaSource(
      "https://www.figma.com/design/abc123XYZ/Homepage?node-id=123%3A456",
    );
    expect(parsed.nodeIds).toEqual(["123:456"]);
  });

  test("multiple comma-separated node ids are all captured and deduplicated", () => {
    const parsed = parseFigmaSource(
      "https://www.figma.com/design/abc123XYZ/Homepage?node-id=1-2,1-2,3-4",
    );
    expect(parsed.nodeIds.sort()).toEqual(["1:2", "3:4"]);
  });

  test("a branch-id query parameter is captured separately", () => {
    const parsed = parseFigmaSource(
      "https://www.figma.com/design/abc123XYZ/Homepage?branch-id=999",
    );
    expect(parsed.branchKey).toBe("999");
  });

  test("frame names supplied alongside the URL are deduplicated and preserved", () => {
    const parsed = parseFigmaSource("https://www.figma.com/design/abc123XYZ/Homepage", {
      frames: ["brand/Header", "brand/Header", "layout/Dashboard"],
    });
    expect(parsed.requestedFrames.sort()).toEqual(["brand/Header", "layout/Dashboard"]);
  });

  test("normalizedUrl never carries an unrecognised query parameter", () => {
    const parsed = parseFigmaSource(
      "https://www.figma.com/design/abc123XYZ/Homepage?node-id=1-2&t=SECRET_SHARE_TOKEN&other=value",
    );
    expect(parsed.normalizedUrl).toBeDefined();
    expect(parsed.normalizedUrl).not.toContain("SECRET_SHARE_TOKEN");
    expect(parsed.normalizedUrl).not.toContain("other=value");
  });

  test("preserves the original input verbatim for diagnostics", () => {
    const raw = "https://www.figma.com/design/abc123XYZ/Homepage?node-id=1-2&t=abc";
    const parsed = parseFigmaSource(raw);
    expect(parsed.originalInput).toBe(raw);
  });
});

describe("parsing a bare file key", () => {
  test("a plausible bare key is accepted", () => {
    const parsed = parseFigmaSource("abc123XYZ890");
    expect(parsed.sourceType).toBe("figma-file-key");
    expect(parsed.fileKey).toBe("abc123XYZ890");
  });
});

describe("rejecting invalid or unsupported sources", () => {
  test("an unsupported host is rejected", () => {
    expect(() => parseFigmaSource("https://evil.example.com/design/abc123XYZ/Homepage")).toThrow(
      FigmaSourceInvalidError,
    );
  });

  test("a figma.com URL with no file key segment is rejected", () => {
    expect(() => parseFigmaSource("https://www.figma.com/")).toThrow(FigmaSourceInvalidError);
  });

  test("a malformed URL is rejected", () => {
    expect(() => parseFigmaSource("https://")).toThrow(FigmaSourceInvalidError);
  });

  test("an empty string is rejected", () => {
    expect(() => parseFigmaSource("   ")).toThrow(FigmaSourceInvalidError);
  });

  test("plain free text is rejected in production mode", () => {
    expect(() => parseFigmaSource("homepage.fig")).toThrow(FigmaSourceInvalidError);
  });

  test("plain free text is accepted only when fixture mode is explicitly enabled", () => {
    const parsed = parseFigmaSource("homepage.fig", { allowFixtureNames: true });
    expect(parsed.sourceType).toBe("figma-file-key");
    expect(parsed.fileKey).toBe("homepage.fig");
  });
});
