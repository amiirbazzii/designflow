import { executionTimelineSchema, timelineEntrySchema } from "./schemas";
import type { ExecutionTimeline, NarrationEntry, TimelineEntry } from "./schemas";

/** Zero-padded UTC `HH:MM` for a timestamp. */
function clockLabel(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/**
 * Builds the timeline from narrated events.
 *
 * Derived, never stored: the timeline is a projection of the same event stream
 * the narration comes from, so the two can never disagree and there is no
 * second state to keep in sync.
 *
 * Entries are ordered by timestamp. Events published within the same
 * millisecond keep their published order, which is the order the engine
 * actually did the work — sorting alone would make that arbitrary.
 */
export function buildTimeline(
  executionId: string,
  startedAt: number,
  narration: readonly NarrationEntry[],
): ExecutionTimeline {
  const ordered = narration
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const byTime = left.entry.timestamp - right.entry.timestamp;
      return byTime !== 0 ? byTime : left.index - right.index;
    });

  const entries: TimelineEntry[] = ordered.map(({ entry }) =>
    timelineEntrySchema.parse({
      timestamp: entry.timestamp,
      at: clockLabel(entry.timestamp),
      // Clamped: an event stamped before the record's start would otherwise
      // produce a negative offset and fail the schema.
      offsetMs: Math.max(0, entry.timestamp - startedAt),
      kind: entry.kind,
      label: entry.message,
    }),
  );

  return executionTimelineSchema.parse({
    executionId,
    startedAt,
    entries,
  });
}
