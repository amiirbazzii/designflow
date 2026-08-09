import { describe, expect, test } from "bun:test";
import type { ProjectFact } from "@designflow/sdk";
import {
  destinationCandidatesFromFacts,
  type DestinationCandidate,
} from "./destinations";
import { selectDestination } from "../commands/interactive";
import { ScriptedTerminal } from "../ui/terminal";

function inspectedDestinations(value: unknown): ProjectFact {
  return {
    key: "project.destinations",
    value,
    source: "inspection",
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
  };
}

describe("interactive destination candidates", () => {
  test("keeps useful inspected destinations bounded and adds generic choices", () => {
    const facts = [
      inspectedDestinations([
        ...Array.from({ length: 12 }, (_, index) => ({
          kind: "page",
          label: `/page-${index}`,
          sourcePath: `src/app/page-${index}/page.tsx`,
        })),
        { kind: "component", label: "ExpenseForm", sourcePath: "src/components/ExpenseForm.tsx" },
      ]),
    ];

    const candidates = destinationCandidatesFromFacts(facts);

    expect(candidates).toHaveLength(10);
    expect(candidates.slice(-2).map((candidate) => candidate.label)).toEqual([
      "New page",
      "New component",
    ]);
    expect(candidates.some((candidate) => candidate.label === "ExpenseForm")).toBe(false);
  });

  test("does not fabricate existing destinations when inspection has no evidence", () => {
    const candidates = destinationCandidatesFromFacts([]);

    expect(candidates).toEqual<readonly DestinationCandidate[]>([
      { label: "New page", kind: "new-page" },
      { label: "New component", kind: "new-component" },
    ]);
  });

  test("ignores malformed or unsupported destination facts", () => {
    const candidates = destinationCandidatesFromFacts([
      inspectedDestinations([
        { kind: "route", label: "/unsupported", sourcePath: "src/routes.tsx" },
        { kind: "page", label: "", sourcePath: "src/app/page.tsx" },
        { kind: "component", label: "Button", sourcePath: "src/components/Button.tsx" },
      ]),
    ]);

    expect(candidates.map((candidate) => candidate.label)).toEqual([
      "Button",
      "New page",
      "New component",
    ]);
  });

  test("selects a displayed destination without changing the workflow contract", async () => {
    const candidates: readonly DestinationCandidate[] = [
      { label: "/dashboard", kind: "page", path: "/dashboard", sourcePath: "src/app/dashboard/page.tsx" },
      { label: "New page", kind: "new-page" },
    ];
    const terminal = new ScriptedTerminal(["2"]);

    await expect(selectDestination(terminal, candidates)).resolves.toEqual(candidates[1]);
    expect(terminal.transcript).toContain("Where should this design go?");
  });
});
