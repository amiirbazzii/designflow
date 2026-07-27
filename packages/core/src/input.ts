// packages/core/src/input.ts
import { z } from "zod";
import { workflowInputRefSchema } from "@designflow/sdk";

const inputRecordSchema = z.record(z.string(), z.unknown());

/**
 * Resolves a node's declared `inputMap` against the enclosing workflow's
 * input.
 *
 * A `{ $workflowInput: true | "key" }` token is replaced by the workflow
 * input (or one of its properties). The token is honoured both as the whole
 * `inputMap` and as any of its top-level values; everything else passes
 * through untouched.
 */
export function resolveNodeInput(
  inputMap: Readonly<Record<string, unknown>>,
  workflowInput: unknown,
): unknown {
  const whole = workflowInputRefSchema.safeParse(inputMap);
  if (whole.success) {
    return selectWorkflowInput(whole.data.$workflowInput, workflowInput);
  }

  const resolved: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(inputMap)) {
    const ref = workflowInputRefSchema.safeParse(value);
    resolved[key] = ref.success
      ? selectWorkflowInput(ref.data.$workflowInput, workflowInput)
      : value;
  }

  return resolved;
}

function selectWorkflowInput(
  selector: true | string,
  workflowInput: unknown,
): unknown {
  if (selector === true) {
    return workflowInput;
  }

  const record = inputRecordSchema.safeParse(workflowInput);
  return record.success ? record.data[selector] : undefined;
}
