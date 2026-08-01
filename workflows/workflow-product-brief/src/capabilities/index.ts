// workflows/workflow-product-brief/src/capabilities/index.ts
import { z } from "zod";
import type { Capability, CapabilityContext } from "@designflow/sdk";
import {
  ARTIFACT_IDS,
  ARTIFACT_TYPES,
  acceptanceCriteriaSchema,
  capabilityOutputSchema,
  problemStatementSchema,
  productBriefInputSchema,
  productBriefSchema,
  requirementsSchema,
  riskAssumptionRegisterSchema,
  scopeDefinitionSchema,
} from "../types";
import type {
  AcceptanceCriteria,
  PriorityLevel,
  ProblemStatement,
  ProductBrief,
  Requirements,
  RiskAssumptionRegister,
  ScopeDefinition,
} from "../types";
import { readArtifact, writeArtifact } from "../artifact-io";
import type { CapabilityOutput } from "../types";

/**
 * The six capabilities of the Product Brief workflow.
 *
 * Every one of them is a **pure function of its inputs**. No timestamps, no
 * randomness, no ambient state. That is not incidental tidiness: artifact
 * versioning compares a re-emitted artifact's metadata against the previous
 * version, so a capability that varied its output run to run would report a
 * change every time and make incremental reuse impossible.
 *
 * All six are `type: "pure"` — the workflow only reads and reshapes its input,
 * it never writes anything outside the artifact store. The approval gate on
 * `produce-product-brief` is a policy concern, not a capability-type concern.
 */

/** Stable, order-independent list. Keeps derived output deterministic. */
function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

/** Non-empty, trimmed lines of free text, in their original order. */
function linesOf(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Hedging language that flags a line as ambiguous. Fixed vocabulary, not inferred. */
const HEDGE_WORDS = [
  "may",
  "might",
  "unclear",
  "tbd",
  "assume",
  "assumption",
  "possibly",
  "unknown",
  "maybe",
  "not sure",
] as const;

function findHedgeWord(text: string): string | undefined {
  const lower = text.toLowerCase();
  return HEDGE_WORDS.find((word) => new RegExp(`\\b${word}\\b`, "i").test(lower));
}

/** Rule-based priority from the requirement's own wording. Defaults to medium. */
function priorityOf(description: string): PriorityLevel {
  if (/\bmust\b/i.test(description)) return "high";
  if (/\b(could|nice to have|optional)\b/i.test(description)) return "low";
  if (/\bshould\b/i.test(description)) return "medium";
  return "medium";
}

function readWorkflowInput(context: CapabilityContext): unknown {
  return context.config.input;
}

/** The workflow's own input, re-parsed from execution config rather than passed between nodes. */
function readProductBriefInput(context: CapabilityContext) {
  return productBriefInputSchema.parse(readWorkflowInput(context));
}

// ── 1. Normalize Product Request ─────────────────────────────────

export const normalizeProductRequestCapability: Capability<unknown, CapabilityOutput> = {
  id: "normalize-product-request",
  name: "Normalize product request",
  description: "Turns a raw product request into a structured problem statement",
  type: "pure",
  inputSchema: productBriefInputSchema,
  outputSchema: capabilityOutputSchema,

  async execute(
    context: CapabilityContext,
    input: unknown,
  ): Promise<CapabilityOutput> {
    const parsed = productBriefInputSchema.parse(input);
    const requestLines = linesOf(parsed.productRequest);

    const statement: ProblemStatement = problemStatementSchema.parse({
      targetUser: parsed.targetUser,
      problem: parsed.productRequest.trim(),
      motivation: parsed.whyItMatters,
      requestLines,
    });

    return writeArtifact(context, {
      artifactId: ARTIFACT_IDS.problemStatement,
      artifactType: ARTIFACT_TYPES.problemStatement,
      name: "Problem statement",
      payload: statement,
      summary: {
        targetUser: statement.targetUser,
        requestLineCount: statement.requestLines.length,
      },
    });
  },
};

// ── 2. Define Scope ───────────────────────────────────────────────

export const defineScopeCapability: Capability<unknown, CapabilityOutput> = {
  id: "define-scope",
  name: "Define scope",
  description: "Derives in-scope and explicitly excluded items from the request",
  type: "pure",
  inputSchema: z.unknown(),
  outputSchema: capabilityOutputSchema,

  async execute(context: CapabilityContext): Promise<CapabilityOutput> {
    const statement = await readArtifact(
      context,
      ARTIFACT_IDS.problemStatement,
      problemStatementSchema,
    );
    const input = readProductBriefInput(context);

    // An explicit scope list wins; otherwise every ask in the request is
    // in scope by default, which keeps this step deterministic even when the
    // caller supplies no scope fields at all.
    const inScopeSource =
      input.desiredOutputScope.length > 0
        ? input.desiredOutputScope
        : statement.requestLines;

    const scope: ScopeDefinition = scopeDefinitionSchema.parse({
      inScope: sortedUnique(inScopeSource),
      outOfScope: sortedUnique(input.excludedScope),
    });

    return writeArtifact(context, {
      artifactId: ARTIFACT_IDS.scopeDefinition,
      artifactType: ARTIFACT_TYPES.scopeDefinition,
      name: "Scope definition",
      payload: scope,
      summary: {
        inScopeCount: scope.inScope.length,
        outOfScopeCount: scope.outOfScope.length,
      },
    });
  },
};

// ── 3. Define Requirements ───────────────────────────────────────

export const defineRequirementsCapability: Capability<unknown, CapabilityOutput> = {
  id: "define-requirements",
  name: "Define requirements",
  description: "Derives one requirement per in-scope item, with a rule-based priority",
  type: "pure",
  inputSchema: z.unknown(),
  outputSchema: capabilityOutputSchema,

  async execute(context: CapabilityContext): Promise<CapabilityOutput> {
    const scope = await readArtifact(
      context,
      ARTIFACT_IDS.scopeDefinition,
      scopeDefinitionSchema,
    );

    const requirements: Requirements = requirementsSchema.parse({
      items: scope.inScope.map((description, index) => ({
        id: `req-${index + 1}`,
        description,
        priority: priorityOf(description),
      })),
    });

    return writeArtifact(context, {
      artifactId: ARTIFACT_IDS.requirements,
      artifactType: ARTIFACT_TYPES.requirements,
      name: "Requirements",
      payload: requirements,
      summary: {
        requirementCount: requirements.items.length,
        requirementIds: requirements.items.map((item) => item.id),
      },
    });
  },
};

// ── 4. Define Acceptance Criteria ────────────────────────────────

export const defineAcceptanceCriteriaCapability: Capability<unknown, CapabilityOutput> = {
  id: "define-acceptance-criteria",
  name: "Define acceptance criteria",
  description: "Attaches a measurable acceptance criterion to every requirement",
  type: "pure",
  inputSchema: z.unknown(),
  outputSchema: capabilityOutputSchema,

  async execute(context: CapabilityContext): Promise<CapabilityOutput> {
    const requirements = await readArtifact(
      context,
      ARTIFACT_IDS.requirements,
      requirementsSchema,
    );

    const criteria: AcceptanceCriteria = acceptanceCriteriaSchema.parse({
      items: requirements.items.map((requirement, index) => ({
        id: `ac-${index + 1}`,
        requirementId: requirement.id,
        description: `Given requirement "${requirement.description}", verify it is implemented and observably satisfied`,
        measurable: true,
      })),
    });

    return writeArtifact(context, {
      artifactId: ARTIFACT_IDS.acceptanceCriteria,
      artifactType: ARTIFACT_TYPES.acceptanceCriteria,
      name: "Acceptance criteria",
      payload: criteria,
      summary: {
        criterionCount: criteria.items.length,
        requirementIds: sortedUnique(
          criteria.items.map((item) => item.requirementId),
        ),
      },
    });
  },
};

// ── 5. Assess Risks ───────────────────────────────────────────────

export const assessRisksCapability: Capability<unknown, CapabilityOutput> = {
  id: "assess-risks",
  name: "Assess risks",
  description: "Flags hedging language in requirements and constraints as risks and assumptions",
  type: "pure",
  inputSchema: z.unknown(),
  outputSchema: capabilityOutputSchema,

  async execute(context: CapabilityContext): Promise<CapabilityOutput> {
    const requirements = await readArtifact(
      context,
      ARTIFACT_IDS.requirements,
      requirementsSchema,
    );
    const input = readProductBriefInput(context);

    const riskItems = requirements.items
      .map((requirement) => ({
        requirement,
        hedge: findHedgeWord(requirement.description),
      }))
      .filter(
        (candidate): candidate is { requirement: (typeof requirements.items)[number]; hedge: string } =>
          candidate.hedge !== undefined,
      )
      .map((candidate, index) => ({
        id: `risk-${index + 1}`,
        kind: "risk" as const,
        description: `Requirement "${candidate.requirement.description}" contains ambiguous language ("${candidate.hedge}") and should be clarified`,
        source: candidate.requirement.id,
      }));

    const constraintAssumptions = input.constraints
      .map((constraint) => ({ constraint, hedge: findHedgeWord(constraint) }))
      .filter(
        (candidate): candidate is { constraint: string; hedge: string } =>
          candidate.hedge !== undefined,
      )
      .map((candidate, index) => ({
        id: `assumption-${index + 1}`,
        kind: "assumption" as const,
        description: `Constraint "${candidate.constraint}" is treated as an assumption pending confirmation`,
        source: candidate.constraint,
      }));

    // No constraints at all is itself worth recording as an assumption, so the
    // register is never silently empty just because the caller supplied none.
    const noConstraintsAssumption =
      input.constraints.length === 0
        ? [
            {
              id: "assumption-no-constraints",
              kind: "assumption" as const,
              description:
                "No constraints were supplied; the brief assumes none apply",
              source: "constraints",
            },
          ]
        : [];

    const register: RiskAssumptionRegister = riskAssumptionRegisterSchema.parse({
      items: [...riskItems, ...constraintAssumptions, ...noConstraintsAssumption],
    });

    return writeArtifact(context, {
      artifactId: ARTIFACT_IDS.riskAssumptionRegister,
      artifactType: ARTIFACT_TYPES.riskAssumptionRegister,
      name: "Risk and assumption register",
      payload: register,
      summary: {
        riskCount: register.items.filter((item) => item.kind === "risk").length,
        assumptionCount: register.items.filter((item) => item.kind === "assumption")
          .length,
      },
    });
  },
};

// ── 6. Produce Product Brief ─────────────────────────────────────

export const produceProductBriefCapability: Capability<unknown, CapabilityOutput> = {
  id: "produce-product-brief",
  name: "Produce product brief",
  description: "Assembles the problem statement, scope, requirements, acceptance criteria and risk register into one brief",
  type: "pure",
  inputSchema: z.unknown(),
  outputSchema: capabilityOutputSchema,

  async execute(context: CapabilityContext): Promise<CapabilityOutput> {
    const [problemStatement, scope, requirements, acceptanceCriteria, risks] =
      await Promise.all([
        readArtifact(context, ARTIFACT_IDS.problemStatement, problemStatementSchema),
        readArtifact(context, ARTIFACT_IDS.scopeDefinition, scopeDefinitionSchema),
        readArtifact(context, ARTIFACT_IDS.requirements, requirementsSchema),
        readArtifact(
          context,
          ARTIFACT_IDS.acceptanceCriteria,
          acceptanceCriteriaSchema,
        ),
        readArtifact(
          context,
          ARTIFACT_IDS.riskAssumptionRegister,
          riskAssumptionRegisterSchema,
        ),
      ]);

    const brief: ProductBrief = productBriefSchema.parse({
      problemStatement,
      scope,
      requirements,
      acceptanceCriteria,
      risks,
    });

    return writeArtifact(context, {
      artifactId: ARTIFACT_IDS.productBrief,
      artifactType: ARTIFACT_TYPES.productBrief,
      name: "Product brief",
      payload: brief,
      summary: {
        requirementCount: brief.requirements.items.length,
        criterionCount: brief.acceptanceCriteria.items.length,
        riskCount: brief.risks.items.length,
      },
    });
  },
};

// ── Registry ─────────────────────────────────────────────────────

export const productBriefCapabilities: readonly Capability<
  unknown,
  CapabilityOutput
>[] = [
  normalizeProductRequestCapability,
  defineScopeCapability,
  defineRequirementsCapability,
  defineAcceptanceCriteriaCapability,
  assessRisksCapability,
  produceProductBriefCapability,
];
