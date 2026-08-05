// packages/sdk/src/reuse-identity.ts
import { z } from "zod";

/**
 * The identity a reuse decision must respect beyond a node's own resolved
 * input and its dependency versions.
 *
 * Everything here is optional: a host that never sets it (an in-memory test
 * harness, a workflow with no project concept) gets the exact fingerprint
 * behaviour it always had. A host that does set it — the CLI, threading a
 * session's `projectId` and a fingerprint of that project's current facts —
 * makes two operations that differ only in project, model profile or agent
 * version compute different reuse fingerprints, even when their raw input is
 * byte-identical.
 */
export const reuseIdentitySchema = z.object({
  /** The registered project this run is scoped to, if any. */
  projectId: z.string().min(1).optional(),
  /**
   * A content fingerprint of the project's current facts, so a change to the
   * project (framework, source root, design system path, ...) invalidates
   * artifacts derived from it, without the engine ever reading project data
   * itself.
   */
  projectContextFingerprint: z.string().min(1).optional(),
  /** The model profile in effect, when a node's output can depend on a model call. */
  modelProfileId: z.string().min(1).optional(),
  /** The deciding agent's manifest version, for the same reason. */
  agentVersion: z.string().min(1).optional(),
  /** Figma retrieval mode is part of cache identity; placeholder and MCP data never mix. */
  figmaSourceMode: z.enum(["placeholder", "rest", "mcp-stdio", "mcp-desktop"]).optional(),
  figmaServerIdentity: z.string().min(1).optional(),
  figmaFileKey: z.string().min(1).optional(),
  figmaRequestedNodeId: z.string().min(1).optional(),
  figmaResolvedNodeId: z.string().min(1).optional(),
  figmaFrames: z.array(z.string().min(1)).optional(),
  figmaCaptureScreenshots: z.boolean().optional(),
  /** Per-run nonce used only by an explicit --no-cache acceptance/request. */
  figmaCacheBypass: z.string().min(1).optional(),
});

export type ReuseIdentity = z.infer<typeof reuseIdentitySchema>;

/**
 * Bumped only when the reuse *scheme* itself changes — what gets fingerprinted,
 * not what the fingerprint happens to be this run. Folded into every fingerprint
 * unconditionally, so artifacts produced under a previous scheme never satisfy
 * an equality check under this one: there is no stored fingerprint for them to
 * match, because the value being matched did not exist yet when they were made.
 * That is what makes pre-Stage-1 artifacts safely non-reusable without a
 * separate migration pass.
 */
export const REUSE_SCHEMA_VERSION = "1";

/** Reserved key under which a run's reuse identity travels in execution metadata. */
export const REUSE_IDENTITY_METADATA_KEY = "reuseIdentity";

/** The reuse identity a run's metadata carries, if any part of it was set. */
export function readReuseIdentity(
  metadata: Readonly<Record<string, unknown>> | undefined,
): ReuseIdentity | undefined {
  const parsed = reuseIdentitySchema.safeParse(
    metadata?.[REUSE_IDENTITY_METADATA_KEY],
  );

  if (!parsed.success) return undefined;

  const hasAnyField = Object.values(parsed.data).some(
    (value) => value !== undefined,
  );

  return hasAnyField ? parsed.data : undefined;
}

/** Returns a new metadata bag carrying `identity` under the reserved key. */
export function withReuseIdentity(
  metadata: Readonly<Record<string, unknown>> | undefined,
  identity: ReuseIdentity,
): Record<string, unknown> {
  return {
    ...metadata,
    [REUSE_IDENTITY_METADATA_KEY]: reuseIdentitySchema.parse(identity),
  };
}
