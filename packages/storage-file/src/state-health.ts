import { existsSync, readFileSync } from "node:fs";
import { isRecord } from "./store";

export const CURRENT_STORE_SCHEMA_VERSION = 1;

export type StateHealthStatus = "healthy" | "warning" | "failed";

export interface StateHealthReport {
  readonly status: StateHealthStatus;
  readonly schemaVersion?: number;
  readonly artifactCount: number;
  readonly payloadCount: number;
  readonly missingCollections: readonly string[];
  readonly detail: string;
}

const COLLECTIONS = [
  "executions", "lifecycleEvents", "checkpoints", "approvals", "events",
  "artifacts", "versions", "relations", "payloads", "traces", "sessions",
  "projects", "projectContexts", "agentMemories", "memoryProposals", "feedbackLoopParents",
] as const;

/**
 * Read-only state inspection. Unlike FileStore construction, this never
 * quarantines or rewrites a damaged file, so doctor can report recovery work
 * without changing the user's evidence.
 */
export function inspectStateFile(path: string): StateHealthReport {
  const empty = { artifactCount: 0, payloadCount: 0, missingCollections: [] as readonly string[] };
  if (!existsSync(path)) return { status: "warning", ...empty, detail: "The state file does not exist yet." };

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return { status: "failed", ...empty, detail: "The state file is not valid JSON; no mutation was attempted." };
  }
  if (!isRecord(parsed)) return { status: "failed", ...empty, detail: "The state file is not a JSON object; no mutation was attempted." };

  const version = parsed.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1)
    return { status: "failed", ...empty, detail: "The state file has no valid positive schema version." };
  if (version > CURRENT_STORE_SCHEMA_VERSION)
    return { status: "failed", schemaVersion: version, ...empty, detail: `State schema v${version} is newer than this CLI supports (v${CURRENT_STORE_SCHEMA_VERSION}).` };

  const missingCollections = COLLECTIONS.filter((key) => !(key in parsed));
  const artifacts = isRecord(parsed.artifacts) ? Object.keys(parsed.artifacts).length : 0;
  const payloads = isRecord(parsed.payloads) ? Object.keys(parsed.payloads).length : 0;
  const status: StateHealthStatus = missingCollections.length > 0 || version < CURRENT_STORE_SCHEMA_VERSION ? "warning" : "healthy";
  const detail = status === "healthy"
    ? `State schema v${version} is readable (${artifacts} artifacts, ${payloads} payloads).`
    : `State schema v${version} is readable with compatibility defaults${missingCollections.length > 0 ? ` for ${missingCollections.join(", ")}` : ""}.`;
  return { status, schemaVersion: version, artifactCount: artifacts, payloadCount: payloads, missingCollections, detail };
}
