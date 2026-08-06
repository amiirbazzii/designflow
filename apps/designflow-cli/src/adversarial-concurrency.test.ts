// apps/designflow-cli/src/adversarial-concurrency.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import {
  createServer,
  type Server,
} from "node:http";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createCliContext,
  type CliContext,
} from "./services/cli-runner";

/**
 * Adversarial verification: ONE shared CliContext (one process, one
 * DESIGNFLOW_HOME, one temp db), ONE real local HTTP server standing in for
 * OpenRouter, all four public workers' sessions launched concurrently via
 * Promise.all, deliberately trying to make agent-scoped memory,
 * project-agent-scoped memory, model slugs, tools, workflows, session
 * answers, traces and worker results cross-contaminate under interleaving.
 */

const workspaces: string[] = [];
const contexts: CliContext[] = [];
const servers: Server[] = [];

afterEach(() => {
  for (const created of contexts.splice(0)) created.close();
  for (const dir of workspaces.splice(0)) rmSync(dir, { recursive: true, force: true });
  for (const server of servers.splice(0)) server.close();
  delete process.env.DESIGNFLOW_HOME;
  delete process.env.OPENROUTER_API_KEY;
});

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "designflow-adversarial-"));
  workspaces.push(dir);
  return dir;
}

interface Captured {
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: Record<string, unknown> & { model?: string; messages?: unknown };
  readonly raw: string;
}

const TEST_API_KEY = "sk-ADVERSARIAL-TEST-KEY-do-not-leak-8f2c";

/** Model slug -> its owning agent's workflow, so every agent's decision actually resolves. */
const WORKFLOW_FOR_MODEL: Record<string, string> = {
  "openai/gpt-4o-mini": "design-to-code",
  "anthropic/claude-3.5-haiku": "qa-review",
  "perplexity/sonar": "research-analysis",
  "google/gemini-2.0-flash-001": "product-brief",
};

async function mockOpenRouter(options?: {
  failModel?: string; // one specific model gets a 500
}): Promise<{ endpoint: string; requests: Captured[] }> {
  const requests: Captured[] = [];

  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => {
      raw += chunk.toString();
    });
    req.on("end", () => {
      const body = raw.length > 0 ? (JSON.parse(raw) as Captured["body"]) : ({} as Captured["body"]);
      requests.push({ headers: req.headers, body, raw });

      if (options?.failModel !== undefined && body.model === options.failModel) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "injected adversarial failure" }));
        return;
      }

      const workflowId = WORKFLOW_FOR_MODEL[body.model ?? ""] ?? "design-to-code";
      const decision = {
        type: "run_workflow",
        workflowId,
        question: null,
        reason: null,
        reasoningSummary: `ok for ${body.model}`,
      };

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: `gen-${requests.length}`,
          model: body.model,
          choices: [{ message: { role: "assistant", content: JSON.stringify(decision) } }],
          usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
        }),
      );
    });
  });

  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("expected an address");

  return { endpoint: `http://127.0.0.1:${address.port}`, requests };
}

describe("Part A + B: shared CliContext, real concurrency, real HTTP mock", () => {
  test("full adversarial matrix", async () => {
    const mock = await mockOpenRouter();

    const home = workspace();
    process.env.DESIGNFLOW_HOME = home;
    process.env.OPENROUTER_API_KEY = TEST_API_KEY;

    const context = createCliContext({
      databasePath: join(home, "runs.json"),
      requireApproval: false,
      modelEndpointOverride: mock.endpoint,
    });
    contexts.push(context);

    // ── Plant project facts ──────────────────────────────────────
    const projectA = await context.projects.createProject({ name: "Project Alpha" });
    const projectB = await context.projects.createProject({ name: "Project Beta" });

    await context.projectContext.mergeFacts(projectA.id, [
      { op: "upsert", fact: { key: "project.codename", value: "MARKER-PROJECT-ALPHA-ONLY-4d2e", source: "user" } },
    ]);
    await context.projectContext.mergeFacts(projectB.id, [
      { op: "upsert", fact: { key: "project.codename", value: "MARKER-PROJECT-BETA-ONLY-9b7f", source: "user" } },
    ]);

    // ── Plant agent-scoped memory, one per agent ─────────────────
    const agentMarkers: Record<string, string> = {
      "design-engineer-coordinator": "MARKER-DESIGN-ENGINEER-ONLY-1a2b",
      "qa-reviewer-agent": "MARKER-QA-ONLY-7f3a",
      "research-analyst-agent": "MARKER-RESEARCH-ONLY-9c1b",
      "product-manager-agent": "MARKER-PRODUCT-MANAGER-ONLY-5e6f",
    };
    for (const [agentId, marker] of Object.entries(agentMarkers)) {
      await context.memory.addMemory({
        scope: "agent",
        agentId,
        key: "note",
        value: marker,
        source: "user_approved",
      });
    }

    // ── Plant ONE project_agent-scoped memory: (Project Alpha, qa-reviewer-agent) only ──
    const projectAgentMarker = "MARKER-ALPHA-QA-PAIR-ONLY-2f8d";
    // Deliberately a DIFFERENT key than the agent-scoped memory above
    // ("note") — same key would let `ContextAssemblyService`'s documented
    // same-key precedence (project_agent overwrites agent) legitimately
    // hide the agent-scope marker at this project, which would be a false
    // positive for a leak, not a leak.
    await context.memory.addMemory({
      scope: "project_agent",
      agentId: "qa-reviewer-agent",
      projectId: projectA.id,
      key: "pairNote",
      value: projectAgentMarker,
      source: "user_approved",
    });

    // ── Launch all sessions concurrently, deliberately interleaving
    // the same agent across different projects and different agents on
    // the same project, to stress every axis of the isolation matrix. ──
    const plan: { label: string; workerId: string; projectId: string }[] = [
      { label: "design-engineer/alpha", workerId: "design-engineer", projectId: projectA.id },
      { label: "qa-reviewer/alpha", workerId: "qa-reviewer", projectId: projectA.id }, // pair marker SHOULD reach this
      { label: "qa-reviewer/beta", workerId: "qa-reviewer", projectId: projectB.id }, // same agent, diff project: must NOT
      { label: "research-analyst/alpha", workerId: "research-analyst", projectId: projectA.id }, // diff agent, same project: must NOT
      { label: "product-manager/beta", workerId: "product-manager", projectId: projectB.id },
      { label: "design-engineer/beta", workerId: "design-engineer", projectId: projectB.id },
    ];

    const results = await Promise.all(
      plan.map((entry) =>
        context.sessions
          .startSessionForWorker(context.workers.getWorker(entry.workerId)!, {
            workerId: entry.workerId,
            request: `Please handle ${entry.label}`,
            projectId: entry.projectId,
          })
          .then((result) => ({ ...entry, result })),
      ),
    );

    // ── A1 + A2: inspect captured HTTP request bodies (the literal
    // prompt text each agent's model actually received) for marker
    // leakage. This is the strongest possible evidence: it is exactly
    // what crossed the wire to "the model", not an inference about what
    // should have happened. ──────────────────────────────────────────
    for (const request of mock.requests) {
      const model = request.body.model;
      const promptText = JSON.stringify(request.body.messages ?? "");

      for (const [agentId, marker] of Object.entries(agentMarkers)) {
        const modelForAgent =
          agentId === "design-engineer-coordinator"
            ? "openai/gpt-4o-mini"
            : agentId === "qa-reviewer-agent"
              ? "anthropic/claude-3.5-haiku"
              : agentId === "research-analyst-agent"
                ? "perplexity/sonar"
                : "google/gemini-2.0-flash-001";

        if (model === modelForAgent) {
          // This agent's own marker is allowed (and expected).
          continue;
        }
        // DEFECT if another agent's marker appears in this request's prompt.
        expect(promptText.includes(marker)).toBe(false);
      }
    }

    // Confirm each agent's OWN marker DID reach its own request(s) — proves
    // the plumbing is live, not merely silent. MVP-3B: the Design Engineer
    // coordinator no longer performs model calls at all, so its slug must be
    // absent from the wire entirely.
    expect(mock.requests.find((r) => r.body.model === "openai/gpt-4o-mini")).toBeUndefined();
    const qaReqs = mock.requests.filter((r) => r.body.model === "anthropic/claude-3.5-haiku");
    for (const r of qaReqs) {
      expect(JSON.stringify(r.body.messages)).toContain(agentMarkers["qa-reviewer-agent"]);
    }

    // ── A2: project_agent marker reaches ONLY (Project Alpha, qa-reviewer) ──
    // qa-reviewer/alpha's underlying HTTP request(s): must contain the pair marker.
    // qa-reviewer/beta and research-analyst/alpha must NOT.
    const allPromptTexts = mock.requests.map((r) => JSON.stringify(r.body.messages ?? ""));
    const requestsContainingPairMarker = allPromptTexts.filter((text) => text.includes(projectAgentMarker));
    // Exactly the qa-reviewer/alpha request(s) — never zero, never more than the alpha/qa call count.
    expect(requestsContainingPairMarker.length).toBeGreaterThan(0);
    for (const text of allPromptTexts) {
      const isQaAlphaRequest =
        // qa-reviewer's model AND alpha's project marker should co-occur only when both true;
        // detect by presence of alpha project marker + qa agent marker together.
        text.includes(agentMarkers["qa-reviewer-agent"]!) && text.includes("MARKER-PROJECT-ALPHA-ONLY-4d2e");
      if (text.includes(projectAgentMarker)) {
        expect(isQaAlphaRequest).toBe(true);
      }
    }
    // Explicitly confirm qa-reviewer/beta and research-analyst/alpha requests exclude it.
    const qaBetaReq = mock.requests.find(
      (r) => r.body.model === "anthropic/claude-3.5-haiku" && JSON.stringify(r.body.messages).includes("BETA"),
    );
    if (qaBetaReq !== undefined) {
      expect(JSON.stringify(qaBetaReq.body.messages)).not.toContain(projectAgentMarker);
    }
    const researchReq = mock.requests.find((r) => r.body.model === "perplexity/sonar");
    expect(JSON.stringify(researchReq?.body.messages)).not.toContain(projectAgentMarker);

    // Project fact isolation: alpha's fact marker must never appear in the
    // SPECIFIC request for a session scoped to project Beta, and vice versa.
    // Matched per-request by the session's own label text embedded in its
    // "Request: Please handle <label>" line — not aggregated by model,
    // since two sessions from the same agent (design-engineer/alpha and
    // design-engineer/beta) share a model slug but must not share a request.
    for (const entry of plan) {
      // MVP-3B: design-engineer sessions clarify deterministically and never
      // reach the wire, so per-request isolation is checked for the three
      // model-backed workers only.
      if (entry.workerId === "design-engineer") {
        expect(mock.requests.find((r) => JSON.stringify(r.body.messages ?? "").includes(`Please handle ${entry.label}`))).toBeUndefined();
        continue;
      }
      const req = mock.requests.find((r) => JSON.stringify(r.body.messages ?? "").includes(`Please handle ${entry.label}`));
      expect(req).toBeDefined();
      const text = JSON.stringify(req?.body.messages ?? "");
      if (entry.projectId === projectA.id) {
        expect(text).not.toContain("MARKER-PROJECT-BETA-ONLY-9b7f");
        expect(text).toContain("MARKER-PROJECT-ALPHA-ONLY-4d2e");
      } else {
        expect(text).not.toContain("MARKER-PROJECT-ALPHA-ONLY-4d2e");
        expect(text).toContain("MARKER-PROJECT-BETA-ONLY-9b7f");
      }
    }

    // ── A3: no model-profile crossover under interleaving ────────────
    const slugCounts: Record<string, number> = {};
    for (const r of mock.requests) {
      const m = r.body.model ?? "undefined";
      slugCounts[m] = (slugCounts[m] ?? 0) + 1;
    }
    // MVP-3B: design-engineer never calls a model, so only qa-reviewer
    // (alpha+beta), research-analyst, and product-manager reach the wire =>
    // 4 requests, 3 distinct slugs.
    expect(mock.requests).toHaveLength(4);
    expect(slugCounts["openai/gpt-4o-mini"]).toBeUndefined();
    expect(slugCounts["anthropic/claude-3.5-haiku"]).toBe(2);
    expect(slugCounts["perplexity/sonar"]).toBe(1);
    expect(slugCounts["google/gemini-2.0-flash-001"]).toBe(1);

    // ── A4: no tool crossover — allowedTools per manifest, cross-checked
    // against ContextAssemblyService input is structural; verify via each
    // agent's manifest and that available tool ids named in the prompt
    // ("Tools you may consult") only ever list that agent's own tools. ──
    const toolsByAgent: Record<string, readonly string[]> = {
      "design-engineer-coordinator": ["classify-design-task"],
      "qa-reviewer-agent": ["classify-review-target", "summarize-artifact-set", "accessibility-checklist"],
      "research-analyst-agent": ["classify-research-request", "validate-source-metadata", "extract-structured-claims"],
      "product-manager-agent": ["classify-product-request", "identify-requirement-gaps", "structure-acceptance-criteria"],
    };
    const allTools = Object.values(toolsByAgent).flat();
    for (const [agentId, ownTools] of Object.entries(toolsByAgent)) {
      const model =
        agentId === "design-engineer-coordinator"
          ? "openai/gpt-4o-mini"
          : agentId === "qa-reviewer-agent"
            ? "anthropic/claude-3.5-haiku"
            : agentId === "research-analyst-agent"
              ? "perplexity/sonar"
              : "google/gemini-2.0-flash-001";
      const reqs = mock.requests.filter((r) => r.body.model === model);
      for (const r of reqs) {
        const text = JSON.stringify(r.body.messages ?? "");
        const foreignTools = allTools.filter((t) => !ownTools.includes(t));
        for (const foreignTool of foreignTools) {
          expect(text.includes(foreignTool)).toBe(false);
        }
      }
    }

    // ── A5: no workflow crossover — each decision named only its own
    // worker's workflow. ────────────────────────────────────────────
    const expectedWorkflow: Record<string, string> = {
      "design-engineer": "design-to-code",
      "qa-reviewer": "qa-review",
      "research-analyst": "research-analysis",
      "product-manager": "product-brief",
    };
    for (const r of results) {
      if (r.result.session.decisionType === "run_workflow") {
        for (const traceId of r.result.session.traceIds) {
          const trace = await context.traces.getTrace(traceId);
          if (trace?.workflowId !== undefined) {
            expect(trace.workflowId).toBe(expectedWorkflow[r.workerId]);
          }
        }
      }
    }

    // ── A6: session-answer crossover — each of the six concurrently
    // created sessions' own record must reflect only its own request/answer,
    // never another concurrently-created session's. ────────────────────
    for (const r of results) {
      const stored = await context.sessions.getSession(r.result.session.id);
      expect(stored.originalRequest).toBe(`Please handle ${r.label}`);
      expect(stored.projectId).toBe(r.projectId);
      expect(stored.workerId).toBe(r.workerId);
      // No other session's request text leaked into this one.
      for (const other of plan) {
        if (other.label === r.label) continue;
        expect(stored.originalRequest).not.toBe(`Please handle ${other.label}`);
      }
    }

    // ── A7: trace correlation — each session's traceIds correlate only to
    // that session's own decision (its own model slug / workflow). ─────
    for (const r of results) {
      const stored = await context.sessions.getSession(r.result.session.id);
      for (const traceId of stored.traceIds) {
        const trace = await context.traces.getTrace(traceId);
        expect(trace).not.toBeNull();
        if (trace === null) continue;
        expect(trace.agentId).toBe(r.result.session.agentId);
        if (trace.workflowId !== undefined) {
          expect(trace.workflowId).toBe(expectedWorkflow[r.workerId]);
        }
        for (const modelCall of trace.modelCalls) {
          const expectedModel =
            r.workerId === "design-engineer"
              ? "openai/gpt-4o-mini"
              : r.workerId === "qa-reviewer"
                ? "anthropic/claude-3.5-haiku"
                : r.workerId === "research-analyst"
                  ? "perplexity/sonar"
                  : "google/gemini-2.0-flash-001";
          if (modelCall.model !== undefined) {
            expect(modelCall.model).toBe(expectedModel);
          }
        }
      }
    }

    // ── A8: result crossover — the worker owning the workflow a session
    // actually ran (via `executionId`) matches the worker that was asked. ──
    for (const r of results) {
      if (r.result.session.decisionType === "run_workflow" && r.result.session.executionId !== undefined) {
        const owningWorker = context.workers
          .listWorkers()
          .find((w) => w.workflows.includes(expectedWorkflow[r.workerId]!));
        expect(owningWorker?.id).toBe(r.workerId);
      }
    }

    // ── B4: Authorization header carries the credential; grep every
    // captured header+body for the literal key — must appear ONLY in the
    // Authorization header, nowhere else. ─────────────────────────────
    for (const r of mock.requests) {
      expect(r.headers.authorization).toBe(`Bearer ${TEST_API_KEY}`);
      expect(r.raw.includes(TEST_API_KEY)).toBe(false);
      const headerCopy = { ...r.headers };
      delete headerCopy.authorization;
      expect(JSON.stringify(headerCopy).includes(TEST_API_KEY)).toBe(false);
    }
  }, 30_000);

  // ── B3: changing one agent's profile changes only that agent's request
  // slug across a full CONCURRENT batch of all four agents (not sequential). ──
  test("local override to one agent's model reaches only that agent under a concurrent 4-agent batch", async () => {
    const mock = await mockOpenRouter();

    const home = workspace();
    process.env.DESIGNFLOW_HOME = home;
    process.env.OPENROUTER_API_KEY = TEST_API_KEY;

    // Local override file: `readModelProfileOverrides` reads home config;
    // simplest robust path is passing an already-overridden profile set is
    // not exposed on CliContext, so instead assert via two contexts is
    // unnecessary — reuse cli-runner's own override plumbing by writing
    // config.json with a modelProfiles override before context creation.
    const fs = await import("node:fs");
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(
      join(home, "config.json"),
      JSON.stringify({
        settings: {
          models: {
            profiles: {
              "design-engineer-coordinator-default": { model: "openai/gpt-4o" },
            },
          },
        },
      }),
    );

    const context = createCliContext({
      databasePath: join(home, "runs.json"),
      requireApproval: false,
      modelEndpointOverride: mock.endpoint,
    });
    contexts.push(context);

    const plan = [
      { workerId: "design-engineer", model: "openai/gpt-4o" }, // overridden
      { workerId: "qa-reviewer", model: "anthropic/claude-3.5-haiku" },
      { workerId: "research-analyst", model: "perplexity/sonar" },
      { workerId: "product-manager", model: "google/gemini-2.0-flash-001" },
    ];

    await Promise.all(
      plan.flatMap((entry) =>
        // two concurrent rounds interleaved
        [1, 2].map(() =>
          context.sessions.startSessionForWorker(context.workers.getWorker(entry.workerId)!, {
            workerId: entry.workerId,
            request: "handle it",
          }),
        ),
      ),
    );

    // MVP-3B: the design-engineer coordinator performs no model calls, so
    // only the other three workers (twice each) reach the wire.
    expect(mock.requests).toHaveLength(6);
    const byModel: Record<string, number> = {};
    for (const r of mock.requests) {
      byModel[r.body.model ?? "?"] = (byModel[r.body.model ?? "?"] ?? 0) + 1;
    }
    expect(byModel["openai/gpt-4o"]).toBeUndefined(); // design-engineer never calls a model at all
    expect(byModel["openai/gpt-4o-mini"]).toBeUndefined(); // old slug never sent
    expect(byModel["anthropic/claude-3.5-haiku"]).toBe(2);
    expect(byModel["perplexity/sonar"]).toBe(2);
    expect(byModel["google/gemini-2.0-flash-001"]).toBe(2);
  }, 30_000);

  // ── B5: one provider failure mid-batch declines only that call; the
  // other three concurrent calls still succeed. ──────────────────────
  test("a mid-batch provider 500 for one agent declines only that agent; three others succeed", async () => {
    const mock = await mockOpenRouter({ failModel: "perplexity/sonar" }); // research-analyst fails

    const home = workspace();
    process.env.DESIGNFLOW_HOME = home;
    process.env.OPENROUTER_API_KEY = TEST_API_KEY;

    const context = createCliContext({
      databasePath: join(home, "runs.json"),
      requireApproval: false,
      modelEndpointOverride: mock.endpoint,
    });
    contexts.push(context);

    const plan = ["design-engineer", "qa-reviewer", "research-analyst", "product-manager"];
    const results = await Promise.all(
      plan.map((workerId) =>
        context.sessions.startSessionForWorker(context.workers.getWorker(workerId)!, {
          workerId,
          request: "handle it",
        }),
      ),
    );

    const byWorker = Object.fromEntries(plan.map((w, i) => [w, results[i]!]));
    expect(byWorker["research-analyst"]!.session.decisionType).toBe("decline");
    expect(byWorker["design-engineer"]!.session.decisionType).toBe("request_clarification");
    expect(byWorker["qa-reviewer"]!.session.decisionType).toBe("run_workflow");
    expect(byWorker["product-manager"]!.session.decisionType).toBe("run_workflow");
  }, 30_000);

  // ── B6: deterministic strategies remain available offline, no network. ──
  test("no OPENROUTER_API_KEY: deterministic strategies run with zero network calls", async () => {
    const home = workspace();
    process.env.DESIGNFLOW_HOME = home;
    // OPENROUTER_API_KEY deliberately NOT set.

    const context = createCliContext({
      databasePath: join(home, "runs.json"),
      requireApproval: false,
    });
    contexts.push(context);

    const result = await context.sessions.startSessionForWorker(context.workers.getWorker("design-engineer")!, {
      workerId: "design-engineer",
      request: "Build the checkout flow from figma.com/file/123",
    });

    // Deterministic path still decides something without ever touching a
    // model endpoint (none is even configured).
    expect(["run_workflow", "request_clarification", "decline"]).toContain(result.session.decisionType);
  });
});
