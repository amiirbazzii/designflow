import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createFigmaSpecificationHost, SAMPLE_FIGMA_MCP_FIXTURES, type FigmaSpecificationHost } from "../test/support/harness";
import { designToCodeImplementationApprovalPolicy } from "./implementation-manifest";
import { IMPLEMENTATION_ARTIFACT_IDS } from "./implementation-types";
import { VISUAL_VALIDATION_ARTIFACT_IDS } from "./visual-validation-types";

const hosts: FigmaSpecificationHost[] = [];
afterEach(async () => { for (const host of hosts.splice(0)) host.close(); });

async function fixture(failValidation = false): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "designflow-stage4-workflow-"));
  const sentinel = ["must-never-leak", "7f82c"].join("-");
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "stage4-fixture", scripts: { typecheck: failValidation ? "bun run missing-check" : "bun --version", build: "bun --version" }, dependencies: { react: "18.0.0" } }));
  await writeFile(join(root, "package-lock.json"), "{}\n");
  await writeFile(join(root, ".env"), `DESIGNFLOW_TEST_SECRET=${sentinel}\n`);
  await writeFile(join(root, "src-placeholder"), "fixture\n");
  return root;
}

function input(root: string, stateDirectory: string) {
  return { enabled: true as const, designFile: "https://www.figma.com/design/E958ARSSBoJjblLhxZQVSU/Spendly?node-id=432-2906&t=YkNcoLPyhLHx58O9-1", frames: ["Header"], project: { id: "fixture-project", name: "Stage 4 Fixture", rootPath: root }, stateDirectory, captureScreenshots: false, refreshFigmaSource: false, allowFixtureNames: false, figmaAgentVersion: "0.1.0", implementationAgentVersion: "0.1.0", implementationAgentModelProfileId: "implementation-default" };
}

describe("Stage 4 implementation workflow", () => {
  test("runs through specification, inspection, mapping, proposal, approval, application and validation", async () => {
    const root = await fixture();
    const state = await mkdtemp(join(tmpdir(), "designflow-stage4-state-"));
    const host = await createFigmaSpecificationHost({ fixtures: SAMPLE_FIGMA_MCP_FIXTURES, policy: designToCodeImplementationApprovalPolicy, implementation: true });
    hosts.push(host);
    const handle = await host.runner.start({ workflowId: "design-to-code-implementation", input: input(root, state) });
    expect(handle.state).toBe("needs_approval");
    expect(await readFile(join(root, ".env"), "utf8")).toContain(["must-never-leak", "7f82c"].join("-"));
    expect(await host.artifactStore.getArtifact(IMPLEMENTATION_ARTIFACT_IDS.proposal)).not.toBeNull();
    expect(await host.artifactStore.getArtifact(IMPLEMENTATION_ARTIFACT_IDS.snapshot)).toBeNull();
    expect(await host.artifactStore.getArtifact(IMPLEMENTATION_ARTIFACT_IDS.application)).toBeNull();
    expect(await host.artifactStore.getArtifact(IMPLEMENTATION_ARTIFACT_IDS.validation)).toBeNull();
    expect((await host.service.resume("design-to-code-implementation")).status).toBe("pending_approval");
    const rejected = await host.runner.reject(handle.executionId, "Rejecting preview leaves the fixture untouched.");
    expect(rejected.state).toBe("failed");
    await expect(readFile(join(root, "src/Header.tsx"))).rejects.toBeDefined();
    await rm(root, { recursive: true, force: true });
    await rm(state, { recursive: true, force: true });
  });

  test("approved changes produce final lineage and a successful validation report", async () => {
    const root = await fixture();
    const state = await mkdtemp(join(tmpdir(), "designflow-stage4-state-"));
    const host = await createFigmaSpecificationHost({ fixtures: SAMPLE_FIGMA_MCP_FIXTURES, policy: designToCodeImplementationApprovalPolicy, implementation: true });
    hosts.push(host);
    const handle = await host.runner.start({ workflowId: "design-to-code-implementation", input: input(root, state) });
    expect(handle.state).toBe("needs_approval");
    const approved = await host.runner.approve(handle.executionId, "Approved exact proposal for the registered fixture.");
    expect(approved.state).toBe("ready");
    await expect(host.runner.approve(handle.executionId, "duplicate")).rejects.toBeDefined();
    expect(await host.artifactStore.getArtifact(IMPLEMENTATION_ARTIFACT_IDS.snapshot)).not.toBeNull();
    expect(await host.artifactStore.getArtifact(IMPLEMENTATION_ARTIFACT_IDS.generated)).not.toBeNull();
    const summary = await host.artifactStore.getArtifact(IMPLEMENTATION_ARTIFACT_IDS.summary);
    expect(summary).not.toBeNull();
    const visualReport = await host.artifactStore.getArtifact(VISUAL_VALIDATION_ARTIFACT_IDS.report);
    expect(visualReport).not.toBeNull();
    expect(await host.artifactStore.getArtifact(VISUAL_VALIDATION_ARTIFACT_IDS.domEvidence)).not.toBeNull();
    const visualSummary = await host.artifactStore.getArtifact(VISUAL_VALIDATION_ARTIFACT_IDS.summary);
    expect(visualSummary).not.toBeNull();
    const visualPayloadId = visualSummary?.metadata["payloadId"];
    const visualPayload = await host.artifactStore.get(String(visualPayloadId));
    expect(visualPayload?.data).toMatchObject({ overallStatus: "unavailable", projectFilesChanged: false, correctionsApplied: false });
    expect(await readFile(join(root, "src/Header.tsx"), "utf8")).toContain("Generated by the Implementation Agent");
    await rm(root, { recursive: true, force: true });
    await rm(state, { recursive: true, force: true });
  });

  test("required validation failure rolls the fixture back automatically", async () => {
    const root = await fixture(true);
    const state = await mkdtemp(join(tmpdir(), "designflow-stage4-state-"));
    const host = await createFigmaSpecificationHost({ fixtures: SAMPLE_FIGMA_MCP_FIXTURES, policy: designToCodeImplementationApprovalPolicy, implementation: true });
    hosts.push(host);
    const handle = await host.runner.start({ workflowId: "design-to-code-implementation", input: input(root, state) });
    expect(handle.state).toBe("needs_approval");
    const result = await host.runner.approve(handle.executionId, "Approve controlled validation failure.");
    expect(result.state).toBe("failed");
    const validation = await host.artifactStore.getArtifact(IMPLEMENTATION_ARTIFACT_IDS.validation);
    expect(validation).not.toBeNull();
    const validationPayloadId = validation?.metadata["payloadId"];
    const validationPayload = await host.artifactStore.get(String(validationPayloadId));
    expect(validationPayload?.data).toMatchObject({ passed: false, rollbackTriggered: true });
    expect((validationPayload?.data as { checks: Array<{ name: string; status: string; required: boolean }> }).checks).toContainEqual(expect.objectContaining({ name: "typecheck", status: "failed", required: true }));
    expect(await host.artifactStore.getArtifact(IMPLEMENTATION_ARTIFACT_IDS.generated)).toBeNull();
    expect(await host.artifactStore.getArtifact(IMPLEMENTATION_ARTIFACT_IDS.summary)).toBeNull();
    await expect(readFile(join(root, "src/Header.tsx"))).rejects.toBeDefined();
    await rm(root, { recursive: true, force: true });
    await rm(state, { recursive: true, force: true });
  });
});

/**
 * The generated-implementation record must describe the run that produced it.
 *
 * It used to spell out an agent version and a model profile as literals, so it
 * reported "0.1.0" and "implementation-default" for every run regardless of
 * what actually ran — a provenance record that was right only by coincidence.
 * Both tests below use values that differ from those old literals, so a
 * regression to a hardcoded string fails rather than passing by accident.
 */
describe("generated-implementation provenance", () => {
  test("records the agent version and model profile the run was given", async () => {
    const root = await fixture();
    const state = await mkdtemp(join(tmpdir(), "designflow-stage4-state-"));
    const host = await createFigmaSpecificationHost({ fixtures: SAMPLE_FIGMA_MCP_FIXTURES, policy: designToCodeImplementationApprovalPolicy, implementation: true });
    hosts.push(host);
    const handle = await host.runner.start({
      workflowId: "design-to-code-implementation",
      input: { ...input(root, state), implementationAgentVersion: "9.9.9", implementationAgentModelProfileId: "implementation-alternate" },
    });
    expect((await host.runner.approve(handle.executionId, "Approved for provenance.")).state).toBe("ready");

    const generated = await host.artifactStore.getArtifact(IMPLEMENTATION_ARTIFACT_IDS.generated);
    const payload = await host.artifactStore.get(String(generated?.metadata["payloadId"]));

    expect(payload?.data).toMatchObject({ agentVersion: "9.9.9", modelProfileId: "implementation-alternate" });

    await rm(root, { recursive: true, force: true });
    await rm(state, { recursive: true, force: true });
  });

  test("the capability carries no hardcoded provenance literals", async () => {
    const source = await readFile(new URL("./implementation-side-effect-capabilities.ts", import.meta.url), "utf8");
    const body = source.replace(/\/\*[\s\S]*?\*\//g, "");

    expect(body).not.toContain('agentVersion: "0.1.0"');
    expect(body).not.toContain('modelProfileId: "implementation-default"');
  });
});
