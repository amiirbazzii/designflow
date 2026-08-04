import { DesignFlowError, type JsonSchemaObject, type SpecializedAgentContext } from "@designflow/sdk";
import { SpecializedAgentOutputInvalidError } from "./errors";

const MAX_REPAIR_CONTEXT_BYTES = 50_000;

function validationIssues(error: unknown): readonly string[] {
  if (error instanceof DesignFlowError && Array.isArray(error.metadata["issues"])) {
    return error.metadata["issues"].filter((issue): issue is string => typeof issue === "string").slice(0, 20);
  }
  return [error instanceof Error ? error.message.slice(0, 500) : "output failed validation"];
}

/** One initial call plus one bounded repair call; neither raw output nor prompts are persisted. */
export async function generateValidatedModelOutput<T>(options: {
  readonly agentId: string;
  readonly context: SpecializedAgentContext;
  readonly messages: readonly { role: "system" | "user"; content: string }[];
  readonly responseSchema: JsonSchemaObject;
  readonly maxOutputTokens: number;
  readonly validate: (output: unknown) => T;
}): Promise<T> {
  let messages = [...options.messages];
  let issues: readonly string[] = [];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await options.context.model.generate({
      messages,
      responseSchema: options.responseSchema,
      maxOutputTokens: options.maxOutputTokens,
    });

    if (result.type === "failure") {
      throw new SpecializedAgentOutputInvalidError(options.agentId, [`model call failed: ${result.code}`]);
    }

    try {
      return options.validate(result.output);
    } catch (error) {
      issues = validationIssues(error);
      if (attempt === 0) {
        const boundedOutput = JSON.stringify(result.output).slice(0, MAX_REPAIR_CONTEXT_BYTES);
        messages = [
          ...options.messages,
          {
            role: "user",
            content: `The previous JSON object failed validation. Return only a corrected JSON object matching the supplied schema. Validation errors: ${issues.join("; ")}. Previous bounded object: ${boundedOutput}`,
          },
        ];
      }
    }
  }

  throw new SpecializedAgentOutputInvalidError(options.agentId, issues);
}
