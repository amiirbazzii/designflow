// packages/agents/src/catalog/task-helpers.ts
import type { AgentTask } from "@designflow/sdk";
import type { DecisionPromptFact } from "../decision-prompt";

/**
 * Shared, stateless helpers every catalog agent's strategies read `AgentTask`
 * with.
 *
 * Extracted once the third agent needed them verbatim from
 * `design-engineer-agent.ts` — duplicating four defensive narrowing functions
 * per agent would have made each one a place these could quietly drift out of
 * sync. Every function here re-checks `unknown` rather than trusting it, for
 * the same reason the original functions did: `AgentTask.context` crosses the
 * `@designflow/sdk` boundary untyped regardless of which product-layer
 * service populated it, and this package depends on the SDK alone.
 */

/** Whether the task's own request/input names anything to act on. */
export function hasSomethingToDo(task: AgentTask): boolean {
  if (task.request.trim().length > 0) return true;

  const { input } = task;
  if (input === undefined || input === null) return false;

  if (typeof input === "object") return Object.keys(input).length > 0;

  return String(input).trim().length > 0;
}

/**
 * Whether there is now anything to act on — the original request/input, OR a
 * clarification answer a resumed session carries.
 *
 * A session that started with a genuinely empty request/input (reachable
 * through the product API's `POST /workers/:id/tasks` with an empty body,
 * unlike the CLI's interactive form, which always fills a placeholder) is
 * resumed by `AgentSessionService.answerSession` re-routing with that same
 * empty `originalRequest`/`originalInput` — the answer only ever lands in
 * `task.context.clarifications`. A gate that checks `hasSomethingToDo` alone
 * never sees it, and the session asks the same question forever. This is the
 * gate every strategy below actually calls.
 */
export function readyToDecide(task: AgentTask): boolean {
  return hasSomethingToDo(task) || readClarifications(task).length > 0;
}

/**
 * The request as one string: prose, plus any structured input's values, plus
 * — when the original request/input was empty — the answers a resumed
 * session's clarifications carry. Clarification answers are appended last so
 * they never override a real request; they only ever fill the gap one left.
 */
export function describeTask(task: AgentTask): string {
  const parts = [task.request];

  const { input } = task;
  if (typeof input === "object" && input !== null && !Array.isArray(input)) {
    for (const value of Object.values(input)) {
      parts.push(Array.isArray(value) ? value.join(" ") : String(value));
    }
  }

  if (!hasSomethingToDo(task)) {
    for (const clarification of readClarifications(task)) parts.push(clarification.answer);
  }

  return parts.filter((part) => part.length > 0).join(" ");
}

/** The clarification exchange a session-resumed task carries, or none. */
export function readClarifications(
  task: AgentTask,
): readonly { question: string; answer: string }[] {
  const { context } = task;
  if (typeof context !== "object" || context === null) return [];

  const clarifications = (context as { clarifications?: unknown }).clarifications;
  if (!Array.isArray(clarifications)) return [];

  return clarifications.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];

    const question = (entry as { question?: unknown }).question;
    const answer = (entry as { answer?: unknown }).answer;

    return typeof question === "string" && typeof answer === "string"
      ? [{ question, answer }]
      : [];
  });
}

/** Stage 40's Project Context, when the resumed or fresh task carries one. */
export function readProjectFacts(task: AgentTask): readonly DecisionPromptFact[] {
  const { context } = task;
  if (typeof context !== "object" || context === null) return [];

  const project = (context as { project?: unknown }).project;
  if (typeof project !== "object" || project === null) return [];

  const facts = (project as { facts?: unknown }).facts;
  if (!Array.isArray(facts)) return [];

  return facts.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const key = (entry as { key?: unknown }).key;
    return typeof key === "string" ? [{ key, value: (entry as { value?: unknown }).value }] : [];
  });
}

/** Stage 40's Agent Memory, read the same defensive way as `readProjectFacts`. */
export function readMemoryNotes(task: AgentTask): readonly DecisionPromptFact[] {
  const { context } = task;
  if (typeof context !== "object" || context === null) return [];

  const memory = (context as { memory?: unknown }).memory;
  if (!Array.isArray(memory)) return [];

  return memory.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const key = (entry as { key?: unknown }).key;
    return typeof key === "string" ? [{ key, value: (entry as { value?: unknown }).value }] : [];
  });
}
