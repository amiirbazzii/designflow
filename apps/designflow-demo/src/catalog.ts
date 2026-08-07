// apps/designflow-demo/src/catalog.ts
import {
  productManager,
  qaReviewer,
  researchAnalyst,
} from "@designflow/workers";

/**
 * The workflows this demo offers.
 *
 * This demo is a workflow-level engine showcase (its own architecture test,
 * "the catalogue drives the screens", is about screens reading this table —
 * not about worker vocabulary), so `workflowId`/`name`/`tagline` stay this
 * table's own display text. `fields` do not: they come straight from each
 * worker's `inputs` in `@designflow/workers` — the same manifest the CLI and
 * API read — rather than a second, hand-typed copy that could drift from it.
 * The exception is the compatibility `design-to-code` workflow: it is not a
 * worker-facing product form, so its native input fields are owned here next
 * to the workflow-level demo entry. All four built-in workflow packages are
 * wired into `host.ts`'s engine, so all four have an entry here.
 *
 * A worker's `inputs` are written in worker vocabulary (e.g. `reviewTarget`,
 * `researchQuestion`), because that is what the Worker Task Boundary the
 * CLI/API/web use expects. This demo skips that boundary and hands
 * `WorkflowRunner.start` the workflow's own native input shape directly, and
 * for three of the four workflows that shape uses different field names (and,
 * for `qa-review`/`research-analysis`, structured values the flat demo form
 * cannot produce on its own — e.g. `items`/`sources` as objects). `toInput`
 * bridges that gap the same mechanical way the real agents do (see e.g.
 * `packages/agents/src/catalog/qa-reviewer-agent.ts`'s `shapeWorkflowInput`),
 * just inlined here since the demo does not depend on `@designflow/agents`.
 * `design-to-code` is compatibility-only and has its own native input form,
 * so it needs no bridging and `toInput` is omitted.
 */
export interface DemoField {
  readonly key: string;
  readonly label: string;
  readonly placeholder: string;
  /** Split the answer on commas into a list. */
  readonly list?: boolean | undefined;
  readonly choices?: readonly string[] | undefined;
}

export interface DemoWorkflow {
  readonly workflowId: string;
  readonly name: string;
  readonly tagline: string;
  readonly fields: readonly DemoField[];
  /**
   * Reshapes the raw, worker-vocabulary field answers into the workflow's
   * native execution input. Identity when absent.
   */
  readonly toInput?: (
    input: Record<string, unknown>,
  ) => Record<string, unknown>;
}

function asList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

const compatibilityDesignToCodeFields: readonly DemoField[] = [
  { key: "designFile", label: "Design file", placeholder: "homepage.fig" },
  {
    key: "framework",
    label: "Framework",
    placeholder: "react",
    choices: ["react", "vue", "svelte"],
  },
  {
    key: "frames",
    label: "Frames (comma separated)",
    placeholder: "brand/Header, brand/Footer, layout/Dashboard",
    list: true,
  },
];

export const DEMO_WORKFLOWS: readonly DemoWorkflow[] = [
  {
    workflowId: "design-to-code",
    name: "Design → Code",
    tagline: "Turn a design file into reviewed, production-ready components",
    fields: compatibilityDesignToCodeFields,
  },
  {
    workflowId: "qa-review",
    name: "QA Review",
    tagline: "Review an implementation for correctness, severity and accessibility",
    fields: qaReviewer.inputs,
    toInput: (input) => {
      const reviewTarget = String(input.reviewTarget ?? "review-target");

      return {
        id: reviewTarget,
        description: `Review of ${reviewTarget}`,
        items: [{ path: reviewTarget, kind: "component" }],
        scope: asList(input.reviewScope),
        severityThreshold: input.severityThreshold ?? "minor",
      };
    },
  },
  {
    workflowId: "research-analysis",
    name: "Research Analysis",
    tagline: "Synthesize supplied sources into structured findings and citations",
    fields: researchAnalyst.inputs,
    toInput: (input) => ({
      question: String(input.researchQuestion ?? ""),
      sources: asList(input.sources).map((source) => ({
        id: source,
        title: source,
        content: source,
      })),
    }),
  },
  {
    workflowId: "product-brief",
    name: "Product Brief",
    tagline: "Turn a product request into a structured brief with acceptance criteria",
    fields: productManager.inputs,
    toInput: (input) => ({
      productRequest: String(input.productRequest ?? ""),
      targetUser: String(input.targetUser ?? "unspecified user"),
      constraints: asList(input.constraints),
    }),
  },
];

export function findWorkflow(workflowId: string): DemoWorkflow | undefined {
  return DEMO_WORKFLOWS.find((entry) => entry.workflowId === workflowId);
}
