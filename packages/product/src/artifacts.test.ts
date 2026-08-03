// packages/product/src/artifacts.test.ts
import { describe, expect, test } from "bun:test";
import type { ExecutionEvent } from "@designflow/sdk";
import { InMemoryArtifactStore } from "@designflow/core";
import { classifyArtifacts, summarizeArtifacts } from "./artifacts";

function event(
  type: ExecutionEvent["type"],
  payload: Record<string, unknown>,
): ExecutionEvent {
  return {
    id: crypto.randomUUID(),
    executionId: "exec-1",
    type,
    timestamp: 0,
    payload,
  };
}

describe("classifyArtifacts", () => {
  test("classifies a first-time artifact.created as created", () => {
    const statuses = classifyArtifacts([
      event("artifact.created", { artifactId: "a", version: 1 }),
    ]);

    expect(statuses.get("a")).toBe("created");
  });

  test("classifies artifact.reused as reused", () => {
    const statuses = classifyArtifacts([
      event("artifact.reused", { artifactId: "a", version: 3 }),
    ]);

    expect(statuses.get("a")).toBe("reused");
  });

  /**
   * Regression: `FileArtifactStore`/`InMemoryArtifactStore` only publish
   * `artifact.created` the first time a logical id is ever registered. A
   * later run that recomputes the same id — because Stage 1's reuse-identity
   * fix correctly declined to reuse it — publishes only
   * `artifact.version_created`. Before this fix, that meant a genuinely
   * recomputed artifact silently vanished from `designflow artifacts` and
   * the completion report's artifact list, rather than showing as created.
   */
  test("classifies a version bump with no matching created/reused event as created", () => {
    const statuses = classifyArtifacts([
      event("artifact.version_created", { artifactId: "a", version: 2 }),
    ]);

    expect(statuses.get("a")).toBe("created");
  });

  test("reuse still wins when both a version bump and a reuse are seen for the same id", () => {
    const statuses = classifyArtifacts([
      event("artifact.version_created", { artifactId: "a", version: 2 }),
      event("artifact.reused", { artifactId: "a", version: 2 }),
    ]);

    expect(statuses.get("a")).toBe("reused");
  });
});

describe("summarizeArtifacts", () => {
  test("includes an artifact that was recomputed to a new version, not just first-created ones", async () => {
    const store = new InMemoryArtifactStore();

    await store.createArtifact({ id: "design-tokens", type: "design.tokens", metadata: { name: "Design tokens" } });
    await store.createVersion("design-tokens", { name: "Design tokens", colorCount: 3 });

    const events: ExecutionEvent[] = [
      event("artifact.version_created", { artifactId: "design-tokens", version: 2 }),
    ];

    const summaries = await summarizeArtifacts(store, events);

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      artifactId: "design-tokens",
      name: "Design tokens",
      status: "created",
      version: 2,
    });
  });
});
