// workflows/workflow-qa-review/src/index.test.ts
import { describe, expect, test } from "bun:test";
import { workflowDefinitionSchema } from "@designflow/sdk";
import { qaReviewWorkflowPackage } from "./manifest";
import { qaReviewApprovalPolicy, qaReviewWorkflow } from "./workflow";
import {
  ARTIFACT_IDS,
  accessibilityReviewSchema,
  issueListSchema,
  qaReportSchema,
  reviewTargetSummarySchema,
  severityAssessmentSchema,
} from "./types";
import {
  SAMPLE_TARGET,
  createHost,
  incrementalMetadata,
  type QaReviewHost,
} from "./harness.test-support";

// ── Helpers ─────────────────────────────────────────────────────

/** Loads the payload a logical artifact points at. */
const loadPayload = async (
  host: QaReviewHost,
  artifactId: string,
): Promise<unknown> => {
  const artifact = await host.artifactStore.getArtifact(artifactId);
  if (artifact === null) return null;

  const payloadId = artifact.metadata.payloadId;
  if (typeof payloadId !== "string") return null;

  return (await host.artifactStore.get(payloadId))?.data ?? null;
};

const capabilitiesRun = (host: QaReviewHost): string[] =>
  host.events
    .filter((event) => event.type === "capability.completed")
    .map((event) => String(event.payload?.capabilityId));

// ── 1. Workflow definition loads ────────────────────────────────

describe("workflow definition", () => {
  test("parses against the SDK schema", () => {
    const parsed = workflowDefinitionSchema.parse(qaReviewWorkflow);

    expect(parsed.id).toBe("qa-review");
    expect(parsed.name).toBe("QA Review");
    expect(parsed.nodes).toHaveLength(5);
  });

  test("declares the artifact each node produces", () => {
    const produced = qaReviewWorkflow.nodes.flatMap(
      (node) => node.produces ?? [],
    );

    expect(produced).toEqual([
      ARTIFACT_IDS.reviewTargetSummary,
      ARTIFACT_IDS.issueList,
      ARTIFACT_IDS.severityAssessment,
      ARTIFACT_IDS.accessibilityReview,
      ARTIFACT_IDS.qaReport,
    ]);
  });

  test("registers its capabilities through the manifest", () => {
    const registered: string[] = [];

    qaReviewWorkflowPackage.load({
      register: (capability) => {
        registered.push(capability.id);
      },
      registerPackage: () => {},
    });

    expect(registered).toEqual([
      "collect-review-target",
      "evaluate-correctness",
      "assess-severity",
      "evaluate-accessibility",
      "produce-qa-report",
    ]);
    expect(qaReviewWorkflowPackage.capabilities).toEqual(registered);
  });

  test("gates the report-publishing capability", () => {
    expect(qaReviewApprovalPolicy.rules[0]).toMatchObject({
      type: "require_approval",
      target: "produce-qa-report",
    });
  });
});

// ── 2. Full execution produces expected artifacts ───────────────

describe("full execution", () => {
  test("reviews a target and publishes a report", async () => {
    const host = createHost();

    const execution = await host.runner.start({
      workflowId: "qa-review",
      input: SAMPLE_TARGET,
    });

    expect(execution.state).toBe("ready");
    expect(capabilitiesRun(host)).toEqual([
      "collect-review-target",
      "evaluate-correctness",
      "assess-severity",
      "evaluate-accessibility",
      "produce-qa-report",
    ]);
  });

  test("produces every declared artifact", async () => {
    const host = createHost();
    await host.runner.start({
      workflowId: "qa-review",
      input: SAMPLE_TARGET,
    });

    for (const artifactId of Object.values(ARTIFACT_IDS)) {
      expect(await host.artifactStore.getArtifact(artifactId)).not.toBeNull();
    }
  });

  test("normalizes the review target summary", async () => {
    const host = createHost();
    await host.runner.start({
      workflowId: "qa-review",
      input: SAMPLE_TARGET,
    });

    const summary = reviewTargetSummarySchema.parse(
      await loadPayload(host, ARTIFACT_IDS.reviewTargetSummary),
    );

    expect(summary.itemCount).toBe(3);
    expect(summary.kinds).toEqual(["component"]);
    expect(summary.missingContentPaths).toEqual([
      "src/components/CheckoutForm.tsx",
    ]);
  });

  test("flags the item missing implementation content", async () => {
    const host = createHost();
    await host.runner.start({
      workflowId: "qa-review",
      input: SAMPLE_TARGET,
    });

    const issueList = issueListSchema.parse(
      await loadPayload(host, ARTIFACT_IDS.issueList),
    );

    expect(issueList.issues).toHaveLength(1);
    expect(issueList.issues[0]).toMatchObject({
      kind: "completeness",
      location: "src/components/CheckoutForm.tsx",
    });
  });

  test("assesses the missing-content issue as a blocker above the threshold", async () => {
    const host = createHost();
    await host.runner.start({
      workflowId: "qa-review",
      input: SAMPLE_TARGET,
    });

    const assessment = severityAssessmentSchema.parse(
      await loadPayload(host, ARTIFACT_IDS.severityAssessment),
    );

    expect(assessment.threshold).toBe("minor");
    expect(assessment.counts).toEqual({ blocker: 1, major: 0, minor: 0, info: 0 });
    expect(assessment.flaggedIssueIds).toEqual([
      "completeness:src/components/CheckoutForm.tsx",
    ]);
  });

  test("finds aria, contrast, keyboard, and semantics gaps", async () => {
    const host = createHost();
    await host.runner.start({
      workflowId: "qa-review",
      input: SAMPLE_TARGET,
    });

    const review = accessibilityReviewSchema.parse(
      await loadPayload(host, ARTIFACT_IDS.accessibilityReview),
    );

    expect(review.counts).toEqual({ aria: 1, contrast: 1, keyboard: 1, semantics: 1 });
    expect(review.findings.map((finding) => finding.category)).toEqual([
      "aria",
      "contrast",
      "keyboard",
      "semantics",
    ]);
  });

  test("publishes a failing verdict when flagged issues exist", async () => {
    const host = createHost();
    await host.runner.start({
      workflowId: "qa-review",
      input: SAMPLE_TARGET,
    });

    const report = qaReportSchema.parse(
      await loadPayload(host, ARTIFACT_IDS.qaReport),
    );

    expect(report.targetId).toBe("checkout-flow");
    expect(report.verdict).toBe("fail");
    expect(report.issueCount).toBe(1);
    expect(report.flaggedIssueCount).toBe(1);
    expect(report.accessibilityFindingCount).toBe(4);
  });

  test("publishes a passing verdict for a clean target", async () => {
    const host = createHost();
    await host.runner.start({
      workflowId: "qa-review",
      input: {
        id: "clean-flow",
        description: "A tidy implementation",
        items: [
          {
            path: "src/components/Clean.tsx",
            kind: "component",
            content: "<section>Nothing interactive here</section>",
          },
        ],
      },
    });

    const report = qaReportSchema.parse(
      await loadPayload(host, ARTIFACT_IDS.qaReport),
    );

    expect(report.verdict).toBe("pass");
    expect(report.issueCount).toBe(0);
    expect(report.flaggedIssueCount).toBe(0);
    expect(report.accessibilityFindingCount).toBe(0);
  });

  test("passes data only through artifacts", async () => {
    const host = createHost();
    await host.runner.start({
      workflowId: "qa-review",
      input: SAMPLE_TARGET,
    });

    // produce-qa-report never received the assessment or the review as
    // arguments — it loaded both from the artifact store.
    const report = qaReportSchema.parse(
      await loadPayload(host, ARTIFACT_IDS.qaReport),
    );
    expect(report.severityCounts).toEqual({ blocker: 1, major: 0, minor: 0, info: 0 });
    expect(report.accessibilityCounts).toEqual({
      aria: 1,
      contrast: 1,
      keyboard: 1,
      semantics: 1,
    });
  });
});

// ── 3. Artifact lineage exists ──────────────────────────────────

describe("artifact lineage", () => {
  test("links each artifact to the ones it was built from", async () => {
    const host = createHost();
    await host.runner.start({
      workflowId: "qa-review",
      input: SAMPLE_TARGET,
    });

    const lineage = await host.artifactStore.getLineage(ARTIFACT_IDS.qaReport);

    expect(lineage.ancestors).toContain(ARTIFACT_IDS.severityAssessment);
    expect(lineage.ancestors).toContain(ARTIFACT_IDS.accessibilityReview);
    expect(lineage.ancestors).toContain(ARTIFACT_IDS.reviewTargetSummary);
  });

  test("records which capability produced each artifact", async () => {
    const host = createHost();
    await host.runner.start({
      workflowId: "qa-review",
      input: SAMPLE_TARGET,
    });

    const assessment = await host.artifactStore.getArtifact(
      ARTIFACT_IDS.severityAssessment,
    );

    expect(assessment?.provenance?.capabilityId).toBe("assess-severity");
    expect(assessment?.provenance?.workflowId).toBe("qa-review");
  });

  test("walks forward from the review target to everything downstream", async () => {
    const host = createHost();
    await host.runner.start({
      workflowId: "qa-review",
      input: SAMPLE_TARGET,
    });

    const lineage = await host.artifactStore.getLineage(
      ARTIFACT_IDS.reviewTargetSummary,
    );

    expect(lineage.descendants).toContain(ARTIFACT_IDS.issueList);
    expect(lineage.descendants).toContain(ARTIFACT_IDS.qaReport);
  });
});

// ── 4. Second execution reuses unchanged artifacts ──────────────

describe("incremental re-run", () => {
  test("re-running an unchanged target changes no artifact version", async () => {
    const host = createHost({ incremental: true });

    const first = await host.runner.start({
      workflowId: "qa-review",
      input: SAMPLE_TARGET,
    });

    const versionsAfterFirst = await Promise.all(
      Object.values(ARTIFACT_IDS).map(async (id) =>
        (await host.artifactStore.getArtifact(id))?.version,
      ),
    );

    await host.service.execute({
      workflowId: "qa-review",
      input: SAMPLE_TARGET,
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
      workflowId: "qa-review",
      input: SAMPLE_TARGET,
    });

    host.events.length = 0;

    await host.service.execute({
      workflowId: "qa-review",
      input: SAMPLE_TARGET,
      metadata: incrementalMetadata(first.executionId, []),
    });

    const plan = host.events.find(
      (event) => event.type === "execution.plan_created",
    );

    expect(plan?.payload?.executionNodes).toEqual([]);
    expect(plan?.payload?.skippedNodes).toHaveLength(5);
    expect(capabilitiesRun(host)).toEqual([]);
  });

  test("a target change regenerates every node in the chain", async () => {
    const host = createHost({ incremental: true });

    const first = await host.runner.start({
      workflowId: "qa-review",
      input: SAMPLE_TARGET,
    });

    host.events.length = 0;

    await host.service.execute({
      workflowId: "qa-review",
      input: SAMPLE_TARGET,
      metadata: incrementalMetadata(first.executionId, [
        ARTIFACT_IDS.reviewTargetSummary,
      ]),
    });

    // The changed artifact is collect-review-target's own output, so it
    // reruns too, along with everything downstream of it.
    expect(capabilitiesRun(host)).toEqual([
      "collect-review-target",
      "evaluate-correctness",
      "assess-severity",
      "evaluate-accessibility",
      "produce-qa-report",
    ]);
  });
});

// ── 5. Approval pauses and resumes execution ─────────────────────

describe("approval gate", () => {
  test("pauses before publishing the report", async () => {
    const host = createHost({ policy: qaReviewApprovalPolicy });

    const execution = await host.runner.start({
      workflowId: "qa-review",
      input: SAMPLE_TARGET,
    });

    expect(execution.state).toBe("needs_approval");

    const pending = await host.runner.pendingApproval(execution.executionId);
    expect(pending?.reason).toContain("Publishing a verdict the team will act on");

    // Nothing ran: the gate is evaluated before the workflow starts.
    expect(capabilitiesRun(host)).toEqual([]);
  });

  test("resumes and completes once approved", async () => {
    const host = createHost({ policy: qaReviewApprovalPolicy });

    const execution = await host.runner.start({
      workflowId: "qa-review",
      input: SAMPLE_TARGET,
    });

    const outcome = await host.runner.approve(
      execution.executionId,
      "reviewed the findings",
    );

    expect(outcome.decision).toBe("approve");
    expect(outcome.state).toBe("ready");
    expect(capabilitiesRun(host)).toEqual([
      "collect-review-target",
      "evaluate-correctness",
      "assess-severity",
      "evaluate-accessibility",
      "produce-qa-report",
    ]);

    const report = qaReportSchema.parse(
      await loadPayload(host, ARTIFACT_IDS.qaReport),
    );
    expect(report.verdict).toBe("fail");
  });

  test("stops the workflow when rejected", async () => {
    const host = createHost({ policy: qaReviewApprovalPolicy });

    const execution = await host.runner.start({
      workflowId: "qa-review",
      input: SAMPLE_TARGET,
    });

    const outcome = await host.runner.reject(execution.executionId, "not yet");

    expect(outcome.decision).toBe("reject");
    expect(outcome.state).toBe("failed");
    expect(capabilitiesRun(host)).toEqual([]);
    expect(
      await host.artifactStore.getArtifact(ARTIFACT_IDS.qaReport),
    ).toBeNull();
  });

  test("runs straight through when no policy is configured", async () => {
    const host = createHost();

    const execution = await host.runner.start({
      workflowId: "qa-review",
      input: SAMPLE_TARGET,
    });

    expect(execution.state).toBe("ready");
  });
});

// ── 6. Product layer can launch the workflow ─────────────────────

describe("product integration", () => {
  test("launches through the runner without engine plumbing", async () => {
    const host = createHost();

    const execution = await host.runner.start({
      workflowId: "qa-review",
      input: SAMPLE_TARGET,
    });

    expect(execution.workflowName).toBe("QA Review");
    expect(execution.workflowId).toBe("qa-review");
  });

  test("reports progress as a readable checklist", async () => {
    const host = createHost();

    const execution = await host.runner.start({
      workflowId: "qa-review",
      input: SAMPLE_TARGET,
    });

    const progress = await host.runner.progress(execution.executionId);

    expect(progress.total).toBe(5);
    expect(progress.completed).toBe(5);
    expect(progress.percent).toBe(100);
    expect(progress.steps.map((step) => step.label)).toEqual([
      "Collect review target",
      "Evaluate correctness",
      "Assess severity",
      "Evaluate accessibility",
      "Produce qa report",
    ]);
  });

  test("lists the run in the workflow's history", async () => {
    const host = createHost();

    await host.runner.start({
      workflowId: "qa-review",
      input: SAMPLE_TARGET,
    });

    const history = await host.runner.history("qa-review");

    expect(history).toHaveLength(1);
    expect(history[0]?.state).toBe("ready");
    expect(history[0]?.summary).toContain("QA Review finished");
  });
});
