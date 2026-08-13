// packages/agents/src/ui-builder/proposal-response-schema.ts
import type { JsonSchemaObject } from "@designflow/sdk";

const text = { type: "string" } as const;
const strings = { type: "array", items: text } as const;

/**
 * The provider-facing wire shape for a Builder proposal.
 *
 * Same portable strict subset every other agent uses — flat closed objects,
 * every property required, nullable scalars only. It carries file operations
 * and nothing else: no approval, no command execution, no project paths
 * outside the ones the request already authorized. The deterministic layer
 * normalizes this into the existing `ProposedFileChanges` contract, so the
 * proposal the safety gates see is the same shape they have always seen.
 */
export const builderProposalResponseSchema: JsonSchemaObject = {
  type: "object",
  additionalProperties: false,
  properties: {
    files: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: text,
          action: { type: "string", enum: ["create", "modify"] },
          content: text,
          reason: text,
          relatedDesignNodeIds: strings,
        },
        required: ["path", "action", "content", "reason", "relatedDesignNodeIds"],
      },
    },
    assumptions: strings,
    unresolvedItems: strings,
    /** Set when the plan cannot be executed as decided — never a silent re-plan. */
    unexecutableReason: { type: ["string", "null"] },
  },
  required: ["files", "assumptions", "unresolvedItems", "unexecutableReason"],
};
