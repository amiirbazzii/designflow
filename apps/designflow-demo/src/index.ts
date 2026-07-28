// apps/designflow-demo/src/index.ts
export { runDemo } from "./app";
export type { DemoResult, RunDemoOptions } from "./app";

export { createDemoHost } from "./host";
export type { DemoHost, DemoHostOptions, ProgressListener } from "./host";

export { ScriptedIO } from "./io";
export type { DemoIO } from "./io";

export { DEMO_WORKFLOWS, findWorkflow } from "./catalog";
export type { DemoWorkflow, DemoField } from "./catalog";

export {
  renderLanding,
  renderInputHeading,
  renderInputSummary,
  renderProgress,
  renderApproval,
  renderApprovalOutcome,
  renderCompletion,
  renderExplanation,
} from "./screens";
