// workflows/workflow-product-brief/src/capabilities/index.test.ts
import { describe, expect, test } from "bun:test";
import { InMemoryArtifactStore } from "@designflow/core";
import type { CapabilityContext, ArtifactRef, Logger } from "@designflow/sdk";
import {
  assessRisksCapability,
  defineAcceptanceCriteriaCapability,
  defineRequirementsCapability,
  defineScopeCapability,
  normalizeProductRequestCapability,
  produceProductBriefCapability,
} from "./index";
import {
  ARTIFACT_IDS,
  acceptanceCriteriaSchema,
  problemStatementSchema,
  productBriefSchema,
  requirementsSchema,
  riskAssumptionRegisterSchema,
  scopeDefinitionSchema,
} from "../types";
import { SAMPLE_REQUEST } from "../../test/support/harness";

/**
 * Unit tests for each capability, exercised directly against `execute` rather
 * than through the engine. Each test builds only the upstream artifacts a
 * capability actually reads, which is what proves a node depends on the
 * artifact store and not on anything another node passed it in memory.
 */

const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

function makeContext(
  store: InMemoryArtifactStore,
  capabilityId: string,
  parentArtifacts: readonly ArtifactRef[],
  input: unknown,
): CapabilityContext {
  return {
    executionId: "exec-test",
    workflowId: "product-brief",
    capabilityId,
    logger: silentLogger,
    artifactRefs: [],
    parentArtifacts,
    artifactStore: store,
    config: { input },
    signal: new AbortController().signal,
  };
}

async function loadPayload(
  store: InMemoryArtifactStore,
  ref: ArtifactRef,
): Promise<unknown> {
  const payloadId = ref.metadata.payloadId;
  if (typeof payloadId !== "string") {
    throw new Error("artifact reference carries no payloadId");
  }

  const loaded = await store.get(payloadId);
  if (loaded === null) throw new Error("payload not found");

  return loaded.data;
}

// ── 1. Normalize Product Request ─────────────────────────────────

describe("normalize-product-request", () => {
  test("pulls the problem statement from the input fields verbatim", async () => {
    const store = new InMemoryArtifactStore();
    const context = makeContext(
      store,
      "normalize-product-request",
      [],
      SAMPLE_REQUEST,
    );

    const output = await normalizeProductRequestCapability.execute(
      context,
      SAMPLE_REQUEST,
    );
    const statement = problemStatementSchema.parse(
      await loadPayload(store, output.artifactRef),
    );

    expect(statement.targetUser).toBe(SAMPLE_REQUEST.targetUser);
    expect(statement.motivation).toBe(SAMPLE_REQUEST.whyItMatters);
    expect(statement.problem).toBe(SAMPLE_REQUEST.productRequest);
    expect(statement.requestLines).toHaveLength(4);
    expect(statement.requestLines[0]).toContain("reset their password");
  });

  test("drops blank lines from the request text", async () => {
    const store = new InMemoryArtifactStore();
    const withBlankLines = {
      ...SAMPLE_REQUEST,
      productRequest: "First ask\n\n   \nSecond ask\n",
    };
    const context = makeContext(
      store,
      "normalize-product-request",
      [],
      withBlankLines,
    );

    const output = await normalizeProductRequestCapability.execute(
      context,
      withBlankLines,
    );
    const statement = problemStatementSchema.parse(
      await loadPayload(store, output.artifactRef),
    );

    expect(statement.requestLines).toEqual(["First ask", "Second ask"]);
  });
});

// ── 2. Define Scope ───────────────────────────────────────────────

describe("define-scope", () => {
  async function normalize(
    store: InMemoryArtifactStore,
    input: typeof SAMPLE_REQUEST,
  ): Promise<ArtifactRef> {
    const context = makeContext(store, "normalize-product-request", [], input);
    const output = await normalizeProductRequestCapability.execute(
      context,
      input,
    );
    return output.artifactRef;
  }

  test("falls back to the request lines when no explicit scope is given", async () => {
    const store = new InMemoryArtifactStore();
    const statementRef = await normalize(store, SAMPLE_REQUEST);

    const context = makeContext(
      store,
      "define-scope",
      [statementRef],
      SAMPLE_REQUEST,
    );
    const output = await defineScopeCapability.execute(context);
    const scope = scopeDefinitionSchema.parse(
      await loadPayload(store, output.artifactRef),
    );

    expect(scope.inScope).toHaveLength(4);
    expect(scope.outOfScope).toEqual(["Social login providers"]);
  });

  test("prefers an explicit desiredOutputScope over the request lines", async () => {
    const store = new InMemoryArtifactStore();
    const input = {
      ...SAMPLE_REQUEST,
      desiredOutputScope: ["Only ship password reset"],
    };
    const statementRef = await normalize(store, input);

    const context = makeContext(store, "define-scope", [statementRef], input);
    const output = await defineScopeCapability.execute(context);
    const scope = scopeDefinitionSchema.parse(
      await loadPayload(store, output.artifactRef),
    );

    expect(scope.inScope).toEqual(["Only ship password reset"]);
  });
});

// ── 3. Define Requirements ───────────────────────────────────────

describe("define-requirements", () => {
  async function buildScope(
    store: InMemoryArtifactStore,
  ): Promise<ArtifactRef> {
    const normalizeContext = makeContext(
      store,
      "normalize-product-request",
      [],
      SAMPLE_REQUEST,
    );
    const statementOutput = await normalizeProductRequestCapability.execute(
      normalizeContext,
      SAMPLE_REQUEST,
    );

    const scopeContext = makeContext(
      store,
      "define-scope",
      [statementOutput.artifactRef],
      SAMPLE_REQUEST,
    );
    const scopeOutput = await defineScopeCapability.execute(scopeContext);
    return scopeOutput.artifactRef;
  }

  test("derives one requirement per in-scope item, with stable ids", async () => {
    const store = new InMemoryArtifactStore();
    const scopeRef = await buildScope(store);

    const context = makeContext(
      store,
      "define-requirements",
      [scopeRef],
      SAMPLE_REQUEST,
    );
    const output = await defineRequirementsCapability.execute(context);
    const requirements = requirementsSchema.parse(
      await loadPayload(store, output.artifactRef),
    );

    expect(requirements.items).toHaveLength(4);
    expect(requirements.items.map((item) => item.id)).toEqual([
      "req-1",
      "req-2",
      "req-3",
      "req-4",
    ]);
  });

  test("assigns priority from must/should/nice-to-have wording, defaulting to medium", async () => {
    const store = new InMemoryArtifactStore();
    const scopeRef = await buildScope(store);

    const context = makeContext(
      store,
      "define-requirements",
      [scopeRef],
      SAMPLE_REQUEST,
    );
    const output = await defineRequirementsCapability.execute(context);
    const requirements = requirementsSchema.parse(
      await loadPayload(store, output.artifactRef),
    );

    const byDescription = (fragment: string) =>
      requirements.items.find((item) => item.description.includes(fragment));

    expect(byDescription("must be able to reset")?.priority).toBe("high");
    expect(byDescription("should add audit logging")?.priority).toBe("medium");
    expect(byDescription("nice to have a dark mode")?.priority).toBe("low");
    expect(byDescription("unclear whether guest users")?.priority).toBe(
      "medium",
    );
  });
});

// ── 4. Define Acceptance Criteria ────────────────────────────────

describe("define-acceptance-criteria", () => {
  async function buildRequirements(
    store: InMemoryArtifactStore,
  ): Promise<ArtifactRef> {
    const normalizeContext = makeContext(
      store,
      "normalize-product-request",
      [],
      SAMPLE_REQUEST,
    );
    const statementOutput = await normalizeProductRequestCapability.execute(
      normalizeContext,
      SAMPLE_REQUEST,
    );

    const scopeContext = makeContext(
      store,
      "define-scope",
      [statementOutput.artifactRef],
      SAMPLE_REQUEST,
    );
    const scopeOutput = await defineScopeCapability.execute(scopeContext);

    const requirementsContext = makeContext(
      store,
      "define-requirements",
      [scopeOutput.artifactRef],
      SAMPLE_REQUEST,
    );
    const requirementsOutput = await defineRequirementsCapability.execute(
      requirementsContext,
    );
    return requirementsOutput.artifactRef;
  }

  test("creates exactly one criterion per requirement, each linked to a real requirement id", async () => {
    const store = new InMemoryArtifactStore();
    const requirementsRef = await buildRequirements(store);
    const requirements = requirementsSchema.parse(
      await loadPayload(store, requirementsRef),
    );

    const context = makeContext(
      store,
      "define-acceptance-criteria",
      [requirementsRef],
      SAMPLE_REQUEST,
    );
    const output = await defineAcceptanceCriteriaCapability.execute(context);
    const criteria = acceptanceCriteriaSchema.parse(
      await loadPayload(store, output.artifactRef),
    );

    const requirementIds = new Set(requirements.items.map((item) => item.id));

    expect(criteria.items).toHaveLength(requirements.items.length);
    for (const criterion of criteria.items) {
      expect(requirementIds.has(criterion.requirementId)).toBe(true);
    }
  });

  test("every criterion is phrased as a measurable, verifiable check", async () => {
    const store = new InMemoryArtifactStore();
    const requirementsRef = await buildRequirements(store);

    const context = makeContext(
      store,
      "define-acceptance-criteria",
      [requirementsRef],
      SAMPLE_REQUEST,
    );
    const output = await defineAcceptanceCriteriaCapability.execute(context);
    const criteria = acceptanceCriteriaSchema.parse(
      await loadPayload(store, output.artifactRef),
    );

    for (const criterion of criteria.items) {
      expect(criterion.measurable).toBe(true);
      expect(criterion.description.toLowerCase()).toContain("verify");
    }
  });
});

// ── 5. Assess Risks ───────────────────────────────────────────────

describe("assess-risks", () => {
  async function buildRequirements(
    store: InMemoryArtifactStore,
  ): Promise<ArtifactRef> {
    const normalizeContext = makeContext(
      store,
      "normalize-product-request",
      [],
      SAMPLE_REQUEST,
    );
    const statementOutput = await normalizeProductRequestCapability.execute(
      normalizeContext,
      SAMPLE_REQUEST,
    );

    const scopeContext = makeContext(
      store,
      "define-scope",
      [statementOutput.artifactRef],
      SAMPLE_REQUEST,
    );
    const scopeOutput = await defineScopeCapability.execute(scopeContext);

    const requirementsContext = makeContext(
      store,
      "define-requirements",
      [scopeOutput.artifactRef],
      SAMPLE_REQUEST,
    );
    const requirementsOutput = await defineRequirementsCapability.execute(
      requirementsContext,
    );
    return requirementsOutput.artifactRef;
  }

  test("flags a requirement containing hedging language as a risk", async () => {
    const store = new InMemoryArtifactStore();
    const requirementsRef = await buildRequirements(store);

    const context = makeContext(
      store,
      "assess-risks",
      [requirementsRef],
      SAMPLE_REQUEST,
    );
    const output = await assessRisksCapability.execute(context);
    const register = riskAssumptionRegisterSchema.parse(
      await loadPayload(store, output.artifactRef),
    );

    const risks = register.items.filter((item) => item.kind === "risk");
    expect(risks).toHaveLength(1);
    expect(risks[0]?.description).toContain("unclear");
  });

  test("flags a hedged constraint as an assumption", async () => {
    const store = new InMemoryArtifactStore();
    const requirementsRef = await buildRequirements(store);

    const context = makeContext(
      store,
      "assess-risks",
      [requirementsRef],
      SAMPLE_REQUEST,
    );
    const output = await assessRisksCapability.execute(context);
    const register = riskAssumptionRegisterSchema.parse(
      await loadPayload(store, output.artifactRef),
    );

    const assumptions = register.items.filter(
      (item) => item.kind === "assumption",
    );
    expect(assumptions).toHaveLength(1);
    expect(assumptions[0]?.source).toBe("Scope may expand after v1");
  });

  test("records an assumption when no constraints are supplied at all", async () => {
    const store = new InMemoryArtifactStore();
    const input = { ...SAMPLE_REQUEST, constraints: [] };

    const normalizeContext = makeContext(
      store,
      "normalize-product-request",
      [],
      input,
    );
    const statementOutput = await normalizeProductRequestCapability.execute(
      normalizeContext,
      input,
    );
    const scopeContext = makeContext(
      store,
      "define-scope",
      [statementOutput.artifactRef],
      input,
    );
    const scopeOutput = await defineScopeCapability.execute(scopeContext);
    const requirementsContext = makeContext(
      store,
      "define-requirements",
      [scopeOutput.artifactRef],
      input,
    );
    const requirementsOutput = await defineRequirementsCapability.execute(
      requirementsContext,
    );

    const context = makeContext(
      store,
      "assess-risks",
      [requirementsOutput.artifactRef],
      input,
    );
    const output = await assessRisksCapability.execute(context);
    const register = riskAssumptionRegisterSchema.parse(
      await loadPayload(store, output.artifactRef),
    );

    expect(
      register.items.some((item) => item.id === "assumption-no-constraints"),
    ).toBe(true);
  });
});

// ── 6. Produce Product Brief ─────────────────────────────────────

describe("produce-product-brief", () => {
  test("assembles the problem statement, scope, requirements, criteria and risks into one document", async () => {
    const store = new InMemoryArtifactStore();

    const normalizeContext = makeContext(
      store,
      "normalize-product-request",
      [],
      SAMPLE_REQUEST,
    );
    const statementOutput = await normalizeProductRequestCapability.execute(
      normalizeContext,
      SAMPLE_REQUEST,
    );

    const scopeContext = makeContext(
      store,
      "define-scope",
      [statementOutput.artifactRef],
      SAMPLE_REQUEST,
    );
    const scopeOutput = await defineScopeCapability.execute(scopeContext);

    const requirementsContext = makeContext(
      store,
      "define-requirements",
      [scopeOutput.artifactRef],
      SAMPLE_REQUEST,
    );
    const requirementsOutput = await defineRequirementsCapability.execute(
      requirementsContext,
    );

    const acceptanceContext = makeContext(
      store,
      "define-acceptance-criteria",
      [requirementsOutput.artifactRef],
      SAMPLE_REQUEST,
    );
    const acceptanceOutput = await defineAcceptanceCriteriaCapability.execute(
      acceptanceContext,
    );

    const risksContext = makeContext(
      store,
      "assess-risks",
      [requirementsOutput.artifactRef],
      SAMPLE_REQUEST,
    );
    const risksOutput = await assessRisksCapability.execute(risksContext);

    const briefContext = makeContext(
      store,
      "produce-product-brief",
      [
        statementOutput.artifactRef,
        scopeOutput.artifactRef,
        requirementsOutput.artifactRef,
        acceptanceOutput.artifactRef,
        risksOutput.artifactRef,
      ],
      SAMPLE_REQUEST,
    );
    const briefOutput = await produceProductBriefCapability.execute(
      briefContext,
    );
    const brief = productBriefSchema.parse(
      await loadPayload(store, briefOutput.artifactRef),
    );

    expect(brief.problemStatement.targetUser).toBe(SAMPLE_REQUEST.targetUser);
    expect(brief.requirements.items).toHaveLength(4);
    expect(brief.acceptanceCriteria.items).toHaveLength(4);
    expect(brief.risks.items.length).toBeGreaterThan(0);
    expect(briefOutput.artifactRef.id).toBe(ARTIFACT_IDS.productBrief);
  });
});
