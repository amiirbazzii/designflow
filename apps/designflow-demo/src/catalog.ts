// apps/designflow-demo/src/catalog.ts
import { designEngineer } from "@designflow/workers";

/**
 * The workflows this demo offers.
 *
 * This demo is a workflow-level engine showcase (its own architecture test,
 * "the catalogue drives the screens", is about screens reading this table —
 * not about worker vocabulary), so `workflowId`/`name`/`tagline` stay this
 * table's own display text. `fields` do not: they come straight from
 * `designEngineer.inputs` in `@designflow/workers` — the same manifest the
 * CLI and API read — rather than a second, hand-typed copy that could drift
 * from it. Only `design-to-code` is wired into `host.ts`'s engine today, so
 * only one entry exists; adding a second vertical workflow still means
 * adding an entry here, but its `fields` would read from its own worker's
 * `inputs` the same way.
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
}

export const DEMO_WORKFLOWS: readonly DemoWorkflow[] = [
  {
    workflowId: "design-to-code",
    name: "Design → Code",
    tagline: "Turn a design file into reviewed, production-ready components",
    fields: designEngineer.inputs,
  },
];

export function findWorkflow(workflowId: string): DemoWorkflow | undefined {
  return DEMO_WORKFLOWS.find((entry) => entry.workflowId === workflowId);
}
