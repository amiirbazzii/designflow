// packages/agents/src/design-interpreter/semantic-partitioner.ts
//
// Deterministic partitioning of a Blueprint into bounded semantic-enrichment
// requests.
//
// The legacy Specification path asked one model call to author an entire
// design document, and every failure mode that followed — truncation at the
// output ceiling, a 91-second generation, a repair attempt that blew the
// candidate budget — came from that single unbounded request. V2 never makes
// one: semantics are requested per top-level region and per component family,
// each request carrying only the entities it may annotate.
//
// Partitioning is deterministic (same Blueprint → same partitions, same
// order), so a merge is reproducible and a failed partition can be retried or
// dropped without disturbing the others.
import type { UIBlueprint } from "@designflow/sdk";

/** Element budget per partition, measured against the Spendly fixture. */
export const MAX_PARTITION_ELEMENTS = 40;
/** Serialized request budget per partition, in bytes. */
export const MAX_PARTITION_BYTES = 24_000;

export interface BlueprintPartition {
  readonly id: string;
  readonly kind: "region" | "component";
  readonly title: string;
  /** The only ids a patch answering this partition may annotate. */
  readonly allowedElementIds: readonly string[];
  readonly allowedComponentIds: readonly string[];
  /** Compact facts for exactly those entities — never the whole Blueprint. */
  readonly context: unknown;
  readonly serializedBytes: number;
}

function encodedLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/** The compact per-element view an interpreter needs to judge meaning. */
function elementContext(blueprint: UIBlueprint, elementId: string): unknown {
  const element = blueprint.elements.find((entry) => entry.id === elementId);
  if (element === undefined) return undefined;
  // A component instance's own copy lives on the component, not as separate
  // elements — and it is exactly what distinguishes "Amount field" from
  // "Card selector". Without it the interpreter would be judging purpose from
  // a layer name alone, which is how a guess gets labelled as evidence.
  const instanceContents =
    element.facts.componentRef === undefined
      ? undefined
      : blueprint.components
          .find((component) => component.name === element.facts.componentRef)
          ?.instances.find((instance) => instance.elementId === element.id)
          ?.contents.map((slot) => slot.text ?? slot.name)
          .filter((entry): entry is string => entry !== undefined)
          .slice(0, 8);

  return {
    ...(instanceContents !== undefined && instanceContents.length > 0 ? { contents: instanceContents } : {}),
    id: element.id,
    parentId: element.parentId,
    order: element.order,
    name: element.facts.name,
    nodeType: element.facts.nodeType,
    text: element.facts.text,
    size:
      element.facts.widthPx !== undefined || element.facts.heightPx !== undefined
        ? `${element.facts.widthPx ?? "?"}x${element.facts.heightPx ?? "?"}`
        : undefined,
    componentRef: element.facts.componentRef,
    layoutDirection: element.facts.layout?.direction,
  };
}

function descendantIds(blueprint: UIBlueprint, rootId: string): string[] {
  const childrenByParent = new Map<string, string[]>();
  for (const element of blueprint.elements) {
    if (element.parentId === undefined) continue;
    childrenByParent.set(element.parentId, [...(childrenByParent.get(element.parentId) ?? []), element.id]);
  }
  const collected: string[] = [];
  const walk = (id: string): void => {
    collected.push(id);
    for (const child of childrenByParent.get(id) ?? []) walk(child);
  };
  walk(rootId);
  return collected;
}

/** Splits an oversized member list into stable, bounded chunks. */
function chunk(ids: readonly string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += size) {
    chunks.push([...ids.slice(index, index + size)]);
  }
  return chunks.length > 0 ? chunks : [[]];
}

/**
 * Partitions a Blueprint draft into bounded enrichment requests: one per
 * top-level region of the screen, plus one per component family.
 */
export function partitionBlueprintForEnrichment(blueprint: UIBlueprint): readonly BlueprintPartition[] {
  const partitions: BlueprintPartition[] = [];
  const root = blueprint.screen.rootElementId;
  const topLevel = blueprint.elements
    .filter((element) => element.parentId === root)
    .sort((left, right) => left.order - right.order);

  const regionRoots = topLevel.length > 0 ? topLevel : blueprint.elements.filter((element) => element.id === root);

  for (const regionRoot of regionRoots) {
    const members = descendantIds(blueprint, regionRoot.id);
    const parts = chunk(members, MAX_PARTITION_ELEMENTS);
    parts.forEach((memberIds, index) => {
      const context = {
        screen: {
          name: blueprint.screen.name,
          widthPx: blueprint.screen.widthPx,
          heightPx: blueprint.screen.heightPx,
        },
        region: { rootElementId: regionRoot.id, name: regionRoot.facts.name },
        elements: memberIds.map((id) => elementContext(blueprint, id)).filter((entry) => entry !== undefined),
      };
      partitions.push({
        id: parts.length > 1 ? `region:${regionRoot.id}#${index + 1}` : `region:${regionRoot.id}`,
        kind: "region",
        title: regionRoot.facts.name ?? regionRoot.id,
        allowedElementIds: memberIds,
        allowedComponentIds: [],
        context,
        serializedBytes: encodedLength(context),
      });
    });
  }

  for (const component of blueprint.components) {
    const instanceElementIds = component.instances.map((instance) => instance.elementId);
    const context = {
      component: {
        id: component.id,
        name: component.name,
        anatomy: component.anatomy,
        properties: component.properties,
        observedVariants: component.observedVariants,
        instances: component.instances.map((instance) => ({
          elementId: instance.elementId,
          name: instance.name,
          propertyValues: instance.propertyValues,
          contents: instance.contents.map((slot) => ({ name: slot.name, text: slot.text })),
        })),
      },
    };
    partitions.push({
      id: `component:${component.id}`,
      kind: "component",
      title: component.name,
      allowedElementIds: instanceElementIds,
      allowedComponentIds: [component.id],
      context,
      serializedBytes: encodedLength(context),
    });
  }

  return partitions;
}
