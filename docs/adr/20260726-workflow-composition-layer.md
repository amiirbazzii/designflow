# Workflow Composition Layer

**Date:** 2026-07-26
**Status:** Accepted
**Stage:** 21

## Context

Workflows could only compose capabilities. Reusing a workflow from another
workflow required either duplicating its nodes or having workflow packages
reach into `@designflow/core` to run an `ExecutionService` — both of which
violate the import matrix (§5.1) and the domain-decoupling rule (§2.2).

We need a parent workflow to invoke a child workflow such that:

- workflow packages keep depending only on `@designflow/sdk`,
- core never statically imports a concrete workflow package,
- parent and child remain independently installable,
- parent/child execution identity, artifacts and lineage stay auditable.

## Decision

### 1. Composition is a node kind, not a capability

`WorkflowDefinition.nodes` is now a tagged union (`workflowStepNodeSchema`):

```ts
{ id, kind?: "capability", capabilityId, inputMap, execution?, next }
{ id, kind:  "workflow",   workflowId,   inputMap, execution?, next }
```

Modelling composition as a synthetic "run-a-workflow" capability plugin was
rejected: a capability that reaches back into the engine inverts the dependency
direction and hides child executions from the DAG, policy and lineage layers.

`kind` is **optional** on capability nodes so every node authored before this
stage keeps parsing and type-checking unchanged. The union tries the workflow
shape first; absence of `kind: "workflow"` falls through to the capability
shape, which defaults `kind` to `"capability"` semantically.

### 2. Resolution is injected, never imported

`WorkflowExecutionResolver` (SDK) is the sole seam between core and concrete
workflows:

```ts
executeWorkflow(invocation, context): Promise<WorkflowInvocationResult>
```

`ExecutionEngine` takes an optional resolver as its 6th constructor argument.
`ExecutionService` constructs `new ExecutionServiceWorkflowResolver(this)` and
passes it down, so child executions route back through the service that owns
workflow resolution. It is created per service instance — there is no global
singleton — and `ExecutionServiceConfig.workflowExecutionResolver` lets a host
substitute its own.

### 3. Child execution reuses the full ExecutionService path

`ExecutionService` also implements `ChildExecutionContract`:

```ts
executeChild(request: ChildExecutionRequest): Promise<ExecutionResult>
```

Both `execute` and `executeChild` funnel into a private `startExecution`, so
children get the same request validation, workflow resolution, capability
resolution, persistence and event flow. What differs is only the input:
`ChildExecutionRequest` carries a **required** `lineage`, and the policy
context is rebuilt from the *child* workflow's own capability nodes — the
parent's policy decision is never replayed against the child.

Every child gets a fresh `crypto.randomUUID()` execution id and therefore its
own execution record and its own checkpoint slot; the parent checkpoint is
never overwritten.

### 4. Lineage lives in execution metadata

`executionLineageSchema` is stored under the reserved `lineage` key of the
execution record metadata (and of the execution context metadata, so nested
children inherit it):

```ts
{ parentExecutionId?, parentWorkflowId?, parentNodeId?, compositionPath: string[] }
```

`readExecutionLineage` / `withExecutionLineage` are the only supported
accessors. No separate graph store was introduced.

### 5. Cycle protection via composition path

`compositionPath` is the ancestor chain of workflow ids, root first. Before
invoking a child, `WorkflowCompositionExecutor` appends the parent workflow id
(if not already present) and rejects any child already on the path with
`WorkflowCompositionCycleError` (`ERR_WORKFLOW_COMPOSITION_CYCLE`). This covers
`A → A` and `A → B → A` uniformly, and is checked *before* the resolver runs so
no child execution record is created for a cycle.

Cycle and missing-resolver errors are treated as **structural**: they abort the
whole parent run rather than degrading into a single failed step, so the stable
code reaches the `ExecutionResult`.

### 6. Parent resume is node-aware

Blocking on a child approval writes a `compositionCheckpointSchema` payload
under the `composition` key of the parent's `waiting_approval` checkpoint:

```ts
{
  completedNodeIds, completedArtifacts,
  pendingNodeId, childExecutionId, childWorkflowId, childArtifacts,
  pendingNodes,   // every blocked node, so siblings are not dropped
}
```

`ExecutionEngine.resume` reads that state *before* `run()` overwrites the
checkpoint and threads it through `execute()`, which:

- skips nodes in `completedNodeIds` and restores their artifacts,
- resolves each `pendingNodes` entry from the **existing** child execution
  record instead of calling the resolver again — child `completed` → node
  completes with the child's applied artifacts; `failed`/`cancelled` → node
  fails; still `waiting_approval` → parent stays pending,
- runs only the previously blocked downstream nodes.

Resuming therefore creates no second child execution and no second approval
request. The parent keeps its original execution id, so the record and
checkpoint slot are continuous.

Two supporting fixes were needed: execution record metadata is now **merged**
rather than replaced when an execution goes `waiting_approval` (it carries the
lineage and input needed to resume), and `resumeAfterApproval` now marks a
rejected execution's record `failed` — previously it returned a failed result
while leaving the record `waiting_approval`, so a composing parent would have
seen the rejected child as still pending forever.

### 7. Approval never overrides a hard denial

`policyViolationSchema` gained a required machine-readable `type`
(`capability_denied` | `capability_not_allowed` | `approval_required`).
The service enters the approval flow only when **every** violation is an
approval requirement:

```ts
const approvalOnly =
  violations.length > 0 &&
  violations.every((v) => v.type === "approval_required");
```

A `deny_capability` violation alongside a `require_approval` violation now
stays denied. Violation classification is never inferred from message text.

### 8. Execution input propagation

`StartExecutionParams` carries `input`, supplied by both `execute` (root
`ExecutionRequest.input`) and `executeChild` (the child invocation input).
`startExecution` stores it under the reserved `input` metadata key via
`withExecutionInput`, so it is persisted with the record and recoverable on
resume. Passing `undefined` *removes* the key, so a child never inherits its
parent's input by accident.

Nodes consume it with a strict, Zod-validated reference token resolved by
`resolveNodeInput`:

```ts
inputMap: { $workflowInput: true }               // the whole workflow input
inputMap: { greeting: { $workflowInput: "msg" } } // one property of it
```

The token is honoured as the whole `inputMap` and as any of its top-level
values; `.strict()` ensures an ordinary object is never mistaken for a
reference.

### 9. Failure and pending-approval semantics

| Child status | Parent node | Parent execution |
|---|---|---|
| `completed` | completed; child artifacts merged into the parent DAG | continues |
| `failed` / `cancelled` | failed (child error + already-produced artifact ids in metadata) | `failed`; dependents blocked |
| `pending_approval` | not completed, not failed | `pending_approval`, record `waiting_approval`, dependents blocked but not failed |

Genuine failures take precedence over pending approvals in the same run: a
failed sibling means the parent can never complete, so reporting `failed` is
more actionable than reporting a resumable block.

### 10. Events

`workflow.child_started`, `workflow.child_completed` and
`workflow.child_failed` are published on the **parent** execution id with
`{ parentExecutionId, parentWorkflowId, parentNodeId, childWorkflowId, childExecutionId? }`.
They go through the existing `ExecutionEventPublisher` and are mapped by
`ExecutionEventRepositorySubscriber` to the `executing` / `failed` lifecycle
phases (the original event type is preserved in the lifecycle event metadata).
A child blocked on approval publishes `execution.waiting_approval` on the
parent.

## Consequences

- Core gained `packages/core/src/composition/` and one optional constructor
  argument; nothing in core resolves workflow packages.
- Workflow packages are unchanged and still import only `@designflow/sdk`.
- Composition depth is bounded only by the cycle check; there is no artificial
  depth limit.
- `ExecutionResult` (core) gained `pendingApproval`, so the service can
  distinguish a resumable block from a failure without inspecting error text.

## Migration Notes

### Workflow authors

Nothing is required. Existing capability nodes keep working verbatim:

```ts
{ id: "create", capabilityId: "test-artifact", inputMap: { ... } }
```

Adding `kind: "capability"` is allowed and equivalent. To call another
workflow:

```ts
{
  id: "render",
  kind: "workflow",
  workflowId: "wf-react-codegen",
  inputMap: { tokens: "..." },
  execution: { dependsOn: ["parse"] },
}
```

### Embedders of `@designflow/core`

- `CompiledNode` is now a union (`CompiledCapabilityNode | CompiledWorkflowNode`).
  Narrow on `node.kind` before reading `capability` / `capabilityId`.
- `ExecutionStep` is now a union. Narrow on `step.kind` before reading
  `capabilityId` / `workflowId`.
- `ValidationIssue.capabilityId` was replaced by `kind` + `targetId`, which
  covers both node kinds.
- `ExecutionResult` (core) gained a required `pendingApproval` field; construct
  it as `undefined` when not applicable.
- `ExecutionResult.error.code` at the service boundary now reports the
  `DesignFlowError.code` (e.g. `ERR_EXECUTION_FAILED`) rather than the class
  name for errors that carry one. Non-`DesignFlowError` errors are unchanged.
- Hosts that render execution events should handle the three new
  `workflow.child_*` types.
- `PolicyViolation` gained a **required** `type`. Custom `PolicyEvaluator`
  implementations must classify each violation they emit; the message text is
  no longer load-bearing.
- `WorkflowCompositionRequest.inputMap` is now `input: unknown` — it receives
  the node input already resolved against the workflow input.
- `PendingChildApproval` gained `childArtifacts`.
