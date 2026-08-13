// packages/tools/src/catalog/classify-design-task.ts
import {
  toolManifestSchema,
  type Tool,
  type ToolManifest,
} from "@designflow/sdk";

import { z } from "zod";

/**
 * Reads a request and says what kind of design work it describes.
 *
 * Rules, not a model. Every classification is a keyword match a person can
 * read, argue with and predict — which is the point at this stage: the value
 * being proved is that a tool result can be *load-bearing* in a decision, and
 * that is far easier to demonstrate when the tool itself is boring.
 *
 * Pure. No filesystem, no network, no clock, no randomness. The same request
 * classifies identically forever, which is what lets the agent that depends on
 * it stay deterministic too.
 *
 * When an LLM-backed classifier replaces this, nothing around it changes: the
 * schemas, the timeout, the allow-list entry and the agent's use of the result
 * are all already in place, and the model's answer would be parsed by the same
 * `outputSchema` before the agent ever sees it.
 */

export const classifyDesignTaskInputSchema = z
  .object({
    request: z.string(),
  })
  .strict();

export type ClassifyDesignTaskInput = z.infer<typeof classifyDesignTaskInputSchema>;

export const designTaskTypeSchema = z.enum([
  "new_component",
  "modify_component",
  "page",
  "unknown",
]);

export type DesignTaskType = z.infer<typeof designTaskTypeSchema>;

export const classifyDesignTaskOutputSchema = z
  .object({
    taskType: designTaskTypeSchema,
    /** 0 when nothing matched, rising with the strength of the match. */
    confidence: z.number().min(0).max(1),
    /** The words that drove the answer, so a classification can be explained. */
    signals: z.array(z.string()).default([]),
  })
  .strict();

export type ClassifyDesignTaskOutput = z.infer<typeof classifyDesignTaskOutputSchema>;

export const classifyDesignTaskManifest: ToolManifest = toolManifestSchema.parse({
  id: "classify-design-task",
  name: "Classify design task",
  description: "Decides what kind of design work a request describes",
  version: "0.1.0",
  inputSchema: {
    description: "The request to classify",
    fields: [
      { name: "request", type: "string", required: true, description: "What was asked for" },
    ],
  },
  outputSchema: {
    description: "The kind of work, with a confidence and the words behind it",
    fields: [
      { name: "taskType", type: "string", required: true },
      { name: "confidence", type: "number", required: true },
      { name: "signals", type: "string[]", required: true },
    ],
  },
  timeoutMs: 1_000,
  metadata: { author: "DesignFlow", deterministic: true, readOnly: true },
});

/**
 * Ordered most specific first.
 *
 * "redesign the dashboard page" is a page, not a modification, because a
 * person asking for it wants the page rebuilt. Ordering encodes that, rather
 * than scoring every category and hoping the weights land right.
 */
const RULES: readonly {
  readonly taskType: DesignTaskType;
  readonly terms: readonly string[];
}[] = [
  { taskType: "page", terms: ["page", "screen", "dashboard", "layout", "view", "landing"] },
  {
    taskType: "modify_component",
    terms: ["update", "modify", "change", "adjust", "tweak", "refactor", "fix", "restyle"],
  },
  {
    taskType: "new_component",
    terms: ["component", "button", "card", "form", "modal", "header", "footer", "nav", "build", "create", "new"],
  },
  /**
   * Last: a design asset with no instruction attached.
   *
   * Handing over `homepage.fig` and saying nothing else is a real request —
   * "build what is in this" — and calling it unknown would send someone a
   * clarifying question about the file they just named. `page` because the
   * unit of a handed-over design file is usually a screen, and the low
   * confidence is the honest part: the file alone does not say which of the
   * three kinds it is.
   */
  {
    taskType: "page",
    terms: ["fig", "sketch", "xd", "figma", "design", "mockup", "wireframe"],
  },
];

/** Word-boundary matching, so "scanned" does not match "can". */
function matches(haystack: string, term: string): boolean {
  return new RegExp(`\\b${term}\\b`).test(haystack);
}

function classify(request: string): ClassifyDesignTaskOutput {
  const normalized = request.toLowerCase();

  for (const rule of RULES) {
    const signals = rule.terms.filter((term) => matches(normalized, term));

    if (signals.length > 0) {
      // Saturates at three matches. More agreement than that says nothing
      // extra, and a confidence that keeps climbing invites a caller to read
      // precision into a keyword count.
      return classifyDesignTaskOutputSchema.parse({
        taskType: rule.taskType,
        confidence: Math.min(1, 0.5 + signals.length * 0.2),
        signals,
      });
    }
  }

  return classifyDesignTaskOutputSchema.parse({
    taskType: "unknown",
    confidence: 0,
    signals: [],
  });
}

class ClassifyDesignTaskTool
  implements Tool<ClassifyDesignTaskInput, ClassifyDesignTaskOutput>
{
  public readonly manifest = classifyDesignTaskManifest;
  public readonly inputSchema = classifyDesignTaskInputSchema;
  public readonly outputSchema = classifyDesignTaskOutputSchema;

  public execute(input: ClassifyDesignTaskInput): Promise<ClassifyDesignTaskOutput> {
    return Promise.resolve(classify(input.request));
  }
}

export const classifyDesignTaskTool: Tool<
  ClassifyDesignTaskInput,
  ClassifyDesignTaskOutput
> = new ClassifyDesignTaskTool();
