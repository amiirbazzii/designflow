# Project Context and Agent Memory

**Date:** 2026-08-01
**Status:** Accepted
**Stage:** 40

## Context

Stage 39 gave an agent a way to remember one conversation. It still knows
nothing between conversations — not the project it is working in, not a
preference a person has already told it once. This stage adds two new,
bounded, inspectable knowledge layers on top of the existing Session Context,
assembled into one small, immutable value handed to a decision the same way a
resumed session's clarifications already are:

```
AgentSessionService
  → ContextAssemblyService.getContext({ sessionContext, projectId?, agentId })
      ├── ProjectContextReader   (a project's own facts, exact projectId only)
      └── MemoryReader           (approved memory, exact agentId/projectId only)
  → AgentKnowledgeContext (frozen)
  → merged into WorkerTaskRequest.context = { clarifications, project, memory }
  → AgentTask.context (unchanged shape: Record<string, unknown>)
  → Agent.decide reads task.context.project / .memory defensively
```

No new field was added to `AgentTask`, `AgentContext`, `AgentDecision`, or any
`.strict()` trace schema. Project Context and Agent Memory ride the same
`context: Record<string, unknown>` channel Stage 39's clarifications already
use — the workflow engine, `AgentRuntime`, `ToolRuntime` and `ModelRuntime`
are completely unaware either concept exists.

## 1. Four kinds of knowledge, four different lifetimes

| Layer | Answers | Lives | Written by |
|---|---|---|---|
| Session Context | "what has *this conversation* established?" | one conversation, ≤7 days | the conversation itself (Stage 39) |
| Project Context | "what kind of project is this?" | until the project is replaced/deleted | inspection, config, or a person |
| Agent Memory | "what has been explicitly approved to remember?" | until revoked or expired | a person, directly or by approving a proposal |
| Trace | "what did an agent decide, and did it work?" | the installation's operational history | `AgentRuntime`/`ToolRuntime`/`ModelRuntime`, automatically |

None of the four is a substitute for another. A trace still has no field for
a prompt or a tool payload (Stage 37's discipline, untouched); a session still
has no field for anything beyond one conversation's original request and its
question/answer pairs (Stage 39's discipline, untouched). Project Context and
Agent Memory each add exactly one new discipline of their own — see §5 and
§6 — rather than relaxing either existing one.

## 2. Why Project Context and Agent Memory are product-level, not core-level

The same argument Stage 39 made for sessions applies twice more here.
`packages/core` has never known a worker, an agent, or a session exists;
teaching it that a workflow's decision-maker consulted a project's facts or a
remembered preference would mean teaching the execution engine about product
concepts that do not change what a workflow node does when it runs. Project
Context and Agent Memory are stored in `packages/product`
(`project-store.ts`, `memory-store.ts`, `memory-proposal-store.ts`,
`project-context-service.ts`, `memory-service.ts`), file-backed in
`packages/storage-file` as four new sibling collections
(`projects`, `projectContexts`, `agentMemories`, `memoryProposals`) in the
same shared `FileStore` document sessions, traces and executions already
share — a project, the memory approved for it, and the session that
consulted both are written in one atomic rename, for the same reason a
session and the trace behind it already are.

`packages/product` itself gained no new dependency: every new service still
depends on `@designflow/sdk` alone. Directory inspection — the one place this
stage genuinely needs a filesystem — lives in `@designflow/tools`
(`project-inspector.ts`), wired at the CLI's composition root exactly the way
`ToolRuntime`, `ModelRuntime` and `AgentRuntime` already are. `ProjectService`
declares the `ProjectInspector` *port* it needs; it never imports the
concrete implementation.

## 3. Why the existing `context: Record<string, unknown>` channel was reused

`AgentTask.context` was already an open, additive channel — Stage 39 built it
for exactly one purpose (carrying a resumed session's clarifications) but
documented it as "per-request facts," not "clarifications specifically."
Extending `AgentSessionService` to also populate `context.project` and
`context.memory` needed no SDK schema change: `agentTaskSchema.context` is
`z.record(z.unknown()).optional()` and stays that way. The alternative —
adding `project`/`memory` fields to `AgentTask` or `AgentContext` directly —
would have meant widening two schemas that Stage 35–39 kept deliberately
narrow, for a concept that is genuinely optional per-task, not a structural
part of what a decision is. `packages/agents/src/catalog/design-engineer-agent.ts`
reads `task.context.project`/`.memory` with the same defensive, re-checked
narrowing `readClarifications` already applies — untyped `unknown` in, a
best-effort shape out, silently absent rather than thrown on anything
unexpected.

## 4. Scope semantics

`AgentMemory.scope` is one of three values, and the identifiers each one
requires are enforced structurally (`agentMemorySchema`'s `superRefine`, not
a runtime `if` a caller could skip):

- **`agent`** — needs `agentId`, forbids `projectId`. "This agent, every
  project."
- **`project`** — needs `projectId`, forbids `agentId`. "Every agent, this
  project."
- **`project_agent`** — needs both. "This agent, this project."

There is no wildcard scope. `agentId`/`projectId` are always a specific id;
nothing here accepts `"*"` or "absent means everywhere" — a memory's reach is
always answerable by reading two fields on the record itself, the same
"allow-list, not a wildcard" discipline `AgentManifest.allowedTools` already
established.

## 5. Why Agent Memory requires explicit approval

An agent's own decisions could not, before this stage, cause anything durable
to be written anywhere — the whole design's safety property is that an agent
selects from a reviewed list and nothing more. Letting `Agent.decide` write
directly to `AgentMemoryStore` would break that property for memory the same
way giving an agent an unreviewed tool would break it for actions:
`MemoryProposalService.propose` is the *only* thing an agent-facing surface
may call, and it creates a `pending` proposal, never an active memory.

`approve`/`reject` are called exclusively from a product surface a person
drives — `designflow memory approve <id>` / `memory reject <id>`. The
enforcement is architectural, not a permission check: no `AgentContext` ever
carries a reference to `MemoryProposalService`, so there is no path from
inside `Agent.decide` to an approval call at all. `MemoryProposalService`
additionally checks `approvedBy !== proposal.proposedByAgentId` at runtime
(`ERR_MEMORY_APPROVAL_REQUIRED`) as defense in depth — a second, independent
enforcement of a boundary the architecture already guarantees, the same
"belt and suspenders" reasoning `ToolRuntime` applies by checking permission
*and* budget rather than trusting either alone.

## 6. Conflict and precedence rules

When more than one source could answer the same question, the order is:

1. The current session's own explicit content (never overridden — see below)
2. An explicit project fact (`source: "user"` or `"config"`)
3. Active `project_agent` memory
4. Active `project` memory
5. Active `agent` memory
6. An inspected project fact (`source: "inspection"`)
7. An inferred project fact (`source: "inferred"`)
8. A system default (not modelled by any stage-40 type — an agent's own
   fallback behaviour when nothing above answered)

Two of these are enforced structurally rather than by sorting:

- **Session always wins.** `AgentKnowledgeContext.session` is populated
  directly from the caller's own `SessionContext` and nothing in
  `ContextAssemblyService` ever writes into it — project facts and memory
  arrive in sibling fields (`project`, `memory`) that a decision may read
  *alongside* the session, never merged into it. There is no code path by
  which a memory value could overwrite `session.originalRequest` or a
  clarification answer.
- **`project_agent` beats `project` alone beats `agent` alone.**
  `ContextAssemblyService.selectMemory` builds a `Map<key, AgentMemory>` by
  iterating scopes in ascending precedence (`agent` → `project` →
  `project_agent`) and letting a later write overwrite an earlier one on a
  key collision — the precedence rule *is* the iteration order, not a
  separate comparison that could disagree with it.

Project facts don't collide by construction: `ProjectContextStore.patchFacts`
enforces one fact per key (`applyProjectFactChanges` replaces, never
duplicates), so the "explicit beats inferred" rule only matters for
*truncation* — which facts survive a size bound — not for resolving a
same-key conflict that cannot exist in storage.

## 7. Context-size and truncation policy

`ContextAssemblyService` bounds three things, each with a documented default
(`DEFAULT_MAX_FACTS = 50`, `DEFAULT_MAX_MEMORY = 20`,
`DEFAULT_MAX_TOTAL_CHARS = 8_000`), all overridable at construction:

- Fact count and memory count, capped before serialization is even
  considered.
- Total serialized character budget, shared across whatever survives the
  count cap — `boundByChars` walks the already-sorted list and stops the
  moment the next item would exceed the budget, so truncation never cuts an
  item in half.

Sort order before truncation is deterministic and precedence-driven: facts by
`(sourceRank, key)`, memory by `(scopeRank descending, key)` — so the same
stored state always produces the same truncated result, and what survives is
always the highest-precedence, alphabetically-first material, never an
artifact of iteration order or a `Map`'s insertion history.

`ProjectContextService` enforces a second, independent bound
(`ERR_PROJECT_CONTEXT_TOO_LARGE`, `MAX_FACTS = 200`, `MAX_TOTAL_FACT_CHARS =
40_000`) on the *stored* context, well above the per-decision prompt budget —
a project may accumulate more facts over its lifetime than any single
decision needs to see, and the two bounds are allowed to differ for exactly
that reason.

## 8. Project-inspection safety boundaries

`ProjectInspector` (in `@designflow/tools`) reuses the traversal core Stage 36
already built for the agent-facing `project-summary` tool
(`project-inspection.ts`, extracted from `project-summary.ts` in this stage
with no behavioural change — `registry.test.ts`'s existing containment tests
pass unmodified). Both callers share every guarantee:

- `realpath` before any read, so `../` and a symlinked root resolve to where
  they actually point before anything is trusted.
- Symlinks are skipped during traversal, never followed.
- Only `package.json`'s contents are ever read; every other file is
  name-only.
- Dotfiles and anything matching a `SENSITIVE` name pattern (`secret`,
  `credential`, `password`, `token`, a private-key extension) are skipped
  outright — this is what keeps `.env` and `.git` out by construction, not by
  a rule that has to remember them.
- Hard caps on traversal depth (`MAX_DEPTH = 3`) and entry count
  (`MAX_ENTRIES = 400`).
- No file is ever written, no shell command is ever run, no network request
  is ever made — the entire module is synchronous `node:fs` reads.

What differs between the two callers is *why* the root is trusted: the agent
tool's root is fixed once at construction, a grant reviewable in the CLI's
composition root; the inspector's root is supplied per call, because the
approval already happened one layer up — only a project's own, previously
registered `rootPath` is ever passed to `inspectProject`, never a directory
named at call time.

## 9. Expiration, revocation and deletion

- **Project Context** is durable until the project is replaced (`inspectProject`
  overwrites facts by key) or the project itself is deleted. `ProjectFact.expiresAt`
  exists for a fact with a known shelf life; `ContextAssemblyService` excludes
  any fact whose `expiresAt` has passed, evaluated against an injected clock.
- **Agent Memory** is durable until revoked (`status: "revoked"`, permanent —
  nothing un-revokes a memory) or its own `expiresAt` passes. Both conditions
  are checked at the one place that matters — `ContextAssemblyService.selectMemory`
  — so a revoked or expired memory is structurally incapable of reaching a
  decision even if it is still sitting in the store.
- **Memory Proposals** expire 30 days after creation by default
  (`MemoryProposalService`'s `expirationDays` option) if never resolved; an
  expired-but-still-`pending` proposal is refused at `approve`/`reject` time
  (`ERR_MEMORY_PROPOSAL_EXPIRED`) rather than silently treated as still open.
- **Session Context** keeps Stage 39's existing 7-day policy, unchanged.
- **Deletion**: `ProjectStore`/`AgentMemoryStore`/`MemoryProposalStore` are
  ports a future stage can extend with cascading delete (e.g. "delete a
  project, revoke its `project`/`project_agent` memory") without changing any
  contract shape here — this stage did not need to build that UX to keep the
  store contracts honest, and deliberately left it as a documented limitation
  (§14) rather than a half-built command.

## 10. Why memory cannot alter model, tool, or workflow permissions

Nothing in this stage added a code path that reads a memory *value* to decide
which tool, workflow, or model profile is available. `AgentManifest.allowedTools`,
`.allowedWorkflows`, and `.modelProfileId` are read only from the manifest a
human wrote and the composition root wired — `AgentKnowledgeContext` has no
field shaped like any of them, and `task.context.memory` is folded only into
`buildDecisionPrompt`'s *prompt text* (`decision-prompt.ts`'s
`summarizeFacts`), which a model may read but which the runtime never
consults for permission decisions. A test in
`design-engineer-agent.test.ts` writes a memory value shaped exactly like an
attempted override (`{key: "allowedTools", value: ["shell-exec"]}`) and
confirms the decision is still enforced against the manifest's real
allow-list — the value reaches the model as inert text and nothing else reads
it.

## 11. Session re-resolution policy

`AgentSession.projectId` is snapshotted once, at session creation
(`startSessionForWorker`), the same reproducibility reasoning
`modelProfileId` already documents — a conversation resumes against the same
*project identity* for its whole lifetime, even if that project is later
edited or its root moved. Project Context and Agent Memory are **not**
snapshotted: `ContextAssemblyService.getContext` is called fresh on the first
turn and again on every resumed turn (`answerSessionOnce`), so a fact
inspected or a memory approved mid-conversation is reflected on the very next
decision, never on a decision already in flight. If knowledge assembly itself
fails for any reason, the session proceeds with no project/memory context
rather than failing the conversation — the same "observing must never break
the thing it observes" discipline `AgentSessionService.emit` already applies
to its own event stream.

## 12. How future retrieval or vector search could be introduced safely

Nothing here forecloses adding embeddings or a vector store later, but this
stage deliberately does not build one — "explain the request" is answerable
today with a few dozen named facts and a handful of approved preferences, and
a retrieval layer solves a *ranking* problem that does not exist yet at this
scale. If it is added:

- It should sit *behind* `ProjectContextReader`/`MemoryReader` — narrow ports
  `ContextAssemblyService` already depends on — as an alternative
  implementation, not a new code path in the assembly service itself. The
  precedence and truncation rules in §6–7 should keep applying to whatever a
  retrieval step returns.
- It must not become a new place secrets or raw file contents leak in by the
  back door — any indexed content still has to pass through the same
  `looksSecretLike` boundary `ProjectFact`/`AgentMemory` already enforce.
- It should not be allowed to search across projects or agents by default —
  the "exact scope only" guarantee in §6 is a security property, and a
  similarity search that ignores `projectId`/`agentId` would quietly break
  it.

## 13. Export and delete as ports

`ProjectStore`, `ProjectContextStore`, `AgentMemoryStore`, and
`MemoryProposalStore` are all narrow ports with `list`/`get` methods already
sufficient to build an export command against (`designflow projects export`,
say) without any new store method. Deletion is one step further: the ports as
built support `revoke`/`update`/`patchFacts` but not a `delete` verb on
identity records, by design (§9) — a future stage adding
`deleteProject`/cascading revoke can do so additively, the same way this
stage added four new collections to `StoreDocument` without touching any
existing one.

## 14. Known limitations

- The CLI is flag/positional-argument driven (`designflow memory add --scope
  agent --agent "<name>" --key ... --value ...`), matching the existing
  `sessions`/`answer`/`cancel` convention, rather than the interactive
  wizard sketched in the stage brief — consistent with how every other
  multi-field CLI command in this codebase already works, and avoids adding
  a second input style alongside it.
- There is no `designflow projects delete` command yet, and no cascading
  revoke of a deleted project's memory — see §9 and §13.
- `ProjectFactCandidate`/inspection heuristics (framework, design-system
  package, design-system directory, test framework) are a fixed marker list,
  the same limitation `project-summary`'s framework detection already had —
  extending the list is additive and requires no schema change.
- `ContextAssemblyService`'s memory-scope precedence assumes at most three
  scopes ever exist; adding a fourth would need the ascending-precedence
  array (`MEMORY_SCOPE_PRECEDENCE`) reviewed alongside it.
- No UI exists yet for a person to browse *all* memory across every
  agent/project at once with pagination — `designflow memory` lists active
  memory optionally filtered by `--project`/`--agent`, sufficient for this
  stage's scale.
