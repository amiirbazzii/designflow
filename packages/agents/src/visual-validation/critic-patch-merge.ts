// packages/agents/src/visual-validation/critic-patch-merge.ts
//
// Deterministic merge of Visual Critic patches onto deterministic findings.
//
// Same boundary the Blueprint and Implementation Map draw, applied to visual
// evidence: the browser owns the measurement, the model owns the judgment.
// A patch may say a 6px gap error is what makes the screen look broken, and
// may not say the gap was 12px.
//
// Rejections are stable codes, never message matches:
//   ERR_VISUAL_CRITIC_PATCH_INVALID           — malformed patch
//   ERR_VISUAL_CRITIC_PATCH_UNKNOWN_FINDING   — annotates a finding that isn't there
//   ERR_VISUAL_CRITIC_PATCH_FACT_OVERRIDE     — tried to restate a measurement
//   ERR_VISUAL_CRITIC_PATCH_INVENTED_FINDING  — tried to author a finding
import { createHash } from "node:crypto";
import {
  VISUAL_CRITIC_FORBIDDEN_FIELDS,
  visualCriticPatchSchema,
  type VisualCriticAnnotation,
  type VisualCriticPatch,
  type VisualFindingV1,
} from "@designflow/sdk";

export interface CriticPatchFailure {
  readonly partitionId: string;
  readonly code: string;
}

export interface MergedCriticPatches {
  readonly findings: readonly VisualFindingV1[];
  readonly annotations: readonly VisualCriticAnnotation[];
  readonly summaries: readonly string[];
  readonly failures: readonly CriticPatchFailure[];
  readonly appliedPatchCount: number;
}

/** Fingerprint over everything a patch must not be able to move. */
function measurementFingerprint(findings: readonly VisualFindingV1[]): string {
  const facts = findings.map((f) => ({
    findingId: f.findingId,
    category: f.category,
    origin: f.origin,
    expectedValue: f.expectedValue,
    actualValue: f.actualValue,
    measurableDelta: f.measurableDelta,
    boundingRegion: f.boundingRegion,
    evidenceReferences: f.evidenceReferences,
  }));
  return createHash("sha256").update(JSON.stringify(facts)).digest("hex");
}

/** Rejects fact-shaped input before parsing, so the reason is precise. */
function factOverride(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null) return false;
  const seen: unknown[] = [raw];
  while (seen.length > 0) {
    const current = seen.pop();
    if (Array.isArray(current)) {
      seen.push(...current);
      continue;
    }
    if (typeof current !== "object" || current === null) continue;
    for (const [key, value] of Object.entries(current as Record<string, unknown>)) {
      if (VISUAL_CRITIC_FORBIDDEN_FIELDS.includes(key)) return true;
      if (typeof value === "object" && value !== null) seen.push(value);
    }
  }
  return false;
}

const SEVERITY_ORDER = ["info", "minor", "major", "critical"] as const;

/**
 * Applies critic patches to the deterministic findings.
 *
 * Severity is the one measured field a patch may touch, and only upward: a
 * model arguing that a real, measured difference is *less* serious than the
 * deterministic policy judged it is a model talking its own work down, and
 * the product should not let it.
 */
export function applyVisualCriticPatches(
  findings: readonly VisualFindingV1[],
  rawPatches: readonly unknown[],
  options: { readonly failures?: readonly CriticPatchFailure[]; readonly allowSeverityEscalation?: boolean } = {},
): MergedCriticPatches {
  const before = measurementFingerprint(findings);
  const byId = new Map(findings.map((finding) => [finding.findingId, finding]));
  const merged = new Map(findings.map((finding) => [finding.findingId, finding]));
  const annotations: VisualCriticAnnotation[] = [];
  const summaries: string[] = [];
  const failures: CriticPatchFailure[] = [...(options.failures ?? [])];
  let applied = 0;

  for (const raw of rawPatches) {
    const partitionId =
      typeof raw === "object" && raw !== null && typeof (raw as { partitionId?: unknown }).partitionId === "string"
        ? (raw as { partitionId: string }).partitionId
        : "unknown";

    if (factOverride(raw)) {
      failures.push({ partitionId, code: "ERR_VISUAL_CRITIC_PATCH_FACT_OVERRIDE" });
      continue;
    }

    const parsed = visualCriticPatchSchema.safeParse(raw);
    if (!parsed.success) {
      failures.push({ partitionId, code: "ERR_VISUAL_CRITIC_PATCH_INVALID" });
      continue;
    }
    const patch: VisualCriticPatch = parsed.data;

    const unknown = patch.annotations.find((annotation) => !byId.has(annotation.findingId));
    if (unknown !== undefined) {
      // Naming a finding that does not exist is how an invented observation
      // would enter the report, so the whole patch is refused rather than
      // partially kept.
      failures.push({ partitionId: patch.partitionId, code: "ERR_VISUAL_CRITIC_PATCH_UNKNOWN_FINDING" });
      continue;
    }

    for (const annotation of patch.annotations) {
      annotations.push(annotation);
      const target = merged.get(annotation.findingId)!;
      if (
        annotation.severity !== undefined &&
        options.allowSeverityEscalation === true &&
        SEVERITY_ORDER.indexOf(annotation.severity) > SEVERITY_ORDER.indexOf(target.severity)
      )
        merged.set(annotation.findingId, { ...target, severity: annotation.severity });
    }
    if (patch.summary !== undefined) summaries.push(patch.summary);
    applied += 1;
  }

  const result = [...merged.values()];
  // Severity is allowed to move; nothing else is. Proven, not asserted.
  if (measurementFingerprint(result) !== before)
    throw new Error("ERR_VISUAL_CRITIC_PATCH_INVENTED_FINDING: critic merge altered measured evidence");

  return { findings: result, annotations, summaries, failures, appliedPatchCount: applied };
}
