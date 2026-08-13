// packages/agents/src/visual-validation/test/fixtures/rendered-state-fixtures.ts
//
// A Blueprint with known design facts and RenderedStates that agree with it,
// disagree with it, or never happened. No browser and no model are involved.
import { renderedStateSchema, type RenderedState, type UIBlueprint } from "@designflow/sdk";

import { SPENDLY_SNAPSHOT } from "../../../../test/fixtures/spendly-blueprint-snapshot";
import { compileUIBlueprintDraft } from "../../../ui-blueprint/ui-blueprint-compiler";

export const BLUEPRINT: UIBlueprint = compileUIBlueprintDraft(SPENDLY_SNAPSHOT, {
  snapshotArtifactId: "snapshot-1",
});

export const BINDING = { proposalHash: "proposal-hash-1" } as const;

function state(overrides: Partial<RenderedState>): RenderedState {
  return renderedStateSchema.parse({
    schemaVersion: "1",
    status: "rendered",
    binding: BINDING,
    viewports: [
      {
        id: "desktop",
        width: 1440,
        height: 1024,
        captureStatus: "captured",
        screenshotContentHash: "hash-1",
        domEvidenceStatus: "captured",
        consoleErrorCount: 0,
        runtimeErrorCount: 0,
        warnings: [],
      },
    ],
    elements: [],
    pixelComparisons: [],
    runtime: { buildStatus: "passed", previewStatus: "ready", diagnostics: [] },
    provenance: { rendererVersion: "1.0.0", workspaceIsolated: true },
    ...overrides,
  });
}

export interface ElementSeed {
  readonly text?: string;
  readonly height?: number;
  readonly fontSize?: string;
  readonly color?: string;
  readonly backgroundColor?: string;
  readonly borderRadius?: string;
}

export function renderedWith(seeds: readonly ElementSeed[], overrides: Partial<RenderedState> = {}): RenderedState {
  return state({
    elements: seeds.map((seed, index) => ({
      viewportId: "desktop",
      selector: `#element-${index}`,
      ...(seed.text !== undefined ? { text: seed.text } : {}),
      x: 0,
      y: index * 10,
      width: 200,
      height: seed.height ?? 24,
      ...(seed.fontSize !== undefined ? { fontSize: seed.fontSize } : {}),
      ...(seed.color !== undefined ? { color: seed.color } : {}),
      ...(seed.backgroundColor !== undefined ? { backgroundColor: seed.backgroundColor } : {}),
      ...(seed.borderRadius !== undefined ? { borderRadius: seed.borderRadius } : {}),
    })),
    ...overrides,
  });
}

export const RENDER_FAILED: RenderedState = state({
  status: "render_failed",
  viewports: [],
  runtime: {
    buildStatus: "failed",
    previewStatus: "unavailable",
    diagnostics: ["Type error in [temporary-workspace]/app/page.tsx"],
  },
});

export const BROWSER_UNAVAILABLE: RenderedState = state({
  status: "browser_unavailable",
  viewports: [],
  runtime: { buildStatus: "passed", previewStatus: "unavailable", diagnostics: ["Playwright was unavailable."] },
});

export const PROJECT_MOVED: RenderedState = state({
  status: "project_changed_before_render",
  viewports: [],
  runtime: { buildStatus: "unavailable", previewStatus: "unavailable", diagnostics: [] },
});
