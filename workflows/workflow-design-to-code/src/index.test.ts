import { describe, expect, test } from "bun:test";
import { workflowDefinitionSchema } from "@designflow/sdk";
import { designToCodeWorkflowPackage } from "./manifest";
import { designToCodeApprovalPolicy, designToCodeWorkflow } from "./workflow";
import {
  ARTIFACT_IDS,
  componentTreeSchema,
  designTokensSchema,
  sourceCodeSchema,
  validationReportSchema,
} from "./types";
import {
  SAMPLE_DESIGN,
  createHost,
  incrementalMetadata,
} from "./harness.test-support";
import type { DesignToCodeHost } from "./harness.test-support";

// ── Helpers ─────────────────────────────────────────────────────

/** Loads the payload a logical artifact points at. */
const loadPayload = async (
  host: DesignToCodeHost,
  artifactId: string,
): Promise<unknown> => {
  const artifact = await host.artifactStore.getArtifact(artifactId);
  if (artifact === null) return null;

  const payloadId = artifact.metadata.payloadId;
  if (typeof payloadId !== "string") return null;

  return (await host.artifactStore.get(payloadId))?.data ?? null;
};

const capabilitiesRun = (host: DesignToCodeHost): string[] =>
  host.events
    .filter((event) => event.type === "capability.completed")
    .map((event) => String(event.payload?.capabilityId));

// ── 1. Workflow definition loads ────────────────────────────────

describe("workflow definition", () => {
  test("parses against the SDK schema", () => {
    const parsed = workflowDefinitionSchema.parse(designToCodeWorkflow);

    expect(parsed.id).toBe("design-to-code");
    expect(parsed.name).toBe("Design → Code");
    expect(parsed.nodes).toHaveLength(5);
  });

  test("declares the artifact each node produces", () => {
    const produced = designToCodeWorkflow.nodes.flatMap(
      (node) => node.produces ?? [],
    );

    expect(produced).toEqual([
      ARTIFACT_IDS.designAnalysis,
      ARTIFACT_IDS.designTokens,
      ARTIFACT_IDS.componentTree,
      ARTIFACT_IDS.sourceCode,
      ARTIFACT_IDS.validationReport,
    ]);
  });

  test("registers its capabilities through the manifest", () => {
    const registered: string[] = [];

    designToCodeWorkflowPackage.load({
      register: (capability) => {
        registered.push(capability.id);
      },
      registerPackage: () => {},
    });

    expect(registered).toEqual([
      "analyze-design",
      "extract-design-tokens",
      "create-component-structure",
      "generate-code",
      "validate-output",
    ]);
    expect(designToCodeWorkflowPackage.capabilities).toEqual(registered);
  });

  test("gates the only filesystem-writing capability", () => {
    expect(designToCodeApprovalPolicy.rules[0]).toMatchObject({
      type: "require_approval",
      target: "generate-code",
    });
  });
});

// ── 2. Full execution produces expected artifacts ───────────────

describe("full execution", () => {
  test("converts a design into validated source code", async () => {
    const host = createHost();

    const execution = await host.runner.start({
      workflowId: "design-to-code",
      input: SAMPLE_DESIGN,
    });

    expect(execution.state).toBe("ready");
    expect(capabilitiesRun(host)).toEqual([
      "analyze-design",
      "extract-design-tokens",
      "create-component-structure",
      "generate-code",
      "validate-output",
    ]);
  });

  test("produces every declared artifact", async () => {
    const host = createHost();
    await host.runner.start({
      workflowId: "design-to-code",
      input: SAMPLE_DESIGN,
    });

    for (const artifactId of Object.values(ARTIFACT_IDS)) {
      expect(await host.artifactStore.getArtifact(artifactId)).not.toBeNull();
    }
  });

  test("registers a payload blob alongside each logical artifact", async () => {
    const host = createHost();
    await host.runner.start({
      workflowId: "design-to-code",
      input: SAMPLE_DESIGN,
    });

    const created = host.events.filter(
      (event) => event.type === "artifact.created",
    );

    // Two identities per node, by design: `save` content-addresses the payload
    // and registers it, and the capability returns a stable logical id on top.
    // Ten registrations for five conceptual outputs is the cost of having both
    // content addressing and an identity that survives across runs.
    expect(created).toHaveLength(10);
  });

  test("generates one source file per design frame", async () => {
    const host = createHost();
    await host.runner.start({
      workflowId: "design-to-code",
      input: SAMPLE_DESIGN,
    });

    const code = sourceCodeSchema.parse(
      await loadPayload(host, ARTIFACT_IDS.sourceCode),
    );

    expect(code.framework).toBe("react");
    expect(code.files.map((file) => file.path)).toEqual([
      "src/components/Header.tsx",
      "src/components/Footer.tsx",
      "src/components/Sidebar.tsx",
    ]);
  });

  test("derives tokens from the design's own structure", async () => {
    const host = createHost();
    await host.runner.start({
      workflowId: "design-to-code",
      input: SAMPLE_DESIGN,
    });

    const tokens = designTokensSchema.parse(
      await loadPayload(host, ARTIFACT_IDS.designTokens),
    );

    expect(tokens.colors).toEqual(["color.brand", "color.layout"]);
  });

  test("reports a passing validation", async () => {
    const host = createHost();
    await host.runner.start({
      workflowId: "design-to-code",
      input: SAMPLE_DESIGN,
    });

    const report = validationReportSchema.parse(
      await loadPayload(host, ARTIFACT_IDS.validationReport),
    );

    expect(report.passed).toBe(true);
    expect(report.checked).toBe(3);
  });

  test("passes data only through artifacts", async () => {
    const host = createHost();
    await host.runner.start({
      workflowId: "design-to-code",
      input: SAMPLE_DESIGN,
    });

    const tree = componentTreeSchema.parse(
      await loadPayload(host, ARTIFACT_IDS.componentTree),
    );

    // create-component-structure never received the analysis or the tokens as
    // arguments — it loaded both from the artifact store.
    expect(tree.components.map((component) => component.name)).toEqual([
      "Header",
      "Footer",
      "Sidebar",
    ]);
    expect(tree.components[0]?.uses).toEqual(["color.brand", "color.layout"]);
  });
});

// ── 3. Artifact lineage exists ──────────────────────────────────

describe("artifact lineage", () => {
  test("links each artifact to the ones it was built from", async () => {
    const host = createHost();
    await host.runner.start({
      workflowId: "design-to-code",
      input: SAMPLE_DESIGN,
    });

    const lineage = await host.artifactStore.getLineage(
      ARTIFACT_IDS.validationReport,
    );

    expect(lineage.ancestors).toContain(ARTIFACT_IDS.sourceCode);
    expect(lineage.ancestors).toContain(ARTIFACT_IDS.componentTree);
    expect(lineage.ancestors).toContain(ARTIFACT_IDS.designAnalysis);
  });

  test("records which capability produced each artifact", async () => {
    const host = createHost();
    await host.runner.start({
      workflowId: "design-to-code",
      input: SAMPLE_DESIGN,
    });

    const tokens = await host.artifactStore.getArtifact(
      ARTIFACT_IDS.designTokens,
    );

    expect(tokens?.provenance?.capabilityId).toBe("extract-design-tokens");
    expect(tokens?.provenance?.workflowId).toBe("design-to-code");
  });

  test("walks forward from the design analysis to everything downstream", async () => {
    const host = createHost();
    await host.runner.start({
      workflowId: "design-to-code",
      input: SAMPLE_DESIGN,
    });

    const lineage = await host.artifactStore.getLineage(
      ARTIFACT_IDS.designAnalysis,
    );

    expect(lineage.descendants).toContain(ARTIFACT_IDS.designTokens);
    expect(lineage.descendants).toContain(ARTIFACT_IDS.sourceCode);
  });
});

// ── 4. Second execution reuses unchanged artifacts ──────────────

describe("incremental re-run", () => {
  test("re-running an unchanged design changes no artifact version", async () => {
    const host = createHost({ incremental: true });

    const first = await host.runner.start({
      workflowId: "design-to-code",
      input: SAMPLE_DESIGN,
    });

    const versionsAfterFirst = await Promise.all(
      Object.values(ARTIFACT_IDS).map(async (id) =>
        (await host.artifactStore.getArtifact(id))?.version,
      ),
    );

    await host.service.execute({
      workflowId: "design-to-code",
      input: SAMPLE_DESIGN,
      metadata: incrementalMetadata(first.executionId, []),
    });

    const versionsAfterSecond = await Promise.all(
      Object.values(ARTIFACT_IDS).map(async (id) =>
        (await host.artifactStore.getArtifact(id))?.version,
      ),
    );

    // Deterministic capabilities re-emit identical artifacts, so nothing is
    // versioned. This is what makes reuse detectable at all.
    expect(versionsAfterSecond).toEqual(versionsAfterFirst);
    expect(versionsAfterSecond.every((version) => version === 1)).toBe(true);
  });

  test("skips every node when nothing changed", async () => {
    const host = createHost({ incremental: true });

    const first = await host.runner.start({
      workflowId: "design-to-code",
      input: SAMPLE_DESIGN,
    });

    host.events.length = 0;

    await host.service.execute({
      workflowId: "design-to-code",
      input: SAMPLE_DESIGN,
      metadata: incrementalMetadata(first.executionId, []),
    });

    const plan = host.events.find(
      (event) => event.type === "execution.plan_created",
    );

    expect(plan?.payload?.executionNodes).toEqual([]);
    expect(plan?.payload?.skippedNodes).toHaveLength(5);
    expect(capabilitiesRun(host)).toEqual([]);
  });
});

// ── 5. Changed input causes partial regeneration ────────────────

describe("partial regeneration", () => {
  test("a token change regenerates only what depends on it", async () => {
    const host = createHost({ incremental: true });

    const first = await host.runner.start({
      workflowId: "design-to-code",
      input: SAMPLE_DESIGN,
    });

    host.events.length = 0;

    await host.service.execute({
      workflowId: "design-to-code",
      input: SAMPLE_DESIGN,
      metadata: incrementalMetadata(first.executionId, [
        ARTIFACT_IDS.designTokens,
      ]),
    });

    const plan = host.events.find(
      (event) => event.type === "execution.plan_created",
    );

    // Tokens feed the component tree, which feeds the code, which feeds
    // validation. The design analysis is upstream and untouched.
    expect(plan?.payload?.executionNodes).toEqual([
      "extract-design-tokens",
      "create-component-structure",
      "generate-code",
      "validate-output",
    ]);
    expect(plan?.payload?.skippedNodes).toEqual(["analyze-design"]);
  });

  test("a code change regenerates only the validation", async () => {
    const host = createHost({ incremental: true });

    const first = await host.runner.start({
      workflowId: "design-to-code",
      input: SAMPLE_DESIGN,
    });

    host.events.length = 0;

    await host.service.execute({
      workflowId: "design-to-code",
      input: SAMPLE_DESIGN,
      metadata: incrementalMetadata(first.executionId, [
        ARTIFACT_IDS.sourceCode,
      ]),
    });

    expect(capabilitiesRun(host)).toEqual(["generate-code", "validate-output"]);
  });

  test("reconciles the reused and regenerated artifacts into one set", async () => {
    const host = createHost({ incremental: true });

    const first = await host.runner.start({
      workflowId: "design-to-code",
      input: SAMPLE_DESIGN,
    });

    host.events.length = 0;

    await host.service.execute({
      workflowId: "design-to-code",
      input: SAMPLE_DESIGN,
      metadata: incrementalMetadata(first.executionId, [
        ARTIFACT_IDS.sourceCode,
      ]),
    });

    const reconciled = host.events.find(
      (event) => event.type === "execution.reconciled",
    );

    expect(reconciled).toBeDefined();
    expect(reconciled?.payload?.removed).toBe(0);
  });
});

// ── 6 & 7. Approval pauses and resumes execution ────────────────

describe("approval gate", () => {
  test("pauses before generating code", async () => {
    const host = createHost({ policy: designToCodeApprovalPolicy });

    const execution = await host.runner.start({
      workflowId: "design-to-code",
      input: SAMPLE_DESIGN,
    });

    expect(execution.state).toBe("needs_approval");

    const pending = await host.runner.pendingApproval(execution.executionId);
    expect(pending?.reason).toContain("approve-code-generation");

    // Nothing ran: the gate is evaluated before the workflow starts.
    expect(capabilitiesRun(host)).toEqual([]);
  });

  test("surfaces the gate through the product status", async () => {
    const host = createHost({ policy: designToCodeApprovalPolicy });

    const execution = await host.runner.start({
      workflowId: "design-to-code",
      input: SAMPLE_DESIGN,
    });

    const status = await host.runner.status(execution.executionId);

    expect(status.state).toBe("needs_approval");
    expect(status.message).toStartWith("Needs your approval");
  });

  test("resumes and completes once approved", async () => {
    const host = createHost({ policy: designToCodeApprovalPolicy });

    const execution = await host.runner.start({
      workflowId: "design-to-code",
      input: SAMPLE_DESIGN,
    });

    const outcome = await host.runner.approve(
      execution.executionId,
      "reviewed the diff",
    );

    expect(outcome.decision).toBe("approve");
    expect(outcome.state).toBe("ready");
    expect(capabilitiesRun(host)).toEqual([
      "analyze-design",
      "extract-design-tokens",
      "create-component-structure",
      "generate-code",
      "validate-output",
    ]);

    const code = sourceCodeSchema.parse(
      await loadPayload(host, ARTIFACT_IDS.sourceCode),
    );
    expect(code.files).toHaveLength(3);
  });

  test("stops the workflow when rejected", async () => {
    const host = createHost({ policy: designToCodeApprovalPolicy });

    const execution = await host.runner.start({
      workflowId: "design-to-code",
      input: SAMPLE_DESIGN,
    });

    const outcome = await host.runner.reject(execution.executionId, "not yet");

    expect(outcome.decision).toBe("reject");
    expect(outcome.state).toBe("failed");
    expect(capabilitiesRun(host)).toEqual([]);
    expect(
      await host.artifactStore.getArtifact(ARTIFACT_IDS.sourceCode),
    ).toBeNull();
  });

  test("runs straight through when no policy is configured", async () => {
    const host = createHost();

    const execution = await host.runner.start({
      workflowId: "design-to-code",
      input: SAMPLE_DESIGN,
    });

    expect(execution.state).toBe("ready");
  });
});

// ── 8. Product layer can launch the workflow ────────────────────

describe("product integration", () => {
  test("launches through the runner without engine plumbing", async () => {
    const host = createHost();

    const execution = await host.runner.start({
      workflowId: "design-to-code",
      input: SAMPLE_DESIGN,
    });

    expect(execution.workflowName).toBe("Design → Code");
    expect(execution.workflowId).toBe("design-to-code");
  });

  test("reports progress as a readable checklist", async () => {
    const host = createHost();

    const execution = await host.runner.start({
      workflowId: "design-to-code",
      input: SAMPLE_DESIGN,
    });

    const progress = await host.runner.progress(execution.executionId);

    expect(progress.total).toBe(5);
    expect(progress.completed).toBe(5);
    expect(progress.percent).toBe(100);
    expect(progress.steps.map((step) => step.label)).toEqual([
      "Analyze design",
      "Extract design tokens",
      "Create component structure",
      "Generate code",
      "Validate output",
    ]);
  });

  test("lists the run in the workflow's history", async () => {
    const host = createHost();

    await host.runner.start({
      workflowId: "design-to-code",
      input: SAMPLE_DESIGN,
    });

    const history = await host.runner.history("design-to-code");

    expect(history).toHaveLength(1);
    expect(history[0]?.state).toBe("ready");
    expect(history[0]?.summary).toContain("Design → Code finished");
  });
});

// ── 9. Execution explanation is readable ────────────────────────

describe("execution explanation", () => {
  test("narrates the run in plain language", async () => {
    const host = createHost();

    const execution = await host.runner.start({
      workflowId: "design-to-code",
      input: SAMPLE_DESIGN,
    });

    const report = await host.runner.explain(execution.executionId);

    const messages = report.narration.map((entry) => entry.message);

    expect(messages[0]).toBe("Started workflow");
    expect(messages[1]).toBe("Planning workflow");
    expect(messages[2]).toBe("Running workflow steps");
    expect(messages.at(-1)).toBe("Completed successfully");

    // One narrated completion per node. Capability and artifact events
    // alternate, so each node narrates as its own pair rather than collapsing
    // into two totals.
    expect(
      messages.filter((message) => message === "Completed 1 step"),
    ).toHaveLength(5);
    expect(
      messages.some((message) => message.startsWith("Generated ")),
    ).toBe(true);
    expect(messages).toContain("Validating results");
  });

  test("describes each artifact with its producer and dependencies", async () => {
    const host = createHost();

    const execution = await host.runner.start({
      workflowId: "design-to-code",
      input: SAMPLE_DESIGN,
    });

    const report = await host.runner.explain(execution.executionId);
    const tokens = report.artifacts.find(
      (artifact) => artifact.artifactId === ARTIFACT_IDS.designTokens,
    );

    expect(tokens?.name).toBe("Design tokens");
    expect(tokens?.createdBy).toBe("extract-design-tokens");
    expect(tokens?.dependencies).toContain("Design analysis");
  });

  test("builds an ordered timeline of the run", async () => {
    const host = createHost();

    const execution = await host.runner.start({
      workflowId: "design-to-code",
      input: SAMPLE_DESIGN,
    });

    const report = await host.runner.explain(execution.executionId);
    const offsets = report.timeline.entries.map((entry) => entry.offsetMs);

    expect(offsets.length).toBeGreaterThan(0);
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
    expect(report.timeline.entries[0]?.label).toBe("Started workflow");
  });

  test("explains an incremental re-run as reuse", async () => {
    const host = createHost({ incremental: true });

    const first = await host.runner.start({
      workflowId: "design-to-code",
      input: SAMPLE_DESIGN,
    });

    const second = await host.service.execute({
      workflowId: "design-to-code",
      input: SAMPLE_DESIGN,
      metadata: incrementalMetadata(first.executionId, [
        ARTIFACT_IDS.sourceCode,
      ]),
    });

    const report = await host.runner.explain(second.executionId);
    const messages = report.narration.map((entry) => entry.message);

    expect(messages).toContain("Reused 3 existing artifacts");
    expect(
      messages.some((message) =>
        message.startsWith("Analyzed dependencies —"),
      ),
    ).toBe(true);
  });
});
