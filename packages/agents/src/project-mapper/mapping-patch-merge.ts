// packages/agents/src/project-mapper/mapping-patch-merge.ts
//
// Deterministic merge of mapping decisions into the skeleton.
//
// The boundary this file defends: a model may decide *which* of the host's
// candidates realizes a requirement, and may not decide what the project or
// the design contains. Every rejection is a stable code:
//
//   ERR_IMPLEMENTATION_MAP_PATCH_INVALID            malformed patch
//   ERR_IMPLEMENTATION_MAP_UNKNOWN_BLUEPRINT_REFERENCE
//   ERR_IMPLEMENTATION_MAP_UNKNOWN_PROJECT_COMPONENT
//   ERR_IMPLEMENTATION_MAP_UNKNOWN_DESTINATION
//   ERR_IMPLEMENTATION_MAP_UNKNOWN_TOKEN
//   ERR_IMPLEMENTATION_MAP_INVALID_DECISION         reuse without a target, etc.
//   ERR_IMPLEMENTATION_MAP_PATCH_CONFLICT           two decisions disagree
//   ERR_IMPLEMENTATION_MAP_PATCH_FACT_OVERRIDE      tried to author a host fact
//   ERR_IMPLEMENTATION_MAP_SKELETON_MUTATED         internal invariant broke
import { createHash } from "node:crypto";
import {
  DesignFlowError,
  implementationMapSchema,
  mappingPatchSchema,
  MAPPING_PATCH_CODE_MARKERS,
  MAPPING_PATCH_FORBIDDEN_FIELDS,
  type ComponentMapping,
  type CoverageEntry,
  type ImplementationMap,
  type ImplementationMapDraft,
  type MappingCoverage,
  type MappingPatch,
  type MappingUncertainty,
  type StyleMapping,
} from "@designflow/sdk";

export interface MappingPatchFailure {
  readonly partitionId: string;
  readonly code: string;
}

export interface ApplyMappingPatchesOptions {
  readonly failures?: readonly MappingPatchFailure[];
  readonly partitionCount?: number;
  readonly mapper?: {
    readonly agentId?: string;
    readonly agentVersion?: string;
    readonly modelProfileId?: string;
    readonly model?: string;
  };
}

/**
 * A fingerprint over everything the host owns.
 *
 * Requirements, candidates, bindings and bounds must survive a merge
 * byte-identically; decisions and coverage are exactly what the merge adds.
 */
export function mapSkeletonFingerprint(draft: ImplementationMapDraft | ImplementationMap): string {
  const facts = {
    binding: draft.binding,
    requirements: draft.requirements,
    candidates: draft.candidates,
    destinationCandidates: draft.destinationCandidates,
    plannedDirectories: draft.plannedDirectories,
    projectTokens: draft.projectTokens,
    projectAssets: draft.projectAssets,
    bounds: draft.bounds,
    provenance: draft.provenance,
  };
  return createHash("sha256").update(JSON.stringify(facts)).digest("hex");
}

function assertNoHostFields(raw: unknown, partitionHint: string): void {
  const seen = new Set<object>();
  const walk = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, `${path}[${index}]`));
      return;
    }
    if (typeof value === "string") {
      for (const marker of MAPPING_PATCH_CODE_MARKERS) {
        if (marker.test(value)) {
          throw new DesignFlowError(
            "ERR_IMPLEMENTATION_MAP_PATCH_FACT_OVERRIDE",
            `A mapping patch may not carry code (patch ${partitionHint} at ${path}). The map plans work; it never contains it.`,
          );
        }
      }
      return;
    }
    if (typeof value !== "object" || value === null) return;
    if (seen.has(value)) return;
    seen.add(value);
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (MAPPING_PATCH_FORBIDDEN_FIELDS.includes(key)) {
        throw new DesignFlowError(
          "ERR_IMPLEMENTATION_MAP_PATCH_FACT_OVERRIDE",
          `A mapping patch may not author host-owned facts (patch ${partitionHint} set "${key}" at ${path}). Requirements, candidates and bindings are compiled, not decided.`,
        );
      }
      walk(entry, path.length > 0 ? `${path}.${key}` : key);
    }
  };
  walk(raw, "");
}

/** Parses one raw patch and checks every reference against the skeleton. */
export function validateMappingPatch(raw: unknown, draft: ImplementationMapDraft): MappingPatch {
  const partitionHint =
    typeof raw === "object" && raw !== null && typeof (raw as { partitionId?: unknown }).partitionId === "string"
      ? (raw as { partitionId: string }).partitionId
      : "(unnamed)";

  assertNoHostFields(raw, partitionHint);

  const parsed = mappingPatchSchema.safeParse(raw);
  if (!parsed.success) {
    throw new DesignFlowError(
      "ERR_IMPLEMENTATION_MAP_PATCH_INVALID",
      `Mapping patch ${partitionHint} does not match the patch contract: ${parsed.error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }

  const patch = parsed.data;
  const requirementIds = new Set(draft.requirements.map((requirement) => requirement.id));
  const candidateIds = new Set(draft.candidates.flatMap((set) => set.candidates.map((candidate) => candidate.id)));
  const candidatesByRequirement = new Map(
    draft.candidates.map((set) => [set.requirementId, new Set(set.candidates.map((candidate) => candidate.id))]),
  );
  const destinationIds = new Set(draft.destinationCandidates.map((candidate) => candidate.id));
  const directoryIds = new Set(draft.plannedDirectories.map((directory) => directory.id));
  const tokenIds = new Set(draft.projectTokens.map((token) => token.id));
  const assetIds = new Set(draft.projectAssets.map((asset) => asset.id));
  const blueprintRefs = new Set([
    ...draft.requirements.map((requirement) => requirement.blueprintRef),
    ...draft.requirements.map((requirement) => requirement.id),
  ]);

  const unknownRequirement = (id: string): never => {
    throw new DesignFlowError(
      "ERR_IMPLEMENTATION_MAP_UNKNOWN_BLUEPRINT_REFERENCE",
      `Mapping patch ${partitionHint} decides requirement "${id}", which the draft does not contain.`,
    );
  };

  for (const decision of patch.componentDecisions) {
    if (!requirementIds.has(decision.requirementId)) unknownRequirement(decision.requirementId);

    if (decision.action === "create") {
      if (decision.candidateId !== undefined) {
        throw new DesignFlowError(
          "ERR_IMPLEMENTATION_MAP_INVALID_DECISION",
          `Mapping patch ${partitionHint} marks ${decision.requirementId} as create while also selecting an existing project component.`,
        );
      }
      if (decision.plannedDirectoryId !== undefined && !directoryIds.has(decision.plannedDirectoryId)) {
        throw new DesignFlowError(
          "ERR_IMPLEMENTATION_MAP_UNKNOWN_PROJECT_COMPONENT",
          `Mapping patch ${partitionHint} plans ${decision.requirementId} into a directory the project does not offer.`,
        );
      }
      continue;
    }

    // reuse | extend
    if (decision.candidateId === undefined) {
      throw new DesignFlowError(
        "ERR_IMPLEMENTATION_MAP_INVALID_DECISION",
        `Mapping patch ${partitionHint} marks ${decision.requirementId} as ${decision.action} without naming which existing component it means.`,
      );
    }
    if (!candidateIds.has(decision.candidateId)) {
      throw new DesignFlowError(
        "ERR_IMPLEMENTATION_MAP_UNKNOWN_PROJECT_COMPONENT",
        `Mapping patch ${partitionHint} selects candidate "${decision.candidateId}", which the project does not contain.`,
      );
    }
    if (candidatesByRequirement.get(decision.requirementId)?.has(decision.candidateId) !== true) {
      throw new DesignFlowError(
        "ERR_IMPLEMENTATION_MAP_UNKNOWN_PROJECT_COMPONENT",
        `Mapping patch ${partitionHint} selects a candidate that was not offered for ${decision.requirementId}.`,
      );
    }
  }

  if (patch.destinationDecision !== undefined) {
    const decision = patch.destinationDecision;
    if (!requirementIds.has(decision.requirementId)) unknownRequirement(decision.requirementId);
    if (!destinationIds.has(decision.candidateId)) {
      throw new DesignFlowError(
        "ERR_IMPLEMENTATION_MAP_UNKNOWN_DESTINATION",
        `Mapping patch ${partitionHint} selects destination "${decision.candidateId}", which the project does not offer.`,
      );
    }
    if (
      decision.compositionRootCandidateId !== undefined &&
      !destinationIds.has(decision.compositionRootCandidateId)
    ) {
      throw new DesignFlowError(
        "ERR_IMPLEMENTATION_MAP_UNKNOWN_DESTINATION",
        `Mapping patch ${partitionHint} selects a composition root the project does not offer.`,
      );
    }
  }

  for (const decision of patch.styleDecisions) {
    if (decision.strategy === "raw_design_value") continue;
    if (decision.projectTokenId === undefined || !tokenIds.has(decision.projectTokenId)) {
      throw new DesignFlowError(
        "ERR_IMPLEMENTATION_MAP_UNKNOWN_TOKEN",
        `Mapping patch ${partitionHint} maps "${decision.designValue}" onto a project token that does not exist.`,
      );
    }
  }

  for (const decision of patch.assetDecisions) {
    if (!requirementIds.has(decision.requirementId)) unknownRequirement(decision.requirementId);
    if (decision.projectAssetId !== undefined && !assetIds.has(decision.projectAssetId)) {
      throw new DesignFlowError(
        "ERR_IMPLEMENTATION_MAP_UNKNOWN_PROJECT_COMPONENT",
        `Mapping patch ${partitionHint} references a project asset that does not exist.`,
      );
    }
  }

  for (const decision of patch.compositionDecisions) {
    if (!blueprintRefs.has(decision.blueprintRef)) {
      throw new DesignFlowError(
        "ERR_IMPLEMENTATION_MAP_UNKNOWN_BLUEPRINT_REFERENCE",
        `Mapping patch ${partitionHint} composes "${decision.blueprintRef}", which is not a Blueprint entity in this draft.`,
      );
    }
    if (
      decision.componentRequirementId !== undefined &&
      !requirementIds.has(decision.componentRequirementId)
    ) {
      unknownRequirement(decision.componentRequirementId);
    }
  }

  for (const uncertainty of patch.uncertainties) {
    for (const id of uncertainty.requirementIds) {
      if (!requirementIds.has(id)) unknownRequirement(id);
    }
  }

  return patch;
}

function decisionsConflict(left: ComponentMapping, right: ComponentMapping): boolean {
  return left.action !== right.action || left.candidateId !== right.candidateId;
}

/**
 * Applies validated patches, deterministically.
 *
 * Patches arrive in deterministic partition order, so the same inputs always
 * produce the same map. Host-owned facts are proven untouched by fingerprint.
 */
export function applyProjectMappingPatches(
  draft: ImplementationMapDraft,
  rawPatches: readonly unknown[],
  options: ApplyMappingPatchesOptions = {},
): ImplementationMap {
  const before = mapSkeletonFingerprint(draft);
  const patches = rawPatches.map((raw) => validateMappingPatch(raw, draft));

  const requirementById = new Map(draft.requirements.map((requirement) => [requirement.id, requirement]));
  const candidateById = new Map(
    draft.candidates.flatMap((set) => set.candidates.map((candidate) => [candidate.id, candidate] as const)),
  );
  const directoryById = new Map(draft.plannedDirectories.map((directory) => [directory.id, directory]));
  const destinationById = new Map(draft.destinationCandidates.map((candidate) => [candidate.id, candidate]));
  const tokenById = new Map(draft.projectTokens.map((token) => [token.id, token]));
  const assetById = new Map(draft.projectAssets.map((asset) => [asset.id, asset]));

  const components = new Map<string, ComponentMapping>();
  const styles: StyleMapping[] = [];
  const assets: ImplementationMap["assets"] = [];
  const compositionNodes = new Map<string, ImplementationMap["composition"] extends undefined ? never : NonNullable<ImplementationMap["composition"]>["nodes"][number]>();
  const uncertainties: MappingUncertainty[] = [];
  let screen: ImplementationMap["screen"];

  for (const patch of patches) {
    for (const decision of patch.componentDecisions) {
      const requirement = requirementById.get(decision.requirementId)!;
      const candidate = decision.candidateId !== undefined ? candidateById.get(decision.candidateId) : undefined;
      const directory = decision.plannedDirectoryId !== undefined ? directoryById.get(decision.plannedDirectoryId) : undefined;

      const mapping: ComponentMapping = {
        requirementId: decision.requirementId,
        blueprintComponentId: requirement.blueprintRef,
        action: decision.action,
        ...(decision.candidateId !== undefined ? { candidateId: decision.candidateId } : {}),
        ...(candidate !== undefined
          ? {
              projectTarget: {
                name: candidate.name,
                path: candidate.path,
                ...(candidate.exportName !== undefined ? { exportName: candidate.exportName } : {}),
              },
            }
          : {}),
        ...(decision.plannedDirectoryId !== undefined ? { plannedDirectoryId: decision.plannedDirectoryId } : {}),
        // The planned path is derived by the host from an offered directory
        // and a name — never taken from the model as a free path.
        ...(directory !== undefined && decision.plannedName !== undefined
          ? { plannedPath: `${directory.path}/${decision.plannedName}` }
          : {}),
        compatibility: decision.compatibility,
        requiredAdaptations: [...decision.requiredAdaptations],
        reason: decision.reason,
        confidence: decision.confidence,
        evidence: [decision.requirementId, ...(decision.candidateId !== undefined ? [decision.candidateId] : [])],
      };

      const existing = components.get(decision.requirementId);
      if (existing !== undefined && decisionsConflict(existing, mapping)) {
        throw new DesignFlowError(
          "ERR_IMPLEMENTATION_MAP_PATCH_CONFLICT",
          `Mapping patch ${patch.partitionId} decides ${decision.requirementId} as ${mapping.action}, but ${existing.action} was already applied.`,
        );
      }
      components.set(decision.requirementId, mapping);
    }

    if (patch.destinationDecision !== undefined) {
      const decision = patch.destinationDecision;
      const candidate = destinationById.get(decision.candidateId)!;
      const compositionRoot =
        decision.compositionRootCandidateId !== undefined ? destinationById.get(decision.compositionRootCandidateId) : undefined;
      const next: NonNullable<ImplementationMap["screen"]> = {
        requirementId: decision.requirementId,
        destination: {
          action: decision.action,
          candidateId: decision.candidateId,
          path: candidate.path,
          ...(candidate.route !== undefined ? { route: candidate.route } : {}),
        },
        ...(decision.compositionRootCandidateId !== undefined
          ? { compositionRootCandidateId: decision.compositionRootCandidateId }
          : {}),
        ...(compositionRoot !== undefined ? { compositionRootPath: compositionRoot.path } : {}),
        reason: decision.reason,
        confidence: decision.confidence,
      };
      if (screen !== undefined && JSON.stringify(screen) !== JSON.stringify(next)) {
        throw new DesignFlowError(
          "ERR_IMPLEMENTATION_MAP_PATCH_CONFLICT",
          `Mapping patch ${patch.partitionId} chooses a different destination than an earlier partition already decided.`,
        );
      }
      screen = next;
    }

    for (const decision of patch.styleDecisions) {
      const token = decision.projectTokenId !== undefined ? tokenById.get(decision.projectTokenId) : undefined;
      styles.push({
        designValue: decision.designValue,
        category: decision.category,
        strategy: decision.strategy,
        ...(token !== undefined ? { projectTokenReference: token.reference } : {}),
        reason: decision.reason,
        ...(decision.equivalence !== undefined ? { equivalence: decision.equivalence } : {}),
      });
    }

    for (const decision of patch.assetDecisions) {
      const asset = decision.projectAssetId !== undefined ? assetById.get(decision.projectAssetId) : undefined;
      assets.push({
        requirementId: decision.requirementId,
        blueprintAssetId: requirementById.get(decision.requirementId)!.blueprintRef,
        strategy: decision.strategy,
        ...(asset !== undefined ? { projectAssetPath: asset.path } : {}),
        reason: decision.reason,
      });
    }

    for (const decision of patch.compositionDecisions) {
      const label =
        requirementById.get(decision.componentRequirementId ?? "")?.label ??
        draft.requirements.find((requirement) => requirement.blueprintRef === decision.blueprintRef)?.label ??
        decision.blueprintRef;
      compositionNodes.set(decision.blueprintRef, {
        blueprintRef: decision.blueprintRef,
        label,
        order: decision.order,
        ...(decision.componentRequirementId !== undefined
          ? { componentRequirementId: decision.componentRequirementId }
          : {}),
        childRefs: [...decision.childRefs],
      });
    }

    for (const uncertainty of patch.uncertainties) {
      if (!uncertainties.some((entry) => entry.code === uncertainty.code && entry.description === uncertainty.description)) {
        uncertainties.push(uncertainty);
      }
    }
  }

  // Composition may only arrange requirements that were actually decided.
  for (const node of compositionNodes.values()) {
    if (node.componentRequirementId !== undefined && !components.has(node.componentRequirementId)) {
      throw new DesignFlowError(
        "ERR_IMPLEMENTATION_MAP_INVALID_DECISION",
        `The composition places ${node.componentRequirementId}, which no mapping decided.`,
      );
    }
  }

  const coverage = deriveCoverage(draft, components, screen, assets);
  const failures = [...(options.failures ?? [])];
  const partitionCount = options.partitionCount ?? patches.length;
  const status: ImplementationMap["status"] =
    partitionCount === 0
      ? "draft"
      : patches.length === 0
        ? "unavailable"
        : failures.length > 0 || patches.length < partitionCount || coverage.status !== "complete"
          ? "partial"
          : "complete";

  const merged = implementationMapSchema.parse({
    ...draft,
    status,
    ...(screen !== undefined ? { screen } : {}),
    components: [...components.values()].sort((left, right) => left.requirementId.localeCompare(right.requirementId)),
    styles,
    assets,
    ...(compositionNodes.size > 0
      ? {
          composition: {
            rootLabel: draft.requirements.find((requirement) => requirement.kind === "screen-reachability")?.label ?? "Screen",
            nodes: [...compositionNodes.values()].sort((left, right) => left.order - right.order || left.blueprintRef.localeCompare(right.blueprintRef)),
          },
        }
      : {}),
    coverage,
    uncertainties: uncertainties.slice(0, 64),
    mapper: {
      partitionCount,
      patchCount: patches.length,
      ...(options.mapper ?? {}),
      failures: failures.slice(0, 32),
    },
  });

  const after = mapSkeletonFingerprint(merged);
  if (after !== before) {
    throw new DesignFlowError(
      "ERR_IMPLEMENTATION_MAP_SKELETON_MUTATED",
      "A mapping decision changed a host-owned fact. The merge was rejected.",
    );
  }

  return merged;
}

/**
 * Coverage, derived rather than declared.
 *
 * An instance requirement counts as mapped only when its own definition was
 * decided *and* the decision can express it: a blanket `reuse` whose parent
 * decision carries an unresolved slot incompatibility leaves its instances
 * unresolved rather than quietly inheriting a pass.
 */
function deriveCoverage(
  draft: ImplementationMapDraft,
  components: ReadonlyMap<string, ComponentMapping>,
  screen: ImplementationMap["screen"],
  assets: ImplementationMap["assets"],
): MappingCoverage {
  const entries: CoverageEntry[] = draft.requirements.map((requirement) => {
    if (requirement.kind === "screen-reachability") {
      return {
        requirementId: requirement.id,
        kind: requirement.kind,
        label: requirement.label,
        status: screen !== undefined ? ("mapped" as const) : ("unresolved" as const),
        ...(screen === undefined ? { note: "no destination was decided; the screen would not be reachable" } : {}),
      };
    }
    if (requirement.kind === "asset") {
      const mapping = assets.find((asset) => asset.requirementId === requirement.id);
      if (mapping === undefined) return { requirementId: requirement.id, kind: requirement.kind, label: requirement.label, status: "unresolved" as const };
      return {
        requirementId: requirement.id,
        kind: requirement.kind,
        label: requirement.label,
        status: mapping.strategy === "unresolved" ? ("unresolved" as const) : ("mapped" as const),
      };
    }
    if (requirement.kind === "component-instance") {
      const parent = requirement.parentRequirementId !== undefined ? components.get(requirement.parentRequirementId) : undefined;
      if (parent === undefined) {
        return { requirementId: requirement.id, kind: requirement.kind, label: requirement.label, status: "unresolved" as const };
      }
      const incompatible =
        parent.action === "reuse" &&
        (parent.compatibility.slots === "incompatible" || parent.compatibility.states === "incompatible");
      return {
        requirementId: requirement.id,
        kind: requirement.kind,
        label: requirement.label,
        status: incompatible ? ("unresolved" as const) : ("mapped" as const),
        ...(incompatible
          ? { note: "the reused component cannot express this instance; extend or create instead" }
          : {}),
      };
    }
    if (requirement.kind === "region") {
      // A region is realized through the components inside it; it counts as
      // mapped once anything at all was decided for the screen. "Anything"
      // includes the screen destination itself: a simple screen whose
      // regions hold no components (plain text, inline layout) is realized
      // entirely by the screen file, and before V2-9 such a screen could
      // never reach complete coverage at all.
      return {
        requirementId: requirement.id,
        kind: requirement.kind,
        label: requirement.label,
        status: components.size > 0 || screen !== undefined ? ("mapped" as const) : ("unresolved" as const),
      };
    }
    const mapping = components.get(requirement.id);
    return {
      requirementId: requirement.id,
      kind: requirement.kind,
      label: requirement.label,
      status: mapping !== undefined ? ("mapped" as const) : ("unresolved" as const),
    };
  });

  const requirementBound = draft.bounds.find((bound) => bound.collection === "requirements");
  const truncated = requirementBound?.truncated ?? false;
  const unresolved = entries.filter((entry) => entry.status !== "mapped" && entry.status !== "intentionally_not_implemented");

  return {
    totalRequired: requirementBound?.discoveredCount ?? draft.requirements.length,
    retained: draft.requirements.length,
    truncated,
    ...(requirementBound !== undefined ? { bound: requirementBound } : {}),
    entries: entries.slice(0, 400),
    status: truncated ? "truncated" : unresolved.length > 0 ? "incomplete" : "complete",
  };
}
