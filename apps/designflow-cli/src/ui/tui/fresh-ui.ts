import {
  parseFigmaSource,
  type ParsedFigmaSource,
} from "@designflow/capability-figma-mcp";
import type { InteractiveDesign } from "../../services/figma-selection";

export type FreshUiState =
  | { readonly status: "selecting" }
  | {
      readonly status: "ready-to-generate";
      readonly design: InteractiveDesign;
      readonly source: ParsedFigmaSource;
      readonly nodeId: string;
    };

export class FreshUiSourceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "FreshUiSourceError";
  }
}

export function initialFreshUiState(): FreshUiState {
  return { status: "selecting" };
}

/**
 * Fresh UI's stricter frame contract. The generic parser remains unchanged so
 * legacy callers can continue to accept file-level sources and frame lists.
 */
export function readyFreshUiState(
  design: InteractiveDesign,
): Extract<FreshUiState, { readonly status: "ready-to-generate" }> {
  let source: ParsedFigmaSource;
  try {
    source = parseFigmaSource(design.designFile);
  } catch {
    throw new FreshUiSourceError("Invalid Figma source. Use a Figma frame URL.");
  }

  if (source.nodeIds.length !== 1) {
    throw new FreshUiSourceError(
      "Fresh UI requires exactly one Figma frame node ID in the source URL.",
    );
  }

  const nodeId = source.nodeIds[0];
  if (nodeId === undefined) {
    throw new FreshUiSourceError(
      "Fresh UI requires exactly one Figma frame node ID in the source URL.",
    );
  }

  return {
    status: "ready-to-generate",
    design,
    source,
    nodeId,
  };
}

export function transitionFreshUi(
  state: FreshUiState,
  design: InteractiveDesign,
): FreshUiState {
  if (state.status === "ready-to-generate") return readyFreshUiState(design);
  return readyFreshUiState(design);
}
