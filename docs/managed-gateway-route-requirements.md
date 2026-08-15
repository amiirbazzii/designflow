# Managed gateway route requirements — V2 flagship

This is a **handoff document for the managed DesignFlow AI gateway's
deployment owner**, produced by the V2-10 corrective task. It is not a
statement of the gateway's actual configuration or schema — this repository
has no access to that and makes no request to it. Everything below is
inferred from the DesignFlow client's own source: what a normal run will
actually send.

## The external requirement

The managed DesignFlow AI gateway must recognize the four V2 flagship
profile identities below and resolve each to a deployed model route. During
the V2-10 real-environment acceptance run (executionId
`0506a14f-a052-4ff7-a0ce-95ad40126677`, `2026-08-15T07:55Z`), an
authenticated, connected session sent `openai/gpt-4o-mini` under the
`design-interpreter-default` and `project-mapper-default` profile ids and
the gateway returned `ERR_MODEL_ROUTE_NOT_FOUND` for both — the same request
shape that already resolves correctly for the legacy
`figma-specification-default` profile.

This is **not** described as a confirmed model-name typo. The evidence is
consistent with (and no more specific than) the gateway keying its route
table by profile/agent identity rather than by model name alone, with the
four V2 profile ids below never having been registered. Diagnosing the exact
cause inside the gateway's own configuration is outside what this repository
can observe.

## Required registrations

| Agent identity | Profile id | Configured client model | Role semantics |
|---|---|---|---|
| `design-interpreter-agent` | `design-interpreter-default` | `openai/gpt-4o-mini` | Optional — a failed/unrouted call degrades to the deterministic Blueprint (`semanticStatus: "unavailable"`); the run continues. |
| `project-mapper-agent` | `project-mapper-default` | `openai/gpt-4o-mini` | Required — an unrouted call fails Planning with `ERR_PROJECT_MAPPER_UNAVAILABLE`; zero project writes occur. |
| `ui-builder-agent` | `ui-builder-default` | `openai/gpt-4o-mini` | Required — an unrouted call fails Building with `ERR_UI_BUILDER_UNAVAILABLE`; zero project writes occur. |
| `visual-critic-agent` | `visual-critic-default` | `openai/gpt-4o-mini` | Optional — an unrouted call degrades that partition's advisory annotation only (`critic.status: "unavailable"` or `"partial"`); the deterministic visual findings still stand. |

Source of the model value: as of commit `1306b2f`, all four profiles list
`openai/gpt-4o-mini` as their only candidate — the two previously-listed
fallback candidates (`openai/gpt-5.6-luna`, `deepseek/deepseek-v4-pro`) were
removed as field-proven dead, not replaced with a guess (see that commit and
`packages/agents/src/flagship-model-routing.test.ts`). **Do not treat this
table as the gateway's required schema** — it is only what the client
currently sends; if the gateway needs a different model identifier for one
or more of these profiles, that is the gateway owner's call to make, and the
corresponding client profile should be updated to match once known.

## What has already been ruled out client-side

- Authentication is not the blocker: the run's session was `connected`
  (`designflow doctor` reported `model-provider: healthy`) at the time of
  the failure.
- The three model candidates that failed are not evidence of a broken model
  id in isolation: the identical model string (`openai/gpt-4o-mini`)
  resolves successfully for `figma-specification-default`.
- No repository code change can register a gateway route; this file exists
  because that action is out of this repository's authority.

## Verifying the fix, once made

The safest non-destructive verification is a route-inspection/readiness
endpoint on the gateway, if one exists — this repository does not have one
today and none was invented to close this task (see the V2-10 corrective
task, §12: no fake readiness primitive). Failing that, the next V2-10
acceptance attempt against the real Spendly project and real Figma design is
the verification: `designflow doctor`/`designflow settings` reporting
`connected` is necessary but was already proven **not sufficient** by this
same field defect, so only an actual role invocation (Design Interpreter,
Project Mapper, UI Builder, or Visual Critic reaching Understanding/Planning/
Building/Checking without `ERR_MODEL_ROUTE_NOT_FOUND`) confirms the route is
live.
