// packages/agents/src/ui-blueprint/ui-blueprint-validator.ts
//
// Evidence-relative completeness for the Blueprint itself.
//
// The question this answers is not "is the Blueprint well-formed" — the
// schema settles that — but "is it materially emptier than the evidence it
// was compiled from". No arbitrary minimum counts: every check compares the
// Blueprint against what the snapshot actually contains.
//
// Semantics are never required. A Blueprint with zero annotations is valid;
// enrichment is additive by design, and demanding roles here would make
// design truth depend on model availability, which is exactly what V2 exists
// to stop.
import { collectSpecificationVisibleContent, type FigmaSourceSnapshot, type UIBlueprint } from "@designflow/sdk";

export interface BlueprintValidationIssue {
  readonly code: string;
  readonly message: string;
}

/** Text a Blueprint preserves anywhere it can carry copy. */
export function collectBlueprintVisibleText(blueprint: UIBlueprint): string[] {
  const texts: string[] = [];
  for (const element of blueprint.elements) {
    if (element.facts.text !== undefined) texts.push(element.facts.text.trim());
  }
  for (const component of blueprint.components) {
    for (const instance of component.instances) {
      for (const slot of instance.contents) {
        if (slot.text !== undefined) texts.push(slot.text.trim());
      }
    }
  }
  return texts.filter((text) => text.length > 0);
}

/**
 * Validates a compiled Blueprint against its source snapshot.
 *
 * Returns issues rather than throwing: the caller decides whether a
 * particular gap fails a run or is reported, the same split
 * `completenessIssues` uses for the legacy Specification.
 */
export function validateBlueprintCompleteness(
  blueprint: UIBlueprint,
  snapshot: FigmaSourceSnapshot,
): readonly BlueprintValidationIssue[] {
  const issues: BlueprintValidationIssue[] = [];

  if (snapshot.nodes.length > 0 && blueprint.elements.length === 0) {
    issues.push({
      code: "BLUEPRINT_NO_STRUCTURE",
      message: "The snapshot carries nodes but the Blueprint describes no elements.",
    });
  }

  // Every visible string in the evidence must survive verbatim. Unlike the
  // legacy specification's 50% tolerance (a model was doing the copying), the
  // compiler is deterministic: anything missing here is a compiler defect.
  const evidencedTexts = [
    ...new Set(
      snapshot.nodes
        .map((node) => (node.characters ?? "").trim())
        .filter((text) => text.length > 0),
    ),
  ];
  if (evidencedTexts.length > 0) {
    const preserved = new Set(collectBlueprintVisibleText(blueprint));
    const missing = evidencedTexts.filter((text) => !preserved.has(text));
    if (missing.length > 0) {
      issues.push({
        code: "BLUEPRINT_CONTENT_LOST",
        message: `${missing.length} of ${evidencedTexts.length} evidenced strings are missing from the Blueprint, including ${missing
          .slice(0, 3)
          .map((text) => `"${text.slice(0, 60)}"`)
          .join(", ")}.`,
      });
    }
  }

  const componentEvidence =
    snapshot.components.length > 0 || snapshot.nodes.some((node) => node.type === "INSTANCE" || node.componentId !== undefined);
  if (componentEvidence && blueprint.components.length === 0) {
    issues.push({
      code: "BLUEPRINT_COMPONENTS_LOST",
      message: "The snapshot carries component evidence but the Blueprint names no components.",
    });
  }

  const styleEvidence = snapshot.nodes.some(
    (node) =>
      node.fills.length > 0 ||
      node.strokes.length > 0 ||
      node.effects.length > 0 ||
      node.cornerRadius !== undefined ||
      node.itemSpacing !== undefined,
  );
  const styleCaptured =
    blueprint.foundations.colors.length > 0 ||
    blueprint.foundations.radii.length > 0 ||
    blueprint.foundations.spacing.length > 0 ||
    blueprint.elements.some((element) => element.facts.style !== undefined);
  if (styleEvidence && !styleCaptured) {
    issues.push({
      code: "BLUEPRINT_STYLE_LOST",
      message: "The snapshot carries style evidence but the Blueprint records none.",
    });
  }

  // Provenance: every element must point at a node the snapshot really has.
  const knownNodeIds = new Set(snapshot.nodes.map((node) => node.id));
  const fabricated = blueprint.elements
    .map((element) => element.facts.sourceNodeId)
    .filter((id) => !knownNodeIds.has(id));
  if (fabricated.length > 0) {
    issues.push({
      code: "BLUEPRINT_UNKNOWN_PROVENANCE",
      message: `${fabricated.length} Blueprint element(s) reference node ids the snapshot does not contain: ${[...new Set(fabricated)].slice(0, 3).join(", ")}.`,
    });
  }

  // Structural preservation: parent references must resolve inside the Blueprint.
  const elementIds = new Set(blueprint.elements.map((element) => element.id));
  const orphaned = blueprint.elements.filter(
    (element) => element.parentId !== undefined && !elementIds.has(element.parentId),
  );
  if (orphaned.length > 0) {
    issues.push({
      code: "BLUEPRINT_BROKEN_HIERARCHY",
      message: `${orphaned.length} element(s) name a parent the Blueprint does not contain.`,
    });
  }

  return issues;
}

/**
 * Compares Blueprint content against the legacy Specification collector, so a
 * migration can prove the new path preserves at least what the old one did.
 */
export function blueprintPreservesSpecificationContent(
  blueprint: UIBlueprint,
  specification: Parameters<typeof collectSpecificationVisibleContent>[0],
): readonly string[] {
  const blueprintTexts = new Set(collectBlueprintVisibleText(blueprint));
  return collectSpecificationVisibleContent(specification)
    .map((entry) => entry.text.trim())
    .filter((text) => text.length > 0 && !blueprintTexts.has(text));
}
