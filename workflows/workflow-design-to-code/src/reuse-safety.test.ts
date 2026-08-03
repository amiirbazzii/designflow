// workflows/workflow-design-to-code/src/reuse-safety.test.ts
import { describe, expect, test } from "bun:test";
import { withReuseIdentity } from "@designflow/sdk";
import {
  ARTIFACT_IDS,
  designToCodeApprovalPolicy,
} from "./index";
import {
  SAMPLE_DESIGN,
  createHost,
  type DesignToCodeHost,
} from "./harness.test-support";

/**
 * Stage 1 regression suite: reuse must depend on the true identity of a run
 * (design, frames, framework, project, dependency versions, ...), never on a
 * logical artifact id existing in isolation.
 *
 * Every test here starts a *fresh, non-resumed* execution for its second run
 * — no `incrementalMetadata`/declared change set — because that ordinary path
 * is exactly where the pre-Stage-1 resolver granted reuse to any run whose
 * artifact ids merely already existed, regardless of what produced them. Each
 * host is constructed fresh per test (in-memory, isolated) so no test depends
 * on another's state or on any local DesignFlow history.
 */

const capabilitiesRun = (host: DesignToCodeHost): string[] =>
  host.events
    .filter((event) => event.type === "capability.completed")
    .map((event) => String(event.payload?.capabilityId));

const reusedArtifactIds = (host: DesignToCodeHost): string[] =>
  host.events
    .filter((event) => event.type === "artifact.reused")
    .map((event) => String(event.payload?.artifactId));

async function versionsOf(host: DesignToCodeHost): Promise<(number | undefined)[]> {
  return Promise.all(
    Object.values(ARTIFACT_IDS).map(
      async (id) => (await host.artifactStore.getArtifact(id))?.version,
    ),
  );
}

describe("reuse safety — identical input", () => {
  test("an unchanged rerun reuses every artifact, executing nothing", async () => {
    const host = createHost({ incremental: true });

    await host.runner.start({ workflowId: "design-to-code", input: SAMPLE_DESIGN });

    host.events.length = 0;

    const second = await host.service.execute({
      workflowId: "design-to-code",
      input: SAMPLE_DESIGN,
    });

    expect(second.status).toBe("completed");
    expect(capabilitiesRun(host)).toEqual([]);
    expect(reusedArtifactIds(host).sort()).toEqual(
      [...Object.values(ARTIFACT_IDS)].sort(),
    );
  });

  test("versions do not change across a genuinely identical rerun", async () => {
    const host = createHost({ incremental: true });

    await host.runner.start({ workflowId: "design-to-code", input: SAMPLE_DESIGN });
    const before = await versionsOf(host);

    await host.service.execute({
      workflowId: "design-to-code",
      input: SAMPLE_DESIGN,
    });
    const after = await versionsOf(host);

    expect(after).toEqual(before);
    expect(after.every((version) => version === 1)).toBe(true);
  });
});

describe("reuse safety — changed design identity", () => {
  test("a different design file invalidates the whole chain", async () => {
    const host = createHost({ incremental: true });

    await host.runner.start({ workflowId: "design-to-code", input: SAMPLE_DESIGN });

    host.events.length = 0;

    await host.service.execute({
      workflowId: "design-to-code",
      input: { ...SAMPLE_DESIGN, designFile: "checkout.fig" },
    });

    expect(capabilitiesRun(host)).toEqual([
      "analyze-design",
      "extract-design-tokens",
      "create-component-structure",
      "generate-code",
      "validate-output",
    ]);
  });

  test("a different frame selection invalidates the whole chain", async () => {
    const host = createHost({ incremental: true });

    await host.runner.start({ workflowId: "design-to-code", input: SAMPLE_DESIGN });

    host.events.length = 0;

    await host.service.execute({
      workflowId: "design-to-code",
      input: { ...SAMPLE_DESIGN, frames: ["brand/Header", "brand/CallToAction"] },
    });

    expect(capabilitiesRun(host)).toEqual([
      "analyze-design",
      "extract-design-tokens",
      "create-component-structure",
      "generate-code",
      "validate-output",
    ]);
  });

  test("a different framework regenerates the tree and code, but reuses the analysis and tokens", async () => {
    const host = createHost({ incremental: true });

    await host.runner.start({ workflowId: "design-to-code", input: SAMPLE_DESIGN });

    host.events.length = 0;

    await host.service.execute({
      workflowId: "design-to-code",
      input: { ...SAMPLE_DESIGN, framework: "vue" },
    });

    expect(capabilitiesRun(host)).toEqual([
      "create-component-structure",
      "generate-code",
      "validate-output",
    ]);
    expect(reusedArtifactIds(host).sort()).toEqual(
      [ARTIFACT_IDS.designAnalysis, ARTIFACT_IDS.designTokens].sort(),
    );
  });

  test("an unrelated design cannot report Created 0, Reused 5", async () => {
    const host = createHost({ incremental: true });

    await host.runner.start({ workflowId: "design-to-code", input: SAMPLE_DESIGN });

    host.events.length = 0;

    const unrelatedDesign = {
      designFile: "settings-page.fig",
      framework: "svelte" as const,
      frames: ["admin/Sidebar", "admin/UserTable"],
    };

    await host.service.execute({
      workflowId: "design-to-code",
      input: unrelatedDesign,
    });

    // Every node must have actually run — none of design B's artifacts may be
    // reported as reused just because design A already occupies those ids.
    expect(capabilitiesRun(host)).toHaveLength(5);
    expect(reusedArtifactIds(host)).toEqual([]);
  });
});

describe("reuse safety — project identity", () => {
  test("the same design under a different project does not cross-reuse", async () => {
    const host = createHost({ incremental: true });

    await host.service.execute({
      workflowId: "design-to-code",
      input: SAMPLE_DESIGN,
      metadata: withReuseIdentity({}, { projectId: "project-a" }),
    });

    host.events.length = 0;

    await host.service.execute({
      workflowId: "design-to-code",
      input: SAMPLE_DESIGN,
      metadata: withReuseIdentity({}, { projectId: "project-b" }),
    });

    expect(capabilitiesRun(host)).toHaveLength(5);
    expect(reusedArtifactIds(host)).toEqual([]);
  });

  test("the same design and the same project reuse safely", async () => {
    const host = createHost({ incremental: true });
    const metadata = withReuseIdentity({}, { projectId: "project-a" });

    await host.service.execute({
      workflowId: "design-to-code",
      input: SAMPLE_DESIGN,
      metadata,
    });

    host.events.length = 0;

    await host.service.execute({
      workflowId: "design-to-code",
      input: SAMPLE_DESIGN,
      metadata,
    });

    expect(capabilitiesRun(host)).toEqual([]);
  });

  test("a changed project context fingerprint invalidates reuse for the same project id", async () => {
    const host = createHost({ incremental: true });

    await host.service.execute({
      workflowId: "design-to-code",
      input: SAMPLE_DESIGN,
      metadata: withReuseIdentity(
        {},
        { projectId: "project-a", projectContextFingerprint: "facts-v1" },
      ),
    });

    host.events.length = 0;

    await host.service.execute({
      workflowId: "design-to-code",
      input: SAMPLE_DESIGN,
      metadata: withReuseIdentity(
        {},
        { projectId: "project-a", projectContextFingerprint: "facts-v2" },
      ),
    });

    // The project's own facts changed (framework detection, source root, ...)
    // even though the raw design input did not — still not safe to reuse.
    expect(capabilitiesRun(host)).toHaveLength(5);
  });
});

describe("reuse safety — dependency version changes", () => {
  test("an upstream artifact revised out of band invalidates its dependents", async () => {
    const host = createHost({ incremental: true });

    await host.runner.start({ workflowId: "design-to-code", input: SAMPLE_DESIGN });

    // Simulates something upstream of this workflow revising the design
    // analysis directly in the registry, without going through the workflow —
    // exactly what a future capability with a real Figma dependency would do.
    await host.artifactStore.createVersion(ARTIFACT_IDS.designAnalysis, {
      designFile: SAMPLE_DESIGN.designFile,
      componentCount: 99,
      tokenGroups: ["brand", "layout"],
    });

    host.events.length = 0;

    await host.service.execute({
      workflowId: "design-to-code",
      input: SAMPLE_DESIGN,
    });

    // `extract-design-tokens` depended on version 1 of the analysis; version 2
    // now exists, so it and everything after it must recompute even though the
    // workflow's own input did not change.
    expect(capabilitiesRun(host)).toEqual([
      "extract-design-tokens",
      "create-component-structure",
      "generate-code",
      "validate-output",
    ]);
  });
});

describe("reuse safety — legacy artifacts", () => {
  test("an artifact with no stored reuse fingerprint is never treated as reusable", async () => {
    const host = createHost({ incremental: true });

    // Simulates an artifact produced before Stage 1 — registered the way the
    // pre-Stage-1 engine did, with no `reuseFingerprint` in its metadata.
    await host.artifactStore.createArtifact({
      id: ARTIFACT_IDS.designAnalysis,
      type: "design.analysis",
      metadata: {
        designFile: SAMPLE_DESIGN.designFile,
        componentCount: 3,
        tokenGroups: ["brand", "layout"],
      },
    });

    const result = await host.service.execute({
      workflowId: "design-to-code",
      input: SAMPLE_DESIGN,
    });

    expect(result.status).toBe("completed");
    expect(capabilitiesRun(host)).toContain("analyze-design");
    expect(reusedArtifactIds(host)).not.toContain(ARTIFACT_IDS.designAnalysis);
  });
});

describe("reuse safety — approval and resume are unaffected", () => {
  test("a run gated on approval still pauses, resumes, and completes with correct reuse counts", async () => {
    const host = createHost({
      policy: designToCodeApprovalPolicy,
      incremental: true,
    });

    const first = await host.runner.start({
      workflowId: "design-to-code",
      input: SAMPLE_DESIGN,
    });
    expect(first.state).toBe("needs_approval");

    await host.runner.approve(first.executionId);

    const status = await host.runner.status(first.executionId);
    expect(status.state).toBe("ready");

    host.events.length = 0;

    // A second, independent run of the exact same design, after resume, must
    // still reuse safely rather than being poisoned by the approval pause —
    // the gate still fires (every execution is evaluated against the policy
    // before reuse is even considered), but nothing behind it recomputes.
    const second = await host.service.execute({
      workflowId: "design-to-code",
      input: SAMPLE_DESIGN,
    });

    expect(second.status).toBe("pending_approval");
    expect(capabilitiesRun(host)).toEqual([]);

    await host.runner.approve(second.executionId);
    const secondStatus = await host.runner.status(second.executionId);

    expect(secondStatus.state).toBe("ready");
    expect(capabilitiesRun(host)).toEqual([]);
  });
});
