// packages/agents/src/design-interpreter/semantic-patch-response-schema.ts
import type { JsonSchemaObject } from "@designflow/sdk";

const text = { type: "string" } as const;
const strings = { type: "array", items: text } as const;

// ── UI Semantic Patch provider wire shape (V2-1) ────────────────

//
// The smallest provider contract in the product, and deliberately so: a patch
// carries meaning only. There is no property here capable of holding a
// dimension, a color, a radius, a font, a variant or a line of copy — a model
// physically cannot restate (or corrupt) a compiled design fact through this
// schema. Same portable strict subset as every other wire schema: flat closed
// objects, every property required, nullable scalars only.
const patchAnnotationProperties = {
  role: {
    type: ["string", "null"],
    enum: [
      "header", "heading", "body_text", "form", "form_control", "action", "tabs",
      "navigation", "list", "list_item", "card", "icon", "image", "container", "unknown", null,
    ],
  },
  purpose: { type: ["string", "null"] },
  interactionKind: {
    type: ["string", "null"],
    enum: [
      "none", "text_entry", "selection", "navigation", "submit", "toggle",
      "tab_switch", "pagination", "unknown", null,
    ],
  },
  importance: { type: ["string", "null"], enum: ["primary", "secondary", "supporting", null] },
  confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
  evidenceBasis: {
    type: ["string", "null"],
    enum: ["explicit_design_evidence", "component_metadata", "visual_inference", "semantic_inference", null],
  },
} as const;

const annotationRequired = ["role", "purpose", "interactionKind", "importance", "confidence", "evidenceBasis"] as const;

export const uiSemanticPatchResponseSchema: JsonSchemaObject = {
  type: "object",
  additionalProperties: false,
  properties: {
    elementAnnotations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { elementId: text, ...patchAnnotationProperties },
        required: ["elementId", ...annotationRequired],
      },
    },
    componentAnnotations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { componentId: text, ...patchAnnotationProperties },
        required: ["componentId", ...annotationRequired],
      },
    },
    regionAnnotations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: text,
          memberElementIds: strings,
          anchorElementId: { type: ["string", "null"] },
          ...patchAnnotationProperties,
        },
        required: ["name", "memberElementIds", "anchorElementId", ...annotationRequired],
      },
    },
    relationships: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", enum: ["labels", "describes", "controls", "submits", "navigates_to", "groups"] },
          fromId: text,
          toId: text,
          evidenceBasis: {
            type: "string",
            enum: ["explicit_design_evidence", "component_metadata", "visual_inference", "semantic_inference"],
          },
          confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
        },
        required: ["kind", "fromId", "toId", "evidenceBasis", "confidence"],
      },
    },
    uncertainties: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          code: text,
          description: text,
          affectedIds: strings,
          requiresUserInput: { type: "boolean" },
        },
        required: ["code", "description", "affectedIds", "requiresUserInput"],
      },
    },
  },
  required: ["elementAnnotations", "componentAnnotations", "regionAnnotations", "relationships", "uncertainties"],
};
