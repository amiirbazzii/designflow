import { designSystemMappingSchema, designSpecificationSchema, projectImplementationContextV1Schema, type DesignSystemMapping } from "@designflow/sdk";

const threshold = 0.8;
const normal = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

export function mapDesignSystem(rawSpecification: unknown, rawContext: unknown): DesignSystemMapping {
  const specification = designSpecificationSchema.parse(rawSpecification);
  const context = projectImplementationContextV1Schema.parse(rawContext);
  const tokenMappings = [...specification.designTokens.colors, ...specification.designTokens.spacing, ...specification.designTokens.typography, ...specification.designTokens.radii, ...specification.designTokens.shadows].map((token) => {
    const match = context.designSystem.tokens.find((candidate) => normal(candidate.name) === normal(token) || normal(candidate.reference) === normal(token));
    return match ? { designTokenId: token, projectTokenReference: match.reference, confidence: 1, action: "reuse" as const, reason: "Exact normalized token reference match." } : { designTokenId: token, confidence: 0, action: "create" as const, reason: "No project token with a safe exact match was observed." };
  });
  const componentMappings = specification.components.map((component) => {
    const candidates = context.designSystem.components.map((candidate) => ({ candidate, score: normal(candidate.name) === normal(component.name) ? 1 : normal(candidate.name).includes(normal(component.name)) || normal(component.name).includes(normal(candidate.name)) ? 0.6 : 0 }));
    const best = candidates.sort((a,b) => b.score - a.score || a.candidate.name.localeCompare(b.candidate.name))[0];
    if (!best || best.score === 0) return { designComponentId: component.name, confidence: 0, action: "create" as const, reason: "No reusable project component matched." };
    if (best.score < threshold || !best.candidate.safeToReuse) return { designComponentId: component.name, confidence: best.score, action: "manual-review" as const, reason: "A possible match exists below the safe reuse threshold." };
    return { designComponentId: component.name, projectComponentReference: best.candidate.name, confidence: best.score, action: "reuse" as const, reason: "Existing component name matched exactly." };
  });
  const assetMappings = specification.assets.map((asset) => ({ designAssetId: asset.id, action: "manual-review" as const, reason: `No project asset index entry was found for ${asset.name}.` }));
  const unresolved = componentMappings.filter((item) => item.action === "manual-review").map((item) => ({ code: "LOW_CONFIDENCE_COMPONENT", description: item.reason, requiresUserInput: true }));
  return designSystemMappingSchema.parse({ schemaVersion: "1", tokenMappings, componentMappings, assetMappings, unresolved });
}
