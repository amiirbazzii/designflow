// apps/designflow-api/src/router.ts
import { DesignFlowError, sessionStatusSchema } from "@designflow/sdk";
import type { ApiHost } from "./host";

/**
 * The HTTP boundary.
 *
 * Every route is a thin translation: parse a request, call one
 * `WorkflowRunner` method, serialise the result. No route reaches past the
 * product layer, computes a status, or counts an artifact — if a number
 * appears in a response, the runner produced it.
 *
 * Implemented against the platform `Request`/`Response` types rather than a
 * framework, so the whole surface is testable by calling `handle(request)`
 * with no server listening.
 */

export interface RouteMatch {
  readonly method: string;
  readonly pattern: RegExp;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json",
      // The web client is served from a different port in development.
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "GET, POST, OPTIONS",
    },
  });

const notFound = (message: string): Response =>
  json({ error: { code: "ERR_NOT_FOUND", message } }, 404);

/**
 * Strips fields a normal client must never see from a session.
 *
 * `agentId` is internal composition detail — which decision-maker a worker
 * happens to delegate to — never part of the product vocabulary a person
 * reads. Everything else on `AgentSession` is already privacy-safe by
 * construction (see the SDK's own docs on the schema).
 */
function toSafeSession(session: Record<string, unknown>): Record<string, unknown> {
  const { agentId: _agentId, ...safe } = session;
  return safe;
}

export function createRouter(host: ApiHost) {
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") return json({}, 204);

    try {
      return await route(host, request, path);
    } catch (error) {
      // A DesignFlowError carries a stable code and structured metadata, which
      // is exactly what a client needs to branch on. Anything else is a bug
      // here and is reported as one rather than dressed up as a client error.
      if (error instanceof DesignFlowError) {
        return json(
          {
            error: {
              code: error.code,
              message: error.message,
              metadata: error.metadata,
            },
          },
          statusFor(error.code),
        );
      }

      return json(
        {
          error: {
            code: "ERR_INTERNAL",
            message: error instanceof Error ? error.message : String(error),
          },
        },
        500,
      );
    }
  };
}

async function route(
  host: ApiHost,
  request: Request,
  path: string,
): Promise<Response> {
  // ── The Worker Task Boundary (Stage 41) ─────────────────────────
  // The product-facing surface: Workers, Sessions, Results. No route below
  // this comment names a workflow id, an agent id, a tool id or a model
  // profile id in a normal response.

  // GET /workers
  if (request.method === "GET" && path === "/workers") {
    return json({ workers: host.workerCatalog.listWorkers() });
  }

  // GET /workers/:workerId
  const workerDetail = path.match(/^\/workers\/([^/]+)$/);
  if (request.method === "GET" && workerDetail !== null) {
    const workerId = decodeURIComponent(workerDetail[1] ?? "");
    return json({ worker: host.workerCatalog.getWorker(workerId) });
  }

  // POST /workers/:workerId/tasks
  const workerTasks = path.match(/^\/workers\/([^/]+)\/tasks$/);
  if (request.method === "POST" && workerTasks !== null) {
    const workerId = decodeURIComponent(workerTasks[1] ?? "");
    const body = await readJson(request);

    const result = await host.sessions.startSession({
      workerId,
      request: typeof body.request === "string" ? body.request : "",
      ...(body.input !== undefined ? { input: body.input } : {}),
      ...(typeof body.projectId === "string" ? { projectId: body.projectId } : {}),
      ...(typeof body.idempotencyKey === "string" ? { idempotencyKey: body.idempotencyKey } : {}),
    });

    return json(
      {
        session: toSafeSession(result.session),
        ...(result.message !== undefined ? { message: result.message } : {}),
      },
      201,
    );
  }

  // GET /sessions
  if (request.method === "GET" && path === "/sessions") {
    const params = new URL(request.url).searchParams;
    const statusParam = params.get("status");
    const status = statusParam !== null ? sessionStatusSchema.safeParse(statusParam) : undefined;
    const workerId = params.get("workerId");
    const limit = params.get("limit");

    const sessions = await host.sessions.listSessions({
      ...(status?.success === true ? { status: status.data } : {}),
      ...(workerId !== null ? { workerId } : {}),
      ...(limit !== null ? { limit: Number(limit) } : {}),
    });

    return json({ sessions: sessions.map((session) => toSafeSession(session)) });
  }

  // GET /sessions/:sessionId
  const sessionDetail = path.match(/^\/sessions\/([^/]+)$/);
  if (request.method === "GET" && sessionDetail !== null) {
    const sessionId = decodeURIComponent(sessionDetail[1] ?? "");
    const session = await host.sessions.getSession(sessionId);
    return json({ session: toSafeSession(session) });
  }

  // POST /sessions/:sessionId/answers
  const sessionAnswers = path.match(/^\/sessions\/([^/]+)\/answers$/);
  if (request.method === "POST" && sessionAnswers !== null) {
    const sessionId = decodeURIComponent(sessionAnswers[1] ?? "");
    const body = await readJson(request);

    const result = await host.sessions.answerSession({
      sessionId,
      answer: typeof body.answer === "string" ? body.answer : "",
      ...(typeof body.idempotencyKey === "string" ? { idempotencyKey: body.idempotencyKey } : {}),
    });

    return json({
      session: toSafeSession(result.session),
      ...(result.message !== undefined ? { message: result.message } : {}),
    });
  }

  // GET /results
  if (request.method === "GET" && path === "/results") {
    const params = new URL(request.url).searchParams;
    const workerId = params.get("workerId");
    const limit = params.get("limit");

    const results = await host.workerResults.listWorkerResults({
      ...(workerId !== null ? { workerId } : {}),
      ...(limit !== null ? { limit: Number(limit) } : {}),
    });

    return json({ results });
  }

  // GET /results/:resultId
  const resultDetail = path.match(/^\/results\/([^/]+)$/);
  if (request.method === "GET" && resultDetail !== null) {
    const resultId = decodeURIComponent(resultDetail[1] ?? "");
    return json({ result: await host.workerResults.getWorkerResult(resultId) });
  }

  // ── Deprecated: raw workflow/execution routes ───────────────────
  // Kept for internal/debug compatibility only. Not used by the default web
  // client, which speaks the Worker Task Boundary above. New callers should
  // use /workers, /sessions and /results instead.

  // GET /api/workflows
  if (request.method === "GET" && path === "/api/workflows") {
    return json({
      workflows: [...host.workflows.values()].map((workflow) => {
        // Input fields come from the owning worker's own manifest — the
        // single source of truth every other surface reads — never a second,
        // hand-duplicated list kept here for this legacy route alone.
        const worker = host.workerCatalog.findByWorkflow(workflow.id);

        return {
          workflowId: workflow.id,
          name: workflow.name,
          description: workflow.description ?? "",
          steps: workflow.definition.nodes.map((node) => node.id),
          inputs: worker?.inputs ?? [],
        };
      }),
    });
  }

  // POST /api/workflows/:id/start
  const start = path.match(/^\/api\/workflows\/([^/]+)\/start$/);
  if (request.method === "POST" && start !== null) {
    const workflowId = decodeURIComponent(start[1] ?? "");
    const body = await readJson(request);

    const handle = await host.runner.start({
      workflowId,
      ...(body.input !== undefined ? { input: body.input } : {}),
    });

    return json({ execution: handle }, 201);
  }

  // GET /api/executions/history
  if (request.method === "GET" && path === "/api/executions/history") {
    const workflowId = new URL(request.url).searchParams.get("workflowId");

    // `history()` with no argument spans every workflow — the product layer
    // owns that fan-out now, so the route stays a one-line translation.
    return json({
      history:
        workflowId !== null
          ? await host.runner.history(workflowId)
          : await host.runner.history(),
    });
  }

  const execution = path.match(/^\/api\/executions\/([^/]+)(\/[^/]+)?$/);

  if (execution !== null) {
    const executionId = decodeURIComponent(execution[1] ?? "");
    const action = execution[2] ?? "";

    if (request.method === "GET" && action === "") {
      return json({ status: await host.runner.status(executionId) });
    }

    if (request.method === "GET" && action === "/progress") {
      return json({ progress: await host.runner.progress(executionId) });
    }

    if (request.method === "GET" && action === "/explain") {
      return json({ report: await host.runner.explain(executionId) });
    }

    if (request.method === "POST" && action === "/approve") {
      const body = await readJson(request);
      const comment = typeof body.comment === "string" ? body.comment : undefined;

      return json({
        outcome: await host.runner.approve(executionId, comment),
      });
    }

    if (request.method === "POST" && action === "/reject") {
      const body = await readJson(request);
      const comment = typeof body.comment === "string" ? body.comment : undefined;

      return json({
        outcome: await host.runner.reject(executionId, comment),
      });
    }
  }

  return notFound(`No route for ${request.method} ${path}`);
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await request.json();
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? { ...parsed }
      : {};
  } catch {
    return {};
  }
}

/** Maps a domain error code onto the closest HTTP status. */
function statusFor(code: string): number {
  switch (code) {
    case "ERR_EXECUTION_NOT_FOUND":
    case "ERR_WORKFLOW_NOT_FOUND":
    case "ERR_APPROVAL_NOT_FOUND":
    case "ERR_WORKER_NOT_FOUND":
    case "ERR_SESSION_NOT_FOUND":
      return 404;
    case "ERR_NO_PENDING_APPROVAL":
    case "ERR_APPROVAL_STATE_TRANSITION":
    case "ERR_INVALID_REQUEST":
    case "ERR_WORKER_RESULT_NOT_READY":
    case "ERR_SESSION_STATE_INVALID":
    case "ERR_SESSION_NOT_WAITING":
    case "ERR_SESSION_EXPIRED":
    case "ERR_SESSION_TURN_LIMIT_EXCEEDED":
    case "ERR_SESSION_CANCELLED":
      return 409;
    case "ERR_SESSION_ANSWER_INVALID":
    case "ERR_SESSION_INVALID":
      return 400;
    default:
      return 400;
  }
}
