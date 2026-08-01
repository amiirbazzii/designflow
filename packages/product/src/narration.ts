// packages/product/src/narration.ts
import {
  narrationEntrySchema,
  type NarrationEntry,
  type NarrationKind,
} from "./schemas";

import type { ExecutionEvent } from "@designflow/sdk";

/**
 * Turns the raw event stream into a story a person can read.
 *
 * Purely additive: raw events are untouched and remain the record of what
 * happened. This is a second, lossy view optimised for comprehension.
 */

interface Narration {
  readonly kind: NarrationKind;
  readonly message: string;
}

/** Events that carry no meaning on their own and would only add noise. */
const SILENT_EVENT_TYPES = new Set<string>([
  "artifact.version_created",
  "artifact.relation_added",
  "artifact.materialized",
  "capability.started",
]);

/**
 * Event types whose repetition is aggregated into a single counted line.
 *
 * A run reusing eight artifacts should read "Reused 8 existing artifacts", not
 * eight identical sentences.
 */
const AGGREGATED_EVENT_TYPES = new Set<string>([
  "artifact.created",
  "artifact.reused",
  "capability.completed",
]);

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function readString(
  payload: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  const value = payload?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(
  payload: Readonly<Record<string, unknown>> | undefined,
  key: string,
): number | undefined {
  const value = payload?.[key];
  return typeof value === "number" ? value : undefined;
}

function readCount(
  payload: Readonly<Record<string, unknown>> | undefined,
  key: string,
): number {
  const value = payload?.[key];
  return Array.isArray(value) ? value.length : 0;
}

/**
 * The sentence for a single event, or null when it should not appear.
 *
 * `count` is how many consecutive events of this type were folded together.
 */
function describe(event: ExecutionEvent, count: number): Narration | null {
  const payload = event.payload;

  switch (event.type) {
    case "execution.started":
      return { kind: "lifecycle", message: "Started workflow" };

    case "execution.planning":
      return { kind: "lifecycle", message: "Planning workflow" };

    case "execution.plan_created": {
      const skipped = readCount(payload, "skippedNodes");
      const executing = readCount(payload, "executionNodes");

      return {
        kind: "planning",
        message:
          skipped > 0
            ? `Analyzed dependencies — ${pluralize(executing, "step", "steps")} to run, ${skipped} up to date`
            : `Analyzed dependencies — ${pluralize(executing, "step", "steps")} to run`,
      };
    }

    case "execution.executing":
      return { kind: "lifecycle", message: "Running workflow steps" };

    case "capability.completed":
      return {
        kind: "artifact",
        message: `Completed ${pluralize(count, "step", "steps")}`,
      };

    case "capability.failed": {
      const capabilityId = readString(payload, "capabilityId");
      return {
        kind: "failure",
        message:
          capabilityId !== undefined
            ? `Step failed: ${capabilityId}`
            : "A step failed",
      };
    }

    case "artifact.created":
      return {
        kind: "artifact",
        message: `Generated ${pluralize(count, "new artifact", "new artifacts")}`,
      };

    case "artifact.reused":
      return {
        kind: "artifact",
        message: `Reused ${pluralize(count, "existing artifact", "existing artifacts")}`,
      };

    case "execution.validating":
      return { kind: "lifecycle", message: "Validating results" };

    case "execution.reconciled": {
      const added = readNumber(payload, "added") ?? 0;
      const reused = readNumber(payload, "reused") ?? 0;
      const removed = readNumber(payload, "removed") ?? 0;

      const parts: string[] = [];
      if (added > 0) parts.push(`${added} added`);
      if (reused > 0) parts.push(`${reused} reused`);
      if (removed > 0) parts.push(`${removed} removed`);

      return {
        kind: "reconciliation",
        message:
          parts.length > 0
            ? `Validated final artifact state — ${parts.join(", ")}`
            : "Validated final artifact state",
      };
    }

    case "execution.applying":
      return { kind: "lifecycle", message: "Applying results" };

    case "execution.completed":
      return { kind: "lifecycle", message: "Completed successfully" };

    case "execution.failed": {
      const reason = readString(payload, "reason");
      return {
        kind: "failure",
        message: reason !== undefined ? `Failed: ${reason}` : "Failed",
      };
    }

    case "execution.cancelled":
      return { kind: "failure", message: "Cancelled" };

    case "execution.policy_denied":
      return { kind: "failure", message: "Blocked by execution policy" };

    case "execution.waiting_approval": {
      const reason = readString(payload, "reason");
      return {
        kind: "approval",
        message:
          reason !== undefined
            ? `Waiting for approval — ${reason}`
            : "Waiting for approval",
      };
    }

    case "execution.approval_approved":
      return { kind: "approval", message: "Approved, resuming" };

    case "execution.approval_rejected":
      return { kind: "approval", message: "Approval rejected" };

    case "workflow.child_started": {
      const childWorkflowId = readString(payload, "childWorkflowId");
      return {
        kind: "lifecycle",
        message:
          childWorkflowId !== undefined
            ? `Started nested workflow ${childWorkflowId}`
            : "Started a nested workflow",
      };
    }

    case "workflow.child_completed":
      return { kind: "lifecycle", message: "Nested workflow completed" };

    case "workflow.child_failed":
      return { kind: "failure", message: "Nested workflow failed" };

    default:
      return null;
  }
}

/**
 * Narrates an execution's events in order.
 *
 * Consecutive events of an aggregated type collapse into one counted line, so
 * a run that reused eight artifacts reads as one sentence rather than eight.
 * The line is stamped with the timestamp of the *first* event in the group,
 * which is when that phase of the run actually began.
 */
export function narrateEvents(
  events: readonly ExecutionEvent[],
): readonly NarrationEntry[] {
  const entries: NarrationEntry[] = [];

  // Silent events are dropped *before* grouping, not during it. Left in place
  // they break a run of identical events apart — a reused artifact is
  // announced right after the `artifact.materialized` that validated it, so
  // three reuses would narrate as three separate lines instead of one.
  const audible = events.filter((event) => !SILENT_EVENT_TYPES.has(event.type));

  let index = 0;

  while (index < audible.length) {
    const event = audible[index];

    if (event === undefined) break;

    let groupSize = 1;

    if (AGGREGATED_EVENT_TYPES.has(event.type)) {
      while (
        index + groupSize < audible.length &&
        audible[index + groupSize]?.type === event.type
      ) {
        groupSize++;
      }
    }

    const narration = describe(event, groupSize);

    if (narration !== null) {
      const sourceEventTypes: string[] = [];
      for (let offset = 0; offset < groupSize; offset++) {
        const source = audible[index + offset];
        if (source !== undefined) sourceEventTypes.push(source.type);
      }

      entries.push(
        narrationEntrySchema.parse({
          timestamp: event.timestamp,
          kind: narration.kind,
          message: narration.message,
          sourceEventTypes,
        }),
      );
    }

    index += groupSize;
  }

  return entries;
}
