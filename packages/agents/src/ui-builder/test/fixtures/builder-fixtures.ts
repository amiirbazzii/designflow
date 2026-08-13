// packages/agents/src/ui-builder/test/fixtures/builder-fixtures.ts
//
// Deterministic Blueprint + ProjectContext + ImplementationMap triples, and a
// fake builder model that returns whatever a test wants it to return. No
// model is ever called for real here.
import type { ImplementationMap, ProposedFileChanges, UIBlueprint } from "@designflow/sdk";

import { SPENDLY_SNAPSHOT } from "../../../../test/fixtures/spendly-blueprint-snapshot";
import { REUSE_READY_PROJECT } from "../../../project-mapper/test/fixtures/mapping-project-contexts";
import { compileUIBlueprintDraft } from "../../../ui-blueprint/ui-blueprint-compiler";
import { compileImplementationMapDraft, componentRequirementId, SCREEN_REACHABILITY_REQUIREMENT_ID } from "../../../project-mapper/mapping-skeleton";
import { applyProjectMappingPatches } from "../../../project-mapper/mapping-patch-merge";

export const BLUEPRINT: UIBlueprint = compileUIBlueprintDraft(SPENDLY_SNAPSHOT, { snapshotArtifactId: "snapshot-1" });
export const PROJECT = REUSE_READY_PROJECT;

export const TEXTFIELD = componentRequirementId("component:TextField");
export const BUTTON = componentRequirementId("component:Button");
export const HISTORY = componentRequirementId("component:HistoryCard");
export const NAV = componentRequirementId("component:NavigationMenuV3");

const DRAFT = compileImplementationMapDraft(BLUEPRINT, PROJECT, {
  blueprintArtifactId: "ui-blueprint-1",
  projectContextArtifactId: "project-context-1",
});

const COMPATIBLE = {
  structure: "compatible",
  slots: "compatible",
  states: "compatible",
  visual: "compatible",
  interaction: "compatible",
} as const;

function candidate(requirementId: string): string {
  return DRAFT.candidates.find((set) => set.requirementId === requirementId)!.candidates[0]!.id;
}

function decision(requirementId: string, action: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requirementId,
    action,
    compatibility: COMPATIBLE,
    requiredAdaptations: [],
    reason: `fixture decision for ${requirementId}`,
    confidence: "high",
    ...extra,
  };
}

function patch(overrides: Record<string, unknown>): unknown {
  return {
    schemaVersion: "1",
    partitionId: "fixture",
    componentDecisions: [],
    styleDecisions: [],
    assetDecisions: [],
    compositionDecisions: [],
    uncertainties: [],
    ...overrides,
  };
}

const DESTINATION_DIRECTORY = DRAFT.destinationCandidates.find((entry) => entry.kind === "candidate-directory")!;
const COMPOSITION_ROOT = DRAFT.destinationCandidates.find((entry) => entry.kind === "composition-root")!;

/** D. The mixed screen: reuse + extend + create, with a real destination. */
export const MIXED_MAP: ImplementationMap = applyProjectMappingPatches(
  DRAFT,
  [
    patch({
      destinationDecision: {
        requirementId: SCREEN_REACHABILITY_REQUIREMENT_ID,
        action: "create_page",
        candidateId: DESTINATION_DIRECTORY.id,
        compositionRootCandidateId: COMPOSITION_ROOT.id,
        reason: "App Router: a new page under the app directory",
        confidence: "high",
      },
    }),
    patch({
      componentDecisions: [
        decision(BUTTON, "reuse", { candidateId: candidate(BUTTON) }),
        decision(NAV, "reuse", { candidateId: candidate(NAV) }),
        decision(TEXTFIELD, "extend", {
          candidateId: candidate(TEXTFIELD),
          compatibility: { ...COMPATIBLE, slots: "partial" },
          requiredAdaptations: ["add a trailing slot for the card selector chevron"],
        }),
        decision(HISTORY, "create", {
          plannedDirectoryId: DRAFT.plannedDirectories[0]!.id,
          plannedName: "HistoryCard.tsx",
        }),
      ],
    }),
    patch({
      assetDecisions: [
        { requirementId: "requirement:asset:A:calendar", strategy: "use_design_asset", reason: "no project equivalent exists" },
      ],
      styleDecisions: [
        { designValue: "#F8F8F8", category: "color", strategy: "reuse_token", projectTokenId: "project-token-1", equivalence: "exact", reason: "exact project token" },
        { designValue: "#D3D3D3", category: "color", strategy: "raw_design_value", reason: "no matching token" },
      ],
    }),
  ],
  { partitionCount: 3 },
);

export const DESTINATION_PATH = `${MIXED_MAP.screen!.destination.path}/add/page.tsx`;
export const TEXTFIELD_PATH = MIXED_MAP.components.find((component) => component.requirementId === TEXTFIELD)!.projectTarget!.path;
export const HISTORY_PATH = MIXED_MAP.components.find((component) => component.requirementId === HISTORY)!.plannedPath!;
export const BUTTON_PATH = MIXED_MAP.components.find((component) => component.requirementId === BUTTON)!.projectTarget!.path;
export const NAV_PATH = MIXED_MAP.components.find((component) => component.requirementId === NAV)!.projectTarget!.path;

/** Every visible string the Spendly screen evidences. */
export const SPENDLY_COPY = [
  "Add Transaction", "Expense", "Income", "Enter amount", "Dollar", "Add a title",
  "Select your card", "Select or add categories", "Who did you pay for?", "Optional",
  "1404/04/24", "Fill the information", "May 2024", "Expense History",
  "Deposit from Alex", "-5,000 T", "Bank Deposit", "Add", "Report", "Invest", "Loan", "Setting",
];

/** A proposal that satisfies the mixed map completely. */
export function validProposal(): ProposedFileChanges {
  const page =
    `import { Button } from "@/components/ui/button";\n` +
    `import { TextField } from "@/components/ui/text-field";\n` +
    `import { NavigationMenuV3 } from "@/components/ui/navigation-menu-v3";\n` +
    `import { HistoryCard } from "@/HistoryCard";\n\n` +
    `export default function AddTransactionPage() {\n` +
    `  return (\n    <main style={{ borderColor: "#D3D3D3", background: "var(--surface-muted)" }}>\n` +
    SPENDLY_COPY.map((copy) => `      <span>{\`${copy}\`}</span>\n`).join("") +
    `      <TextField placeholder="Enter amount" />\n      <Button label="Fill the information" />\n` +
    `      <HistoryCard title="Deposit from Alex" />\n      <NavigationMenuV3 variant="Expenses" />\n` +
    `    </main>\n  );\n}\n`;

  return {
    schemaVersion: "1",
    projectId: "project-fixture",
    baseProjectFingerprint: "fingerprint-1",
    files: [
      { path: DESTINATION_PATH, action: "create", content: page, reason: "the Add Transaction screen", relatedDesignNodeIds: ["1:1"] },
      {
        path: TEXTFIELD_PATH,
        action: "modify",
        content: `export function TextField({ placeholder, trailing }: { placeholder?: string; trailing?: React.ReactNode }) {\n  return <div>{placeholder}{trailing}</div>;\n}\n`,
        reason: "add the trailing slot the map requires",
        relatedDesignNodeIds: ["1:41"],
      },
      {
        path: HISTORY_PATH,
        action: "create",
        content: `export function HistoryCard({ title }: { title: string }) {\n  return <article>{title}</article>;\n}\n`,
        reason: "the history card has no project equivalent",
        relatedDesignNodeIds: ["1:61"],
      },
    ],
    packageChanges: [],
    commandsRequested: [],
    assumptions: [],
    unresolvedItems: [],
  };
}

/** A fake builder that returns scripted proposals, one per attempt. */
export function scriptedBuilder(responses: readonly (ProposedFileChanges | Error)[]) {
  const calls: number[] = [];
  return {
    calls,
    generate: async (_evidence: unknown, attempt: number): Promise<ProposedFileChanges> => {
      calls.push(attempt);
      const response = responses[Math.min(attempt - 1, responses.length - 1)]!;
      if (response instanceof Error) throw response;
      return response;
    },
  };
}
