// packages/tools/src/catalog/validate-source-metadata.test.ts
import { describe, expect, test } from "bun:test";
import type { ToolContext } from "@designflow/sdk";
import { validateSourceMetadataTool } from "./validate-source-metadata";

function ctx(): ToolContext {
  return {
    signal: new AbortController().signal,
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    metadata: {},
  };
}

describe("validate-source-metadata", () => {
  test("flags missing and malformed fields", async () => {
    const result = await validateSourceMetadataTool.execute(
      {
        sources: [
          {
            id: "s1",
            title: "A complete source",
            content: "This is a long enough piece of content to pass the check.",
            url: "https://example.com/a",
          },
          { id: "s2" },
          { id: "s3", title: "Bad url", content: "Also long enough content here.", url: "not-a-url" },
        ],
      },
      ctx(),
    );

    expect(result.totalCount).toBe(3);
    expect(result.validCount).toBe(1);
    expect(result.invalidCount).toBe(2);

    const s2 = result.results.find((r) => r.id === "s2");
    expect(s2?.valid).toBe(false);
    expect(s2?.issues).toEqual(
      expect.arrayContaining(["missing_title", "missing_content", "missing_url"]),
    );

    const s3 = result.results.find((r) => r.id === "s3");
    expect(s3?.issues).toContain("invalid_url_format");
  });

  test("flags a duplicate id on the second occurrence", async () => {
    const result = await validateSourceMetadataTool.execute(
      {
        sources: [
          { id: "dup", title: "First", content: "Long enough content for this one too.", url: "https://a.com" },
          { id: "dup", title: "Second", content: "Long enough content for this one too.", url: "https://b.com" },
        ],
      },
      ctx(),
    );

    expect(result.results[0]?.issues).not.toContain("duplicate_id");
    expect(result.results[1]?.issues).toContain("duplicate_id");
  });

  test("content shorter than the minimum is flagged, not treated as missing", async () => {
    const result = await validateSourceMetadataTool.execute(
      { sources: [{ id: "s1", title: "T", content: "too short", url: "https://example.com" }] },
      ctx(),
    );

    expect(result.results[0]?.issues).toEqual(["content_too_short"]);
  });
});
