// packages/agents/src/design-interpreter/semantic-patch-merge.ts
//
// Deterministic merge of semantic patches into the canonical Blueprint.
//
// This is the boundary the whole V2 architecture rests on: a model may say
// what a frame *means*, and may say nothing about what it *is*. The patch
// schema has no field capable of carrying a dimension, color or string of
// copy, so a fact override cannot be expressed; this merge additionally
// inspects raw input before parsing and refuses anything fact-shaped, then
// proves the point structurally by fingerprinting the compiler-owned facts
// before and after and requiring them to be identical.
//
// Every rejection is a stable code, never a message match:
//   ERR_BLUEPRINT_PATCH_INVALID           — malformed patch
//   ERR_BLUEPRINT_PATCH_UNKNOWN_REFERENCE — names an entity that isn't there
//   ERR_BLUEPRINT_PATCH_FACT_OVERRIDE     — tried to write a compiler fact
//   ERR_BLUEPRINT_PATCH_CONFLICT          — two patches disagree authoritatively
//   ERR_BLUEPRINT_FACTS_MUTATED           — internal invariant broke (a bug)
import { createHash } from "node:crypto";
import {
  BLUEPRINT_FACT_FIELD_NAMES,
  DesignFlowError,
  uiBlueprintSchema,
  uiSemanticPatchSchema,
  type BlueprintRelationship,
  type BlueprintSemanticRegion,
  type BlueprintSemantics,
  type UIBlueprint,
  type UISemanticPatch,
} from "@designflow/sdk";

export interface SemanticPatchFailure {
  readonly partitionId: string;
  readonly code: string;
}

export interface ApplySemanticPatchesOptions {
  /** Partitions that were requested but produced no usable patch. */
  readonly failures?: readonly SemanticPatchFailure[];
  /** How many partitions the compiler asked for in total. */
  readonly partitionCount?: number;
  readonly modelProvenance?: UIBlueprint["semanticEnrichment"]["modelProvenance"];
}

/**
 * A stable fingerprint over every compiler-owned fact in a Blueprint.
 *
 * Deliberately excludes `semantics`, `semanticRegions`, `relationships` and
 * the enrichment block — those are exactly what a patch is allowed to change.
 * Everything else must survive a merge byte-identically.
 */
export function blueprintFactsFingerprint(blueprint: UIBlueprint): string {
  const facts = {
    screen: blueprint.screen,
    elements: blueprint.elements.map((element) => ({
      id: element.id,
      parentId: element.parentId ?? null,
      order: element.order,
      facts: element.facts,
    })),
    components: blueprint.components.map((component) => {
      const { semantics: _semantics, ...rest } = component;
      return rest;
    }),
    foundations: blueprint.foundations,
    assets: blueprint.assets,
    interactions: blueprint.interactions,
    provenance: blueprint.provenance,
  };
  return createHash("sha256").update(JSON.stringify(facts)).digest("hex");
}

/** Defensive pre-parse scan: any fact-shaped key anywhere in a raw patch. */
function assertNoFactFields(raw: unknown, partitionHint: string): void {
  const seen = new Set<object>();
  const walk = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, `${path}[${index}]`));
      return;
    }
    if (typeof value !== "object" || value === null) return;
    if (seen.has(value)) return;
    seen.add(value);
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (BLUEPRINT_FACT_FIELD_NAMES.includes(key)) {
        throw new DesignFlowError(
          "ERR_BLUEPRINT_PATCH_FACT_OVERRIDE",
          `A semantic patch may not carry design facts (patch ${partitionHint} set "${key}" at ${path}). Facts are compiled from Figma evidence and are not model-authored.`,
        );
      }
      walk(entry, path.length > 0 ? `${path}.${key}` : key);
    }
  };
  walk(raw, "");
}

/** Parses and validates one raw patch against a Blueprint's entity ids. */
export function validateSemanticPatch(raw: unknown, blueprint: UIBlueprint): UISemanticPatch {
  const partitionHint =
    typeof raw === "object" && raw !== null && typeof (raw as { partitionId?: unknown }).partitionId === "string"
      ? (raw as { partitionId: string }).partitionId
      : "(unnamed)";

  assertNoFactFields(raw, partitionHint);

  const parsed = uiSemanticPatchSchema.safeParse(raw);
  if (!parsed.success) {
    throw new DesignFlowError(
      "ERR_BLUEPRINT_PATCH_INVALID",
      `Semantic patch ${partitionHint} does not match the patch contract: ${parsed.error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }

  const patch = parsed.data;
  const elementIds = new Set(blueprint.elements.map((element) => element.id));
  const componentIds = new Set(blueprint.components.map((component) => component.id));

  const unknown: string[] = [];
  for (const annotation of patch.elementAnnotations) {
    if (!elementIds.has(annotation.elementId)) unknown.push(annotation.elementId);
  }
  for (const annotation of patch.componentAnnotations) {
    if (!componentIds.has(annotation.componentId)) unknown.push(annotation.componentId);
  }
  for (const region of patch.regionAnnotations) {
    for (const member of region.memberElementIds) {
      if (!elementIds.has(member)) unknown.push(member);
    }
    if (region.anchorElementId !== undefined && !elementIds.has(region.anchorElementId)) {
      unknown.push(region.anchorElementId);
    }
  }
  for (const uncertainty of patch.uncertainties) {
    for (const id of uncertainty.affectedIds) {
      if (!elementIds.has(id) && !componentIds.has(id)) unknown.push(id);
    }
  }
  // A relationship endpoint must be a real element or component — this is what
  // stops a fabricated edge between invented nodes.
  for (const relationship of patch.relationships) {
    for (const endpoint of [relationship.fromId, relationship.toId]) {
      if (!elementIds.has(endpoint) && !componentIds.has(endpoint)) unknown.push(endpoint);
    }
  }

  if (unknown.length > 0) {
    throw new DesignFlowError(
      "ERR_BLUEPRINT_PATCH_UNKNOWN_REFERENCE",
      `Semantic patch ${partitionHint} references ${unknown.length} entit${unknown.length === 1 ? "y" : "ies"} the Blueprint does not contain: ${[...new Set(unknown)].slice(0, 5).join(", ")}.`,
    );
  }

  return patch;
}

const SEMANTIC_FIELDS = ["role", "purpose", "interactionKind", "importance", "evidenceBasis"] as const;

/**
 * Merges one annotation into an entity's semantics.
 *
 * Identical repeated annotations are idempotent (a partition boundary may
 * legitimately name the same element twice). Two *different* authoritative
 * values for the same field are a conflict and stop the merge — silently
 * letting the last writer win is how a design contract quietly changes
 * meaning depending on partition order.
 */
function mergeSemantics(
  current: BlueprintSemantics,
  incoming: Omit<BlueprintSemantics, "notes"> & { notes?: readonly string[] },
  entityId: string,
  partitionId: string,
): BlueprintSemantics {
  for (const field of SEMANTIC_FIELDS) {
    const next = incoming[field];
    const existing = current[field];
    if (next === undefined || existing === undefined || existing === next) continue;
    throw new DesignFlowError(
      "ERR_BLUEPRINT_PATCH_CONFLICT",
      `Semantic patch ${partitionId} sets ${field}="${String(next)}" on ${entityId}, but "${String(existing)}" was already applied. Conflicting authoritative semantics are not merged silently.`,
    );
  }

  const merged: BlueprintSemantics = {
    ...current,
    ...(incoming.role !== undefined ? { role: incoming.role } : {}),
    ...(incoming.purpose !== undefined ? { purpose: incoming.purpose } : {}),
    ...(incoming.interactionKind !== undefined ? { interactionKind: incoming.interactionKind } : {}),
    ...(incoming.importance !== undefined ? { importance: incoming.importance } : {}),
    ...(incoming.evidenceBasis !== undefined ? { evidenceBasis: incoming.evidenceBasis } : {}),
    ...(incoming.confidence !== undefined ? { confidence: incoming.confidence } : {}),
    notes: [...new Set([...current.notes, ...(incoming.notes ?? [])])].slice(0, 4),
  };
  return merged;
}

/** Region ids are derived, never model-supplied, so a patch cannot mint a node. */
function regionId(name: string, memberElementIds: readonly string[]): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  const digest = createHash("sha256").update([...memberElementIds].sort().join("|")).digest("hex").slice(0, 8);
  return `region:${slug.length > 0 ? slug : "unnamed"}:${digest}`;
}

function relationshipId(kind: string, fromId: string, toId: string): string {
  return `rel:${kind}:${fromId}->${toId}`;
}

/**
 * Applies validated semantic patches to a Blueprint draft, deterministically.
 *
 * Patches are applied in the order given; the caller supplies them in
 * deterministic partition order, so the same inputs always produce the same
 * Blueprint. Compiler-owned facts are proven untouched by fingerprint.
 */
export function applySemanticPatches(
  draft: UIBlueprint,
  rawPatches: readonly unknown[],
  options: ApplySemanticPatchesOptions = {},
): UIBlueprint {
  const before = blueprintFactsFingerprint(draft);
  const patches = rawPatches.map((raw) => validateSemanticPatch(raw, draft));

  const elements = draft.elements.map((element) => ({ ...element, semantics: { ...element.semantics } }));
  const components = draft.components.map((component) => ({ ...component, semantics: { ...component.semantics } }));
  const elementById = new Map(elements.map((element) => [element.id, element]));
  const componentById = new Map(components.map((component) => [component.id, component]));

  const regions = new Map<string, BlueprintSemanticRegion>();
  const relationships = new Map<string, BlueprintRelationship>();
  const uncertainties = [...draft.uncertainties];

  for (const patch of patches) {
    for (const annotation of patch.elementAnnotations) {
      const element = elementById.get(annotation.elementId)!;
      const { elementId: _elementId, ...semantics } = annotation;
      element.semantics = mergeSemantics(element.semantics, semantics, annotation.elementId, patch.partitionId);
    }

    for (const annotation of patch.componentAnnotations) {
      const component = componentById.get(annotation.componentId)!;
      const { componentId: _componentId, ...semantics } = annotation;
      component.semantics = mergeSemantics(component.semantics, semantics, annotation.componentId, patch.partitionId);
    }

    for (const annotation of patch.regionAnnotations) {
      const { name, memberElementIds, anchorElementId, ...semantics } = annotation;
      const id = regionId(name, memberElementIds);
      const existing = regions.get(id);
      if (existing === undefined) {
        regions.set(id, {
          id,
          name,
          order: regions.size,
          // Source order is preserved: members are ordered by their position
          // in the compiled element list, not by the order a model listed them.
          memberElementIds: elements
            .filter((element) => memberElementIds.includes(element.id))
            .map((element) => element.id),
          ...(anchorElementId !== undefined ? { anchorElementId } : {}),
          origin: "interpreter",
          semantics: mergeSemantics({ notes: [] }, semantics, id, patch.partitionId),
        });
      } else {
        regions.set(id, {
          ...existing,
          semantics: mergeSemantics(existing.semantics, semantics, id, patch.partitionId),
        });
      }
    }

    for (const relationship of patch.relationships) {
      const id = relationshipId(relationship.kind, relationship.fromId, relationship.toId);
      const existing = relationships.get(id);
      if (existing !== undefined && existing.evidenceBasis !== relationship.evidenceBasis) {
        throw new DesignFlowError(
          "ERR_BLUEPRINT_PATCH_CONFLICT",
          `Semantic patch ${patch.partitionId} restates relationship ${id} with a different evidence basis.`,
        );
      }
      relationships.set(id, { id, ...relationship });
    }

    for (const uncertainty of patch.uncertainties) {
      if (!uncertainties.some((entry) => entry.code === uncertainty.code && entry.description === uncertainty.description)) {
        uncertainties.push(uncertainty);
      }
    }
  }

  const failures = [...(options.failures ?? [])];
  const partitionCount = options.partitionCount ?? patches.length;
  const status: UIBlueprint["semanticEnrichment"]["status"] =
    partitionCount === 0
      ? "not_requested"
      : patches.length === 0
        ? "unavailable"
        : failures.length > 0 || patches.length < partitionCount
          ? "partial"
          : "completed";

  const merged = uiBlueprintSchema.parse({
    ...draft,
    elements,
    components,
    semanticRegions: [...regions.values()].map((region, index) => ({ ...region, order: index })),
    relationships: [...relationships.values()],
    uncertainties: uncertainties.slice(0, 64),
    semanticEnrichment: {
      status,
      partitionCount,
      patchCount: patches.length,
      ...(options.modelProvenance !== undefined ? { modelProvenance: options.modelProvenance } : {}),
      failures: failures.slice(0, 32),
    },
  });

  const after = blueprintFactsFingerprint(merged);
  if (after !== before) {
    // Unreachable by construction; a guard rather than a comment, because
    // "AI cannot change design facts" is the one claim this file exists to make.
    throw new DesignFlowError(
      "ERR_BLUEPRINT_FACTS_MUTATED",
      "Semantic enrichment changed a compiler-owned design fact. The merge was rejected.",
    );
  }

  return merged;
}
