// packages/sdk/src/project-events.ts
import { z } from "zod";

/**
 * What the product layer reports as a project's identity and context change.
 *
 * The project-level analogue of `SessionEvent`/`TraceEvent`: identifiers,
 * counts and timestamps, and nothing a person wrote. `project.context.updated`
 * carries `factKeys` — which *keys* changed — never a value, for the same
 * reason a trace never carries a tool's output.
 */
export const projectEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("project.created"),
      projectId: z.string().min(1),
      timestamp: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("project.inspected"),
      projectId: z.string().min(1),
      factCount: z.number().int().nonnegative(),
      timestamp: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("project.context.updated"),
      projectId: z.string().min(1),
      version: z.number().int().positive(),
      factKeys: z.array(z.string().min(1)),
      timestamp: z.string().min(1),
    })
    .strict(),
]);

export type ProjectEvent = z.infer<typeof projectEventSchema>;

export interface ProjectObserver {
  onEvent(event: ProjectEvent): Promise<void>;
}

export const NOOP_PROJECT_OBSERVER: ProjectObserver = {
  onEvent: () => Promise.resolve(),
};
