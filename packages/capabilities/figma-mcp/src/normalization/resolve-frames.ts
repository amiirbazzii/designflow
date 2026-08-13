// packages/capabilities/figma-mcp/src/resolve-frames.ts
import type { FigmaNodeSnapshot } from "@designflow/sdk";

/**
 * Deterministic frame/node resolution — no fuzzy matching, ever.
 *
 * Priority order, applied once per requested identifier:
 *
 *   1. an explicit node id from the parsed URL — always wins, since the
 *      user (or Figma's own share link) already named an exact node;
 *   2. an exact full-path match (`layout/Dashboard`);
 *   3. an exact frame-name match;
 *   4. a case-insensitive exact match;
 *   5. otherwise: ambiguous (more than one candidate) or missing (zero) —
 *      both are reported structurally, never silently resolved to "the
 *      whole document" or to a guess.
 */

export interface ResolvedFrame {
  readonly id: string;
  readonly name: string;
  readonly path: readonly string[];
}

export interface FrameAmbiguity {
  readonly requested: string;
  readonly candidates: readonly ResolvedFrame[];
}

export interface FrameResolutionResult {
  readonly resolved: readonly ResolvedFrame[];
  readonly ambiguities: readonly FrameAmbiguity[];
  readonly missing: readonly string[];
}

/** Builds each node's full path (root-to-node names), for path-based matching and for `resolvedFrames`. */
function pathOf(node: FigmaNodeSnapshot, byId: ReadonlyMap<string, FigmaNodeSnapshot>): string[] {
  const path: string[] = [node.name];
  let current = node;

  // Bounded by the map's size — a cyclic parentId chain (which should never
  // occur in real Figma data) cannot spin this loop forever.
  for (let hops = 0; hops < byId.size; hops++) {
    if (current.parentId === undefined) break;
    const parent = byId.get(current.parentId);
    if (parent === undefined) break;
    path.unshift(parent.name);
    current = parent;
  }

  return path;
}

/**
 * Resolves explicit node ids and requested frame names/paths against a set
 * of nodes, following the priority rules above.
 *
 * Hidden nodes (`visible === false`) are still resolvable by explicit node
 * id — an id the user or a share link already named exactly is honoured
 * regardless of visibility — but are excluded from name/path matching, so a
 * name that collides with a hidden node's name resolves to the visible one
 * instead of silently picking the hidden one.
 */
export function resolveFigmaFrames(
  nodes: readonly FigmaNodeSnapshot[],
  explicitNodeIds: readonly string[],
  requestedFrames: readonly string[],
): FrameResolutionResult {
  const byId = new Map(nodes.map((node) => [node.id, node] as const));
  const visibleNodes = nodes.filter((node) => node.visible !== false);

  const resolved: ResolvedFrame[] = [];
  const ambiguities: FrameAmbiguity[] = [];
  const missing: string[] = [];
  const seenIds = new Set<string>();

  const addResolved = (node: FigmaNodeSnapshot): void => {
    if (seenIds.has(node.id)) return;
    seenIds.add(node.id);
    resolved.push({ id: node.id, name: node.name, path: pathOf(node, byId) });
  };

  for (const nodeId of explicitNodeIds) {
    const node = byId.get(nodeId);
    if (node === undefined) {
      missing.push(nodeId);
      continue;
    }
    addResolved(node);
  }

  for (const requested of requestedFrames) {
    const fullPathMatches = visibleNodes.filter(
      (node) => pathOf(node, byId).join("/") === requested,
    );
    if (fullPathMatches.length === 1) {
      addResolved(fullPathMatches[0]!);
      continue;
    }
    if (fullPathMatches.length > 1) {
      ambiguities.push({
        requested,
        candidates: fullPathMatches.map((node) => ({ id: node.id, name: node.name, path: pathOf(node, byId) })),
      });
      continue;
    }

    const exactNameMatches = visibleNodes.filter((node) => node.name === requested);
    if (exactNameMatches.length === 1) {
      addResolved(exactNameMatches[0]!);
      continue;
    }
    if (exactNameMatches.length > 1) {
      ambiguities.push({
        requested,
        candidates: exactNameMatches.map((node) => ({ id: node.id, name: node.name, path: pathOf(node, byId) })),
      });
      continue;
    }

    const caseInsensitiveMatches = visibleNodes.filter(
      (node) => node.name.toLowerCase() === requested.toLowerCase(),
    );
    if (caseInsensitiveMatches.length === 1) {
      addResolved(caseInsensitiveMatches[0]!);
      continue;
    }
    if (caseInsensitiveMatches.length > 1) {
      ambiguities.push({
        requested,
        candidates: caseInsensitiveMatches.map((node) => ({
          id: node.id,
          name: node.name,
          path: pathOf(node, byId),
        })),
      });
      continue;
    }

    missing.push(requested);
  }

  return { resolved, ambiguities, missing };
}
