// workflows/workflow-product-brief/src/index.test.ts
import { describe, expect, test } from "bun:test";
import { workflowDefinitionSchema } from "@designflow/sdk";
import { productBriefWorkflowPackage } from "./manifest";
import { productBriefApprovalPolicy, productBriefWorkflow } from "./workflow";
import {
  ARTIFACT_IDS,
  acceptanceCriteriaSchema,
  productBriefSchema,
  requirementsSchema,
  riskAssumptionRegisterSchema,
} from "./types";
import {
  SAMPLE_REQUEST,
  createHost,
  type ProductBriefHost,
} from "./harness.test-support";

// ── Helpers ─────────────────────────────────────────────────────

/** Loads the payload a logical artifact points at. */
const loadPayload = async (
  host: ProductBriefHost,
  artifactId: string,
): Promise<unknown> => {
  const artifact = await host.artifactStore.getArtifact(artifactId);
  if (artifact === null) return null;

  const payloadId = artifact.metadata.payloadId;
  if (typeof payloadId !== "string") return null;

  return (await host.artifactStore.get(payloadId))?.data ?? null;
};

const capabilitiesRun = (host: ProductBriefHost): string[] =>
  host.events
    .filter((event) => event.type === "capability.completed")
    .map((event) => String(event.payload?.capabilityId));

const EXPECTED_CAPABILITY_ORDER = [
  "normalize-product-request",
  "define-scope",
  "define-requirements",
  "define-acceptance-criteria",
  "assess-risks",
  "produce-product-brief",
];

// ── 1. Workflow definition loads ────────────────────────────────

describe("workflow definition", () => {
  test("parses against the SDK schema", () => {
    const parsed = workflowDefinitionSchema.parse(productBriefWorkflow);

    expect(parsed.id).toBe("product-brief");
    expect(parsed.name).toBe("Product Brief");
    expect(parsed.nodes).toHaveLength(6);
  });

  test("declares the artifact each node produces", () => {
    const produced = productBriefWorkflow.nodes.flatMap(
      (node) => node.produces ?? [],
    );

    expect(produced).toEqual([
      ARTIFACT_IDS.problemStatement,
      ARTIFACT_IDS.scopeDefinition,
      ARTIFACT_IDS.requirements,
      ARTIFACT_IDS.acceptanceCriteria,
      ARTIFACT_IDS.riskAssumptionRegister,
      ARTIFACT_IDS.productBrief,
    ]);
  });

  test("registers its capabilities through the manifest", () => {
    const registered: string[] = [];

    productBriefWorkflowPackage.load({
      register: (capability) => {
        registered.push(capability.id);
      },
      registerPackage: () => {},
    });

    expect(registered).toEqual(EXPECTED_CAPABILITY_ORDER);
    expect(productBriefWorkflowPackage.capabilities).toEqual(registered);
  });

  test("gates the final assembly step behind approval", () => {
    expect(productBriefApprovalPolicy.rules[0]).toMatchObject({
      type: "require_approval",
      target: "produce-product-brief",
    });
  });
});

// ── 2. Full execution produces expected artifacts ───────────────

describe("full execution", () => {
  test("turns a product request into a validated product brief", async () => {
    const host = createHost();

    const execution = await host.runner.start({
      workflowId: "product-brief",
      input: SAMPLE_REQUEST,
    });

    expect(execution.state).toBe("ready");
    expect(capabilitiesRun(host)).toEqual(EXPECTED_CAPABILITY_ORDER);
  });

  test("produces every declared artifact", async () => {
    const host = createHost();
    await host.runner.start({
      workflowId: "product-brief",
      input: SAMPLE_REQUEST,
    });

    for (const artifactId of Object.values(ARTIFACT_IDS)) {
      expect(await host.artifactStore.getArtifact(artifactId)).not.toBeNull();
    }
  });

  test("derives one requirement per in-scope request line", async () => {
    const host = createHost();
    await host.runner.start({
      workflowId: "product-brief",
      input: SAMPLE_REQUEST,
    });

    const requirements = requirementsSchema.parse(
      await loadPayload(host, ARTIFACT_IDS.requirements),
    );

    expect(requirements.items).toHaveLength(4);
    expect(requirements.items.map((item) => item.priority)).toContain("high");
  });

  test("every acceptance criterion links back to a real requirement id", async () => {
    const host = createHost();
    await host.runner.start({
      workflowId: "product-brief",
      input: SAMPLE_REQUEST,
    });

    const requirements = requirementsSchema.parse(
      await loadPayload(host, ARTIFACT_IDS.requirements),
    );
    const criteria = acceptanceCriteriaSchema.parse(
      await loadPayload(host, ARTIFACT_IDS.acceptanceCriteria),
    );

    const requirementIds = new Set(requirements.items.map((item) => item.id));

    expect(criteria.items.length).toBeGreaterThan(0);
    for (const criterion of criteria.items) {
      expect(requirementIds.has(criterion.requirementId)).toBe(true);
      expect(criterion.measurable).toBe(true);
    }
  });

  test("flags hedging language deterministically in the risk register", async () => {
    const host = createHost();
    await host.runner.start({
      workflowId: "product-brief",
      input: SAMPLE_REQUEST,
    });

    const register = riskAssumptionRegisterSchema.parse(
      await loadPayload(host, ARTIFACT_IDS.riskAssumptionRegister),
    );

    expect(register.items.some((item) => item.kind === "risk")).toBe(true);
    expect(register.items.some((item) => item.kind === "assumption")).toBe(
      true,
    );
  });

  test("assembles the final brief from every upstream artifact", async () => {
    const host = createHost();
    await host.runner.start({
      workflowId: "product-brief",
      input: SAMPLE_REQUEST,
    });

    const brief = productBriefSchema.parse(
      await loadPayload(host, ARTIFACT_IDS.productBrief),
    );

    expect(brief.problemStatement.targetUser).toBe(SAMPLE_REQUEST.targetUser);
    expect(brief.scope.outOfScope).toEqual(["Social login providers"]);
    expect(brief.requirements.items).toHaveLength(4);
    expect(brief.acceptanceCriteria.items).toHaveLength(4);
  });

  test("re-running the same request is fully deterministic", async () => {
    const hostA = createHost();
    const hostB = createHost();

    await hostA.runner.start({
      workflowId: "product-brief",
      input: SAMPLE_REQUEST,
    });
    await hostB.runner.start({
      workflowId: "product-brief",
      input: SAMPLE_REQUEST,
    });

    const briefA = await loadPayload(hostA, ARTIFACT_IDS.productBrief);
    const briefB = await loadPayload(hostB, ARTIFACT_IDS.productBrief);

    expect(briefA).toEqual(briefB);
  });
});

// ── 3. Artifact lineage exists ──────────────────────────────────

describe("artifact lineage", () => {
  test("links the final brief back to every artifact it was built from", async () => {
    const host = createHost();
    await host.runner.start({
      workflowId: "product-brief",
      input: SAMPLE_REQUEST,
    });

    const lineage = await host.artifactStore.getLineage(
      ARTIFACT_IDS.productBrief,
    );

    expect(lineage.ancestors).toContain(ARTIFACT_IDS.problemStatement);
    expect(lineage.ancestors).toContain(ARTIFACT_IDS.scopeDefinition);
    expect(lineage.ancestors).toContain(ARTIFACT_IDS.requirements);
    expect(lineage.ancestors).toContain(ARTIFACT_IDS.acceptanceCriteria);
    expect(lineage.ancestors).toContain(ARTIFACT_IDS.riskAssumptionRegister);
  });

  test("records which capability produced each artifact", async () => {
    const host = createHost();
    await host.runner.start({
      workflowId: "product-brief",
      input: SAMPLE_REQUEST,
    });

    const requirements = await host.artifactStore.getArtifact(
      ARTIFACT_IDS.requirements,
    );

    expect(requirements?.provenance?.capabilityId).toBe("define-requirements");
    expect(requirements?.provenance?.workflowId).toBe("product-brief");
  });
});

// ── 4. Approval gate pauses and resumes execution ────────────────

describe("approval gate", () => {
  test("pauses before assembling the final brief", async () => {
    const host = createHost({ policy: productBriefApprovalPolicy });

    const execution = await host.runner.start({
      workflowId: "product-brief",
      input: SAMPLE_REQUEST,
    });

    expect(execution.state).toBe("needs_approval");

    const pending = await host.runner.pendingApproval(execution.executionId);
    expect(pending?.reason).toContain("Finalizing the brief that downstream planning will rely on");

    // Nothing ran: the gate is evaluated before the workflow starts.
    expect(capabilitiesRun(host)).toEqual([]);
  });

  test("resumes and completes once approved", async () => {
    const host = createHost({ policy: productBriefApprovalPolicy });

    const execution = await host.runner.start({
      workflowId: "product-brief",
      input: SAMPLE_REQUEST,
    });

    const outcome = await host.runner.approve(
      execution.executionId,
      "reviewed the brief",
    );

    expect(outcome.decision).toBe("approve");
    expect(outcome.state).toBe("ready");
    expect(capabilitiesRun(host)).toEqual(EXPECTED_CAPABILITY_ORDER);

    const brief = productBriefSchema.parse(
      await loadPayload(host, ARTIFACT_IDS.productBrief),
    );
    expect(brief.requirements.items).toHaveLength(4);
  });

  test("stops the workflow when rejected", async () => {
    const host = createHost({ policy: productBriefApprovalPolicy });

    const execution = await host.runner.start({
      workflowId: "product-brief",
      input: SAMPLE_REQUEST,
    });

    const outcome = await host.runner.reject(execution.executionId, "not yet");

    expect(outcome.decision).toBe("reject");
    expect(outcome.state).toBe("failed");
    expect(capabilitiesRun(host)).toEqual([]);
    expect(
      await host.artifactStore.getArtifact(ARTIFACT_IDS.productBrief),
    ).toBeNull();
  });

  test("runs straight through when no policy is configured", async () => {
    const host = createHost();

    const execution = await host.runner.start({
      workflowId: "product-brief",
      input: SAMPLE_REQUEST,
    });

    expect(execution.state).toBe("ready");
  });
});

// ── 5. Product layer can launch the workflow ────────────────────

describe("product integration", () => {
  test("launches through the runner without engine plumbing", async () => {
    const host = createHost();

    const execution = await host.runner.start({
      workflowId: "product-brief",
      input: SAMPLE_REQUEST,
    });

    expect(execution.workflowName).toBe("Product Brief");
    expect(execution.workflowId).toBe("product-brief");
  });

  test("reports progress as a readable checklist", async () => {
    const host = createHost();

    const execution = await host.runner.start({
      workflowId: "product-brief",
      input: SAMPLE_REQUEST,
    });

    const progress = await host.runner.progress(execution.executionId);

    expect(progress.total).toBe(6);
    expect(progress.completed).toBe(6);
    expect(progress.percent).toBe(100);
    expect(progress.steps.map((step) => step.label)).toEqual([
      "Normalize product request",
      "Define scope",
      "Define requirements",
      "Define acceptance criteria",
      "Assess risks",
      "Produce product brief",
    ]);
  });
});
