import {
  figmaDesktopSelectionSource,
  parseFigmaSource,
  type FigmaDesktopSelection,
} from "@designflow/capability-figma-mcp";

export type InteractiveDesignKind = "current-selection" | "url";

/** The small product-level value carried from the shell into `runCommand`. */
export interface InteractiveDesign {
  readonly kind: InteractiveDesignKind;
  readonly label: string;
  readonly designFile: string;
  readonly frames: readonly string[];
}

export function designFromCurrentSelection(selection: FigmaDesktopSelection): InteractiveDesign {
  return {
    kind: "current-selection",
    label: `Current Figma selection — ${selection.name}`,
    designFile: figmaDesktopSelectionSource(selection),
    frames: [selection.name],
  };
}

/**
 * Validates pasted input through the canonical Figma parser. The parsed value
 * is intentionally not copied into a second source model; only the original
 * validated input and frame bindings needed by the existing worker manifest
 * are carried forward.
 */
export function designFromUrl(input: string): InteractiveDesign {
  const parsed = parseFigmaSource(input);
  return {
    kind: "url",
    label: "Pasted Figma design",
    designFile: parsed.originalInput,
    frames: [],
  };
}
