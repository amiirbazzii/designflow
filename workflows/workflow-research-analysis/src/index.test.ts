// workflows/workflow-research-analysis/src/index.test.ts
import { describe, expect, test } from "bun:test";
import { workflowDefinitionSchema } from "@designflow/sdk";
import { researchAnalysisWorkflowPackage } from "./manifest";
import {
  researchAnalysisApprovalPolicy,
  researchAnalysisWorkflow,
} from "./workflow";
import {
  ARTIFACT_IDS,
  comparisonMatrixSchema,
  extractedClaimsSchema,
  findingsSummarySchema,
  researchBriefSchema,
  sourceInventorySchema,
} from "./types";
import {
  SAMPLE_RESEARCH,
  createHost,
  incrementalMetadata,
  type ResearchAnalysisHost,
} from "./harness.test-support";

// ── Helpers ─────────────────────────────────────────────────────

/** Loads the payload a logical artifact points at. */
const loadPayload = async (
  host: ResearchAnalysisHost,
  artifactId: string,
): Promise<unknown> => {
  const artifact = await host.artifactStore.getArtifact(artifactId);
  if (artifact === null) return null;

  const payloadId = artifact.metadata.payloadId;
  if (typeof payloadId !== "string") return null;

  return (await host.artifactStore.get(payloadId))?.data ?? null;
};

const capabilitiesRun = (host: ResearchAnalysisHost): string[] =>
  host.events
    .filter((event) => event.type === "capability.completed")
    .map((event) => String(event.payload?.capabilityId));

const SUPPLIED_SOURCE_IDS = new Set(
  SAMPLE_RESEARCH.sources.map((source) => source.id),
);

// ── 1. Workflow definition loads ────────────────────────────────

describe("workflow definition", () => {
  test("parses against the SDK schema", () => {
    const parsed = workflowDefinitionSchema.parse(researchAnalysisWorkflow);

    expect(parsed.id).toBe("research-analysis");
    expect(parsed.name).toBe("Research Analysis");
    expect(parsed.nodes).toHaveLength(5);
  });

  test("declares the artifact each node produces, ending in the research brief", () => {
    const produced = researchAnalysisWorkflow.nodes.flatMap(
      (node) => node.produces ?? [],
    );

    expect(produced).toEqual([
      ARTIFACT_IDS.sourceInventory,
      ARTIFACT_IDS.extractedClaims,
      ARTIFACT_IDS.comparisonMatrix,
      ARTIFACT_IDS.findingsSummary,
      ARTIFACT_IDS.researchBrief,
    ]);
  });

  test("registers its capabilities through the manifest", () => {
    const registered: string[] = [];

    researchAnalysisWorkflowPackage.load({
      register: (capability) => {
        registered.push(capability.id);
      },
      registerPackage: () => {},
    });

    expect(registered).toEqual([
      "normalize-research-question",
      "extract-claims",
      "compare-findings",
      "summarize-findings",
      "produce-research-brief",
    ]);
    expect(researchAnalysisWorkflowPackage.capabilities).toEqual(registered);
  });

  test("gates the final research brief on approval", () => {
    expect(researchAnalysisApprovalPolicy.rules[0]).toMatchObject({
      type: "require_approval",
      target: "produce-research-brief",
    });
  });
});

// ── 2. Full execution produces expected artifacts ───────────────

describe("full execution", () => {
  test("turns supplied sources into a cited research brief", async () => {
    const host = createHost();

    const execution = await host.runner.start({
      workflowId: "research-analysis",
      input: SAMPLE_RESEARCH,
    });

    expect(execution.state).toBe("ready");
    expect(capabilitiesRun(host)).toEqual([
      "normalize-research-question",
      "extract-claims",
      "compare-findings",
      "summarize-findings",
      "produce-research-brief",
    ]);
  });

  test("produces every declared artifact", async () => {
    const host = createHost();
    await host.runner.start({
      workflowId: "research-analysis",
      input: SAMPLE_RESEARCH,
    });

    for (const artifactId of Object.values(ARTIFACT_IDS)) {
      expect(await host.artifactStore.getArtifact(artifactId)).not.toBeNull();
    }
  });

  test("validates every supplied source as valid when all fields are present", async () => {
    const host = createHost();
    await host.runner.start({
      workflowId: "research-analysis",
      input: SAMPLE_RESEARCH,
    });

    const inventory = sourceInventorySchema.parse(
      await loadPayload(host, ARTIFACT_IDS.sourceInventory),
    );

    expect(inventory.totalSources).toBe(4);
    expect(inventory.validSources).toHaveLength(4);
    expect(inventory.invalidSources).toHaveLength(0);
  });

  test("flags a source missing required fields without failing the run", async () => {
    const host = createHost();
    await host.runner.start({
      workflowId: "research-analysis",
      input: {
        question: SAMPLE_RESEARCH.question,
        sources: [
          ...SAMPLE_RESEARCH.sources,
          { id: "src-broken", title: "No content here" },
        ],
      },
    });

    const inventory = sourceInventorySchema.parse(
      await loadPayload(host, ARTIFACT_IDS.sourceInventory),
    );

    expect(inventory.totalSources).toBe(5);
    expect(inventory.validSources).toHaveLength(4);
    expect(inventory.invalidSources).toEqual([
      { id: "src-broken", reasons: ["missing content and excerpt"] },
    ]);
  });

  test("extracts claims only from valid sources", async () => {
    const host = createHost();
    await host.runner.start({
      workflowId: "research-analysis",
      input: SAMPLE_RESEARCH,
    });

    const extracted = extractedClaimsSchema.parse(
      await loadPayload(host, ARTIFACT_IDS.extractedClaims),
    );

    expect(extracted.claims.length).toBeGreaterThan(0);
    for (const claim of extracted.claims) {
      expect(SUPPLIED_SOURCE_IDS.has(claim.sourceId)).toBe(true);
    }
  });

  test("flags the conflicting claim across the three disagreeing sources", async () => {
    const host = createHost();
    await host.runner.start({
      workflowId: "research-analysis",
      input: SAMPLE_RESEARCH,
    });

    const matrix = comparisonMatrixSchema.parse(
      await loadPayload(host, ARTIFACT_IDS.comparisonMatrix),
    );

    const conflict = matrix.groups.find((group) => group.agreement === "conflict");
    expect(conflict).toBeDefined();
    expect(conflict?.sourceIds).toEqual(["src-1", "src-2", "src-3"]);
  });

  test("summarizes findings with source and claim counts", async () => {
    const host = createHost();
    await host.runner.start({
      workflowId: "research-analysis",
      input: SAMPLE_RESEARCH,
    });

    const summary = findingsSummarySchema.parse(
      await loadPayload(host, ARTIFACT_IDS.findingsSummary),
    );

    expect(summary.sourceCount).toBe(4);
    expect(summary.keyFindings.length).toBeGreaterThan(0);
  });

  test("passes data only through artifacts", async () => {
    const host = createHost();
    await host.runner.start({
      workflowId: "research-analysis",
      input: SAMPLE_RESEARCH,
    });

    // summarize-findings never received the comparison matrix as an
    // argument — it loaded it from the artifact store.
    const brief = researchBriefSchema.parse(
      await loadPayload(host, ARTIFACT_IDS.researchBrief),
    );

    expect(brief.question).toBe(SAMPLE_RESEARCH.question);
    expect(brief.conflicts.length).toBeGreaterThan(0);
  });
});

// ── 3. Every claim in the brief traces to a supplied source ─────

describe("no unsupported claims", () => {
  test("every finding, citation and conflict cites a supplied source id", async () => {
    const host = createHost();
    await host.runner.start({
      workflowId: "research-analysis",
      input: SAMPLE_RESEARCH,
    });

    const brief = researchBriefSchema.parse(
      await loadPayload(host, ARTIFACT_IDS.researchBrief),
    );

    const unsupported: string[] = [];

    for (const finding of brief.keyFindings) {
      for (const sourceId of finding.sourceIds) {
        if (!SUPPLIED_SOURCE_IDS.has(sourceId)) unsupported.push(sourceId);
      }
    }
    for (const citation of brief.citations) {
      if (!SUPPLIED_SOURCE_IDS.has(citation.sourceId)) {
        unsupported.push(citation.sourceId);
      }
    }
    for (const conflict of brief.conflicts) {
      for (const sourceId of conflict.sourceIds) {
        if (!SUPPLIED_SOURCE_IDS.has(sourceId)) unsupported.push(sourceId);
      }
    }

    expect(unsupported).toEqual([]);
    // The brief actually cites something — an empty-but-technically-valid
    // brief would pass the check above for the wrong reason.
    expect(brief.keyFindings.length).toBeGreaterThan(0);
    expect(brief.citations.length).toBeGreaterThan(0);
  });

  test("never cites a source id absent from the workflow input", async () => {
    const host = createHost();
    await host.runner.start({
      workflowId: "research-analysis",
      input: {
        question: "Is a made-up source ever cited?",
        sources: [
          { id: "only-real-source", title: "Real", content: "This is the only real source, stated plainly." },
        ],
      },
    });

    const brief = researchBriefSchema.parse(
      await loadPayload(host, ARTIFACT_IDS.researchBrief),
    );

    const allCitedIds = new Set([
      ...brief.keyFindings.flatMap((finding) => finding.sourceIds),
      ...brief.citations.map((citation) => citation.sourceId),
      ...brief.conflicts.flatMap((conflict) => conflict.sourceIds),
    ]);

    expect(allCitedIds.has("real-source-id-that-was-never-supplied")).toBe(false);
    for (const id of allCitedIds) {
      expect(id).toBe("only-real-source");
    }
  });
});

// ── 4. Artifact lineage exists ──────────────────────────────────

describe("artifact lineage", () => {
  test("links the research brief back to the source inventory", async () => {
    const host = createHost();
    await host.runner.start({
      workflowId: "research-analysis",
      input: SAMPLE_RESEARCH,
    });

    const lineage = await host.artifactStore.getLineage(
      ARTIFACT_IDS.researchBrief,
    );

    expect(lineage.ancestors).toContain(ARTIFACT_IDS.findingsSummary);
    expect(lineage.ancestors).toContain(ARTIFACT_IDS.comparisonMatrix);
    expect(lineage.ancestors).toContain(ARTIFACT_IDS.sourceInventory);
  });

  test("records which capability produced each artifact", async () => {
    const host = createHost();
    await host.runner.start({
      workflowId: "research-analysis",
      input: SAMPLE_RESEARCH,
    });

    const matrix = await host.artifactStore.getArtifact(
      ARTIFACT_IDS.comparisonMatrix,
    );

    expect(matrix?.provenance?.capabilityId).toBe("compare-findings");
    expect(matrix?.provenance?.workflowId).toBe("research-analysis");
  });
});

// ── 5. Second execution reuses unchanged artifacts ──────────────

describe("incremental re-run", () => {
  test("re-running unchanged sources changes no artifact version", async () => {
    const host = createHost({ incremental: true });

    const first = await host.runner.start({
      workflowId: "research-analysis",
      input: SAMPLE_RESEARCH,
    });

    const versionsAfterFirst = await Promise.all(
      Object.values(ARTIFACT_IDS).map(async (id) =>
        (await host.artifactStore.getArtifact(id))?.version,
      ),
    );

    await host.service.execute({
      workflowId: "research-analysis",
      input: SAMPLE_RESEARCH,
      metadata: incrementalMetadata(first.executionId, []),
    });

    const versionsAfterSecond = await Promise.all(
      Object.values(ARTIFACT_IDS).map(async (id) =>
        (await host.artifactStore.getArtifact(id))?.version,
      ),
    );

    expect(versionsAfterSecond).toEqual(versionsAfterFirst);
    expect(versionsAfterSecond.every((version) => version === 1)).toBe(true);
  });

  test("skips every node when nothing changed", async () => {
    const host = createHost({ incremental: true });

    const first = await host.runner.start({
      workflowId: "research-analysis",
      input: SAMPLE_RESEARCH,
    });

    host.events.length = 0;

    await host.service.execute({
      workflowId: "research-analysis",
      input: SAMPLE_RESEARCH,
      metadata: incrementalMetadata(first.executionId, []),
    });

    const plan = host.events.find(
      (event) => event.type === "execution.plan_created",
    );

    expect(plan?.payload?.executionNodes).toEqual([]);
    expect(plan?.payload?.skippedNodes).toHaveLength(5);
    expect(capabilitiesRun(host)).toEqual([]);
  });

  test("a claims change regenerates only what depends on it", async () => {
    const host = createHost({ incremental: true });

    const first = await host.runner.start({
      workflowId: "research-analysis",
      input: SAMPLE_RESEARCH,
    });

    host.events.length = 0;

    await host.service.execute({
      workflowId: "research-analysis",
      input: SAMPLE_RESEARCH,
      metadata: incrementalMetadata(first.executionId, [
        ARTIFACT_IDS.extractedClaims,
      ]),
    });

    const plan = host.events.find(
      (event) => event.type === "execution.plan_created",
    );

    expect(plan?.payload?.executionNodes).toEqual([
      "extract-claims",
      "compare-findings",
      "summarize-findings",
      "produce-research-brief",
    ]);
    expect(plan?.payload?.skippedNodes).toEqual(["normalize-research-question"]);
  });
});

// ── 6. Approval gate pauses and resumes execution ───────────────

describe("approval gate", () => {
  test("pauses before producing the research brief", async () => {
    const host = createHost({ policy: researchAnalysisApprovalPolicy });

    const execution = await host.runner.start({
      workflowId: "research-analysis",
      input: SAMPLE_RESEARCH,
    });

    expect(execution.state).toBe("needs_approval");

    const pending = await host.runner.pendingApproval(execution.executionId);
    expect(pending?.reason).toContain("Final cited output presented to the requester");

    // Nothing ran: the gate is evaluated before the workflow starts.
    expect(capabilitiesRun(host)).toEqual([]);
  });

  test("resumes and completes once approved", async () => {
    const host = createHost({ policy: researchAnalysisApprovalPolicy });

    const execution = await host.runner.start({
      workflowId: "research-analysis",
      input: SAMPLE_RESEARCH,
    });

    const outcome = await host.runner.approve(
      execution.executionId,
      "reviewed the brief",
    );

    expect(outcome.decision).toBe("approve");
    expect(outcome.state).toBe("ready");
    expect(capabilitiesRun(host)).toEqual([
      "normalize-research-question",
      "extract-claims",
      "compare-findings",
      "summarize-findings",
      "produce-research-brief",
    ]);

    const brief = researchBriefSchema.parse(
      await loadPayload(host, ARTIFACT_IDS.researchBrief),
    );
    expect(brief.keyFindings.length).toBeGreaterThan(0);
  });

  test("stops the workflow when rejected", async () => {
    const host = createHost({ policy: researchAnalysisApprovalPolicy });

    const execution = await host.runner.start({
      workflowId: "research-analysis",
      input: SAMPLE_RESEARCH,
    });

    const outcome = await host.runner.reject(execution.executionId, "not yet");

    expect(outcome.decision).toBe("reject");
    expect(outcome.state).toBe("failed");
    expect(capabilitiesRun(host)).toEqual([]);
    expect(
      await host.artifactStore.getArtifact(ARTIFACT_IDS.researchBrief),
    ).toBeNull();
  });

  test("runs straight through when no policy is configured", async () => {
    const host = createHost();

    const execution = await host.runner.start({
      workflowId: "research-analysis",
      input: SAMPLE_RESEARCH,
    });

    expect(execution.state).toBe("ready");
  });
});

// ── 7. Product layer can launch the workflow ─────────────────────

describe("product integration", () => {
  test("launches through the runner without engine plumbing", async () => {
    const host = createHost();

    const execution = await host.runner.start({
      workflowId: "research-analysis",
      input: SAMPLE_RESEARCH,
    });

    expect(execution.workflowName).toBe("Research Analysis");
    expect(execution.workflowId).toBe("research-analysis");
  });

  test("reports progress as a readable checklist", async () => {
    const host = createHost();

    const execution = await host.runner.start({
      workflowId: "research-analysis",
      input: SAMPLE_RESEARCH,
    });

    const progress = await host.runner.progress(execution.executionId);

    expect(progress.total).toBe(5);
    expect(progress.completed).toBe(5);
    expect(progress.percent).toBe(100);
    expect(progress.steps.map((step) => step.label)).toEqual([
      "Normalize research question",
      "Extract claims",
      "Compare findings",
      "Summarize findings",
      "Produce research brief",
    ]);
  });

  test("lists the run in the workflow's history", async () => {
    const host = createHost();

    await host.runner.start({
      workflowId: "research-analysis",
      input: SAMPLE_RESEARCH,
    });

    const history = await host.runner.history("research-analysis");

    expect(history).toHaveLength(1);
    expect(history[0]?.state).toBe("ready");
    expect(history[0]?.summary).toContain("Research Analysis finished");
  });
});
