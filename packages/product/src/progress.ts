// packages/product/src/progress.ts
import { executionProgressSchema } from "./schemas";
import type { ExecutionProgress, ProgressStep } from "./schemas";
import type { ExecutionEvent } from "@designflow/sdk";

/**
 * Turns a capability id into something a person can read.
 *
 * `cap-extract-design-tokens` becomes "Extract design tokens". Deliberately
 * mechanical: no attempt is made to conjugate it into "Extracting…", because
 * guessing grammar from an identifier produces worse text than leaving it
 * plain, and tense belongs to the renderer anyway.
 */
export function humanizeCapabilityId(capabilityId: string): string {
  const words = capabilityId
    .replace(/^cap[-_]/i, "")
    .split(/[-_.\s]+/)
    .filter((word) => word.length > 0);

  if (words.length === 0) return capabilityId;

  const sentence = words.join(" ").toLowerCase();
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

function readString(
  event: ExecutionEvent,
  key: string,
): string | undefined {
  const value = event.payload?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readIdCount(event: ExecutionEvent, key: string): number | undefined {
  const value = event.payload?.[key];
  return Array.isArray(value) ? value.length : undefined;
}

/**
 * Projects the event stream into a progress model.
 *
 * Derived from the same events Stage 27's narration reads — this is a second
 * projection of one stream, not a second state machine. The engine remains the
 * only thing that knows what a run is doing; this only rephrases it.
 *
 * Step identity is the capability id, which is what `capability.started` and
 * `capability.completed` carry. Two nodes running the same capability appear as
 * two steps, in order, which is what a reader expects.
 *
 * `plannedTotal` is the step count the run intends to execute, when something
 * knows it — the planner's `execution.plan_created`, or the workflow
 * definition. Without it, `total` is inferred from the steps observed so far,
 * so progress never claims to know a denominator it does not have.
 */
export function buildProgress(
  events: readonly ExecutionEvent[],
  plannedTotal?: number,
): ExecutionProgress {
  const steps: ProgressStep[] = [];
  const active: string[] = [];

  let completedCount = 0;
  let terminal = false;
  let planTotal = plannedTotal;

  for (const event of events) {
    switch (event.type) {
      case "execution.plan_created": {
        // The planner knows exactly how many steps this run will execute.
        const executing = readIdCount(event, "executionNodes");
        const skipped = readIdCount(event, "skippedNodes") ?? 0;

        if (executing !== undefined) planTotal = executing + skipped;
        break;
      }

      case "capability.started": {
        const capabilityId = readString(event, "capabilityId");
        if (capabilityId === undefined) break;

        active.push(capabilityId);
        steps.push({
          label: humanizeCapabilityId(capabilityId),
          status: "active",
          capabilityId,
        });
        break;
      }

      case "capability.completed": {
        const capabilityId = readString(event, "capabilityId");
        if (capabilityId === undefined) break;

        const index = steps.findIndex(
          (step) =>
            step.capabilityId === capabilityId && step.status === "active",
        );

        if (index >= 0) {
          const step = steps[index];
          if (step !== undefined) {
            steps[index] = { ...step, status: "done" };
          }
        } else {
          steps.push({
            label: humanizeCapabilityId(capabilityId),
            status: "done",
            capabilityId,
          });
        }

        const activeIndex = active.indexOf(capabilityId);
        if (activeIndex >= 0) active.splice(activeIndex, 1);

        completedCount++;
        break;
      }

      case "artifact.reused": {
        // A node whose work was reused never emits capability events, but it
        // is done as far as a reader is concerned.
        const capabilityId = readString(event, "capabilityId");
        if (capabilityId === undefined) break;

        const alreadyListed = steps.some(
          (step) => step.capabilityId === capabilityId,
        );
        if (alreadyListed) break;

        steps.push({
          label: humanizeCapabilityId(capabilityId),
          status: "done",
          capabilityId,
        });
        completedCount++;
        break;
      }

      case "execution.completed":
      case "execution.failed":
      case "execution.cancelled":
        terminal = true;
        break;

      default:
        break;
    }
  }

  // Nothing is left running once the execution has stopped, whatever the last
  // capability event happened to be.
  if (terminal) {
    for (let index = 0; index < steps.length; index++) {
      const step = steps[index];
      if (step?.status === "active") {
        steps[index] = { ...step, status: "pending" };
      }
    }
    active.length = 0;
  }

  const observedTotal = Math.max(steps.length, completedCount);
  const total = Math.max(planTotal ?? observedTotal, observedTotal);
  const completed = Math.min(completedCount, total);

  const currentStep = active[active.length - 1];

  return executionProgressSchema.parse({
    completed,
    total,
    // A run with no known steps is 0%, not 100% — claiming completeness for an
    // empty denominator would read as "done" before anything happened.
    percent: total === 0 ? 0 : Math.round((completed / total) * 100),
    ...(currentStep !== undefined
      ? { currentStep: humanizeCapabilityId(currentStep) }
      : {}),
    steps: [
      ...steps,
      // Steps the planner counted but that have not been seen yet.
      ...Array.from({ length: Math.max(0, total - steps.length) }, () => ({
        label: "Pending step",
        status: "pending" as const,
      })),
    ],
  });
}

/** Reported for completeness by callers that want the skipped-node count. */
export function countSkippedSteps(events: readonly ExecutionEvent[]): number {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (event?.type !== "execution.plan_created") continue;

    return readIdCount(event, "skippedNodes") ?? 0;
  }

  return 0;
}
