// apps/designflow-demo/src/catalog.ts

/**
 * The workflows this demo offers.
 *
 * Plain data, so the landing screen and the input form are driven by the same
 * description. Adding a second vertical workflow means adding an entry here,
 * not touching a screen.
 */
export interface DemoField {
  readonly key: string;
  readonly label: string;
  readonly placeholder: string;
  /** Split the answer on commas into a list. */
  readonly list?: boolean;
  readonly choices?: readonly string[];
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
    fields: [
      {
        key: "designFile",
        label: "Design file",
        placeholder: "homepage.fig",
      },
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
    ],
  },
];

export function findWorkflow(workflowId: string): DemoWorkflow | undefined {
  return DEMO_WORKFLOWS.find((entry) => entry.workflowId === workflowId);
}
