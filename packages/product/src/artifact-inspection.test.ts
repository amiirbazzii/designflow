// packages/product/src/artifact-inspection.test.ts
import { describe, expect, test } from "bun:test";
import { InMemoryArtifactStore } from "@designflow/core";
import {
  ArtifactInspectionService,
  redactSensitive,
  truncateForDisplay,
} from "./artifact-inspection";
import type { ArtifactSummary } from "./schemas";

describe("redactSensitive", () => {
  test("redacts credential-shaped keys at any depth", () => {
    const result = redactSensitive({
      apiKey: "fixture-api-key",
      nested: { accessToken: "fixture-access-token", ok: "fine" },
      list: [{ ["pass" + "word"]: "fixture-value" }, { safe: "value" }],
      OPENROUTER_API_KEY: "fixture-provider-value",
      Authorization: "fixture-auth-header",
    });

    expect(result).toEqual({
      apiKey: "[redacted]",
      nested: { accessToken: "[redacted]", ok: "fine" },
      list: [{ ["pass" + "word"]: "[redacted]" }, { safe: "value" }],
      OPENROUTER_API_KEY: "[redacted]",
      Authorization: "[redacted]",
    });
  });

  test("leaves ordinary content untouched", () => {
    const payload = {
      framework: "react",
      files: [{ path: "src/components/Header.tsx", contents: "export function Header() {}" }],
    };

    expect(redactSensitive(payload)).toEqual(payload);
  });
});

describe("truncateForDisplay", () => {
  test("passes short text through unchanged", () => {
    const result = truncateForDisplay("hello");
    expect(result).toEqual({ text: "hello", truncated: false, totalLength: 5 });
  });

  test("bounds long text and reports how much was cut", () => {
    const long = "x".repeat(50);
    const result = truncateForDisplay(long, 10);

    expect(result.text).toBe("x".repeat(10));
    expect(result.truncated).toBe(true);
    expect(result.totalLength).toBe(50);
  });
});

describe("ArtifactInspectionService", () => {
  function summaryFor(artifactId: string): ArtifactSummary {
    return {
      artifactId,
      name: "Design tokens",
      type: "design.tokens",
      status: "created",
      dependencies: [],
    };
  }

  test("returns the redacted payload behind an artifact", async () => {
    const store = new InMemoryArtifactStore();
    const stored = await store.save({ colors: ["color.brand"], apiKey: "fixture-api-key" });

    await store.createArtifact({
      id: "design-tokens",
      type: "design.tokens",
      metadata: { payloadId: stored.id },
    });

    const service = new ArtifactInspectionService({
      artifactRegistry: store,
      artifactStore: store,
    });

    const detail = await service.getPayload(summaryFor("design-tokens"));

    expect(detail.payload).toEqual({ colors: ["color.brand"], apiKey: "[redacted]" });
  });

  /**
   * Regression: `Artifact.metadata` is fixed at first registration and never
   * updated by a later `createVersion` call — only the `version` number
   * advances. Before this fix, `getPayload` read `artifact.metadata` directly
   * and so always returned the *first* version's payload, silently, no
   * matter how many times the artifact had actually been revised.
   */
  test("returns the current version's payload, not the first one, after a revision", async () => {
    const store = new InMemoryArtifactStore();
    const firstPayload = await store.save({ colors: ["color.brand"] });
    const secondPayload = await store.save({ colors: ["color.admin"] });

    await store.createArtifact({
      id: "design-tokens",
      type: "design.tokens",
      metadata: { payloadId: firstPayload.id },
    });
    await store.createVersion("design-tokens", { payloadId: secondPayload.id });

    const service = new ArtifactInspectionService({
      artifactRegistry: store,
      artifactStore: store,
    });

    const detail = await service.getPayload(summaryFor("design-tokens"));

    expect(detail.payload).toEqual({ colors: ["color.admin"] });
  });

  test("returns no payload when the artifact was never registered", async () => {
    const store = new InMemoryArtifactStore();
    const service = new ArtifactInspectionService({
      artifactRegistry: store,
      artifactStore: store,
    });

    const detail = await service.getPayload(summaryFor("missing"));

    expect(detail.payload).toBeUndefined();
  });

  test("returns no payload when the stored payload id no longer resolves", async () => {
    const store = new InMemoryArtifactStore();

    await store.createArtifact({
      id: "design-tokens",
      type: "design.tokens",
      metadata: { payloadId: "does-not-exist" },
    });

    const service = new ArtifactInspectionService({
      artifactRegistry: store,
      artifactStore: store,
    });

    const detail = await service.getPayload(summaryFor("design-tokens"));

    expect(detail.payload).toBeUndefined();
  });
});
