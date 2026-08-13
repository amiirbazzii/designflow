// workflows/workflow-design-to-code/src/visual-validation/test/render-instrumentation.test.ts
//
// V2-5.1: host-owned correspondence markers, and the guarantees that make
// writing into the rendered source acceptable at all.
import { describe, expect, test } from "bun:test";
import type { ImplementationMap, ProposedFileChanges } from "@designflow/sdk";

import { INSTRUMENTATION_ATTRIBUTE, instrumentProposal } from "../render-instrumentation";

const MAP = {
  screen: {
    requirementId: "requirement:screen",
    destination: { action: "create_page", candidateId: "d1", path: "src/app/add" },
    reason: "fixture",
    confidence: "high",
  },
  components: [
    {
      requirementId: "requirement:component:HistoryCard",
      blueprintComponentId: "component:HistoryCard",
      action: "create",
      plannedPath: "src/components/HistoryCard.tsx",
      requiredAdaptations: [],
      reason: "fixture",
      confidence: "high",
    },
  ],
  assets: [],
  styles: [],
} as unknown as ImplementationMap;

function proposal(files: readonly { path: string; content: string }[]): ProposedFileChanges {
  return {
    schemaVersion: "1",
    projectId: "p",
    baseProjectFingerprint: "f",
    files: files.map((file) => ({
      path: file.path,
      action: "create" as const,
      content: file.content,
      reason: "fixture",
      relatedDesignNodeIds: [],
    })),
    packageChanges: [],
    commandsRequested: [],
    assumptions: [],
    unresolvedItems: [],
  };
}

const PAGE = `export default function AddTransactionPage() {\n  return (\n    <main className="screen">\n      <h1>Add Transaction</h1>\n    </main>\n  );\n}\n`;
const CARD = `export function HistoryCard({ title }: { title: string }) {\n  return <article>{title}</article>;\n}\n`;

describe("render instrumentation", () => {
  test("marks each mapped component's outermost element with its requirement", () => {
    const result = instrumentProposal(
      proposal([
        { path: "src/app/add/page.tsx", content: PAGE },
        { path: "src/components/HistoryCard.tsx", content: CARD },
      ]),
      MAP,
    );

    expect(result.applied).toBe(true);
    expect(result.instrumentedFileCount).toBe(2);
    const page = result.proposal.files.find((file) => file.path.endsWith("page.tsx"))!.content!;
    const card = result.proposal.files.find((file) => file.path.endsWith("HistoryCard.tsx"))!.content!;
    expect(page).toContain(`<main ${INSTRUMENTATION_ATTRIBUTE}="requirement:screen"`);
    expect(card).toContain(`<article ${INSTRUMENTATION_ATTRIBUTE}="requirement:component:HistoryCard"`);
  });

  test("the marker is inert: nothing but one attribute changes", () => {
    const original = proposal([{ path: "src/components/HistoryCard.tsx", content: CARD }]);
    const result = instrumentProposal(original, MAP);
    const instrumented = result.proposal.files[0]!.content!;

    // Same source with the attribute removed is byte-identical to the input.
    expect(instrumented.replace(` ${INSTRUMENTATION_ATTRIBUTE}="requirement:component:HistoryCard"`, "")).toBe(CARD);
    // No style, class or layout-bearing attribute was touched.
    expect(instrumented).not.toContain("style=");
    expect(instrumented).not.toContain("className=\"designflow");
  });

  test("the validated proposal itself is never modified", () => {
    const original = proposal([{ path: "src/components/HistoryCard.tsx", content: CARD }]);
    const snapshot = JSON.stringify(original);
    instrumentProposal(original, MAP);
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  test("a file the plan does not place is left alone, and says so", () => {
    const result = instrumentProposal(proposal([{ path: "src/util/helpers.tsx", content: CARD }]), MAP);
    expect(result.applied).toBe(false);
    expect(result.notes.join(" ")).toContain("no mapped requirement");
  });

  test("declines rather than guesses when the JSX is not plainly a tag", () => {
    const fragment = `export default function Page() {\n  return <>{null}</>;\n}\n`;
    const result = instrumentProposal(proposal([{ path: "src/app/add/page.tsx", content: fragment }]), MAP);
    expect(result.applied).toBe(false);
    expect(result.notes.join(" ")).toContain("no unambiguous JSX opening tag");
  });

  test("non-JSX files are never rewritten", () => {
    const css = `.card { border-radius: 8px; }\n`;
    const result = instrumentProposal(proposal([{ path: "src/app/add/styles.css", content: css }]), MAP);
    expect(result.proposal.files[0]!.content).toBe(css);
    expect(result.applied).toBe(false);
  });

  test("without an Implementation Map there is nothing to mark", () => {
    const result = instrumentProposal(proposal([{ path: "src/app/add/page.tsx", content: PAGE }]), undefined);
    expect(result.applied).toBe(false);
    expect(result.notes[0]).toContain("No Implementation Map");
  });

  test("already-instrumented source is not marked twice", () => {
    const once = instrumentProposal(proposal([{ path: "src/app/add/page.tsx", content: PAGE }]), MAP);
    const twice = instrumentProposal(once.proposal, MAP);
    expect(twice.applied).toBe(false);
    expect(twice.proposal.files[0]!.content).toBe(once.proposal.files[0]!.content);
  });
});
