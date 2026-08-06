# MVP-3A — Agent-Centric Flagship Journey Audit and Productization Plan

1. **Audit date:** 2026-08-06
2. **Commit:** `bab0022` (branch `main`); working tree clean except local
   `.claude-flow/` state. Package `designflow-ai@0.1.1`. Validation at
   baseline: build 26/26, typecheck 44/44, lint 26/26, tests 2,337 / 1
   skip / 0 fail. **Audit only — no implementation was performed.**

---

## 3. Current user journey (verified, file:symbol)

`designflow run design-engineer` → `cli.ts:dispatch` (only `--project`,
`--no-cache` flags) → `runCommand` (`commands/run.ts:39`) →
`resolve` (`cli-runner.ts:895`; special-cases the literal workflow id
`design-to-code-implementation` into a synthetic worker at :916) →
pre-session gate (`run.ts:57-65`: implementation mode requires
`--project`, except on the direct-workflow path, which bypasses it) →
`collectInput` (`run.ts:166`; empty answers silently substitute
placeholders) → input mutation (`run.ts:89-136` — the routing lever:
injects `project`, state directory, agent versions, profile ids;
deletes `projectId`) → `sessions.startSessionForWorker`
(`session-service.ts:246`) → **coordinator decision**
(`design-engineer-coordinator` via `AgentRuntime`; strategy fixed at
wiring: model iff `OPENROUTER_API_KEY` present) with fixed precedence
(`design-engineer-agent.ts:112-126,322`): implementation if
`project` present ∧ workflow available → figma-spec if
`figmaSourceMode !== "placeholder"` → else `design-to-code`; outcomes
limited to `run_workflow` / `request_clarification` / `decline`; the
model can only choose in the plain case and is re-validated against
`availableWorkflows` → clarification loop (`session-flow.ts:38`,
resumable via `designflow answer <id>`, turn-limited) → inline approval
prompt (`resolveApproval`, `session-flow.ts:137`; implementation runs
get a file-change preview at :278; **no `designflow approve` verb
exists** — an abandoned prompt has no CLI resume path) → report
(`session-flow.ts:173`) → `artifacts` / `traces` / `history`.
The feedback loop (`commands/feedback-loop.ts:799`) is **not reachable
from this flow**: it requires a hand-authored `--input` JSON satisfying
a ~20-field `.strict()` schema (including a literal workflow id and
sha256 fingerprints) or a pre-existing parent id; failures print one
unactionable line.

**Scenario outcomes (a–j)** — summarized from the full trace:
no key = fully deterministic mode (honest doctor guidance); key set =
model strategies everywhere (empty-string key deliberately errors);
no Figma = placeholder mode; Figma flag on with a malformed
`figmaMcp` block still sets a non-placeholder `figmaSourceMode`
(`cli-runner.ts:978`) — **routing to MCP with no MCP client**;
implementation flag **implies** the Figma flag (`cli-runner.ts:530`)
and makes project selection mandatory; feedback loop reachable only
under the implementation flag + hand-authored JSON.

**Internal-vocabulary exposure points (all verified):** the two
experimental config keys (named in no command, help, settings, or
doctor output — doctor says "explicitly enable the experimental
integration" without naming the key, `doctor.ts:94`); the
`settings.figmaMcp` block (documented only in a source docstring);
the typed workflow id for direct implementation runs; the feedback-loop
JSON contract; artifact ids as CLI arguments; model profile ids for
overrides; `projects` and `memory` commands absent from `--help`;
Stage-3/4/5/6 terminology in help, artifact names, and persisted
approval comments.

## 4. Current agent participation map (verified)

| Agent | Type | Ver | Profile → default model | Paths | Registration |
|---|---|---|---|---|---|
| `design-engineer-coordinator` | routing | 0.1.0 | `design-engineer-coordinator-default` → gpt-4o-mini | all (worker entry) | production |
| `design-engineer-agent` | routing alias | 0.3.0 | `design-engineer-default` | legacy sessions only | production (compat) |
| `figma-specification-agent` | specialized | 0.2.0 | `figma-specification-default` | figma-spec | experimental-gated |
| `implementation-agent` | specialized | 0.1.0 | `implementation-default` | implementation | experimental-gated |
| `visual-validation-agent` | specialized | 0.1.0 | `visual-validation-default` | implementation/stage-5 | experimental-gated |
| `visual-correction-agent` | specialized | (sdk const) | `visual-correction-default` | feedback loop | experimental-gated |

Two cleanly separated runtimes: `AgentRuntime` (routing only) and
`AgentInvocationRuntime` (specialists only, invoked exclusively by
workflow-node capabilities — an agent cannot reach another agent;
`SpecializedAgentContext` has no field for it). All agents are
independently constructible with per-agent strategies and typed SDK
contracts; model failure declines rather than silently degrading.
**Project intelligence is deterministic** (bounded walker
`project-inspection.ts`, `inspect-registered-project` capability,
`ContextAssemblyService`) — correctly not an agent; no conversion is
recommended. Specialist artifacts embed agent identity (schema-enforced
literals for validation/correction); the registry's provenance triple
is `{executionId, workflowId, capabilityId}` — agent/model identity is
absent from registry provenance (traces carry it, but traces link to
runs, not artifacts).

## 5. Current workflow map and recommended tiers

| Workflow | Nodes | Writes? | Current | Recommended MVP tier |
|---|---|---|---|---|
| `design-to-code` (public placeholder) | 5 | No (artifacts only; validation cannot fail by construction) | always-on default | **DEPRECATED from the user journey / COMPATIBILITY_ONLY** (see §9) |
| `design-to-code-figma-specification` | 4 | No | experimental (Figma flag) | **SUPPORTED** (spec-only outcome) — note: it currently has **no approval rule**; acceptable (read-only) but must be stated |
| `design-to-code-implementation` | 23 | **Yes** (snapshot/apply/validate/rollback) | experimental (impl. flag) | **SUPPORTED** journey core, behind explicit consent + MVP-4 evidence gate |
| `design-to-code-feedback-loop` | 16 | **Yes** | experimental (same flag) | **BETA** (bounded, per-iteration approval; max 8 iterations hard cap) |
| `design-to-code-agent-foundation` | 5 | No | unregistered | **INTERNAL** |
| `test-workflow` / legacy `wf` CLI | 1 | No | legacy app | **INTERNAL/DEPRECATED** |

Hidden paths: `resolve()` runs any registered workflow by id;
`run design-to-code-implementation` bypasses the `--project` guard and
collects `projectId` as a form field. Both must be closed or aligned in
MVP-3B.

## 6. Current configuration / prerequisite map

Exact keys (all under `~/.designflow/config.json` unless noted):
`settings.experimental.designEngineerFigmaMcp`,
`settings.experimental.designEngineerImplementation` (registers
implementation *and* feedback loop; implies the Figma flag),
`settings.figmaMcp.{transport,command,args,url,envPassthrough,captureScreenshots,connectTimeoutMs,requestTimeoutMs,maxResponseBytes}`,
`settings.models.profiles.<profileId>.{providerId,model,temperature,maxOutputTokens,timeoutMs}`,
`settings.sessions.{maxClarificationTurns,expirationDays}`,
top-level `databasePath`; env `OPENROUTER_API_KEY` (sole credential
path), `DESIGNFLOW_HOME`, `DESIGNFLOW_DEBUG`; CLI `--project`,
`--no-cache`, `--input`, `--json`.

**Recommended classification:**
- `designEngineerFigmaMcp` → **convert to automatic detection**: a valid
  `figmaMcp` block *is* the intent; a separate boolean the docs never
  name adds only friction. (Safety unchanged — it gates read-only
  workflows.)
- `designEngineerImplementation` → **keep an explicit opt-in consent
  gate** (it unlocks project writes) but **rename and surface it**
  (e.g. `settings.designEngineer.allowProjectChanges` set by an explicit
  command with printed consent language). Never auto-enable.
- Feedback loop → its own **beta** visibility tied to the same consent;
  no separate flag needed at MVP.
- `figmaMcp.*` → keep user-visible, add a setup command + doctor naming.
- Model profile overrides → keep; add read surface (see §12).
- Session settings, `databasePath`, env vars → keep as-is.
- `figmaSourceMode`, agent versions, profile ids injected by `run.ts` →
  keep internal (never user-supplied).
- Fix within MVP-3B: derive `figmaSourceMode` from *successful* config
  parse, not the raw flag (`cli-runner.ts:978` hazard).

## 7. Current artifact / provenance map

~26 stable logical artifacts across the four paths (full table
verified): figma source snapshot (with in-payload MCP provenance),
design specification, project implementation context (fingerprinted),
design-system mapping, implementation plan (payload
`agent{id,version,modelProfileId}`), proposed-file-changes
(hash-bound), approval, snapshot, application result, validation
report, generated implementation, screenshot/DOM evidence, comparison
metrics (pinned algorithm version), visual report, stage summaries,
and 16 feedback-loop artifacts. Lineage (`derived_from`) is added by
the engine for every artifact automatically; redaction applies on
every read; payload display bounded at 20k chars.

**Gaps found (with severity):**
- `designflow artifacts` cannot show feedback-loop artifacts (stub
  output only) and cannot reach child-execution artifacts from a parent
  run id (`artifacts.ts:34-47,89`).
- `artifacts.ts:135-136` prints "No project files were changed."
  **unconditionally**, even for `file-application-result` — a stale
  Stage-1 assumption contradicting the implementation path.
- Registry provenance lacks agent/model identity; traces have it but
  there is no artifact→trace link.
- `implementation-side-effect-capabilities.ts:19` hardcodes
  `agentVersion: "0.1.0"`, `modelProfileId: "implementation-default"`
  into `generated-implementation` — misreports provenance under
  overridden profiles.

## 8. Recommended canonical command

**`designflow run design-engineer`** — unchanged, no new verbs for the
core journey. Required input: request/design source (Figma URL or
file), framework, optional frames, and (for project changes) a
registered project via `--project` or the interactive picker.
Compatibility: the command already routes correctly; productization is
about prerequisites, consent, naming, and output — not new plumbing.
Users must never type `design-to-code-implementation`, stage names, or
agent ids; the direct workflow-id fallback for gated workflows should
stop being a user path (keep id fallback for the four public workflow
ids only, or hide entirely).

**Prerequisite resolution (progressive, not up-front):** at
run-start, check only what the chosen depth needs — key absent →
one-line deterministic-mode notice + how to enable live mode; Figma
config absent/invalid → offer spec-from-placeholder or setup guidance
naming the exact keys; no registered project → offer spec-only outcome
or `projects add` guidance; Playwright/browser missing → only when the
visual stage is reached, degrade with the existing
`renderer_unavailable` honesty; dirty Git target → existing write-gate
already blocks at snapshot time. Doctor must name the exact config
keys it currently alludes to.

**Routing behavior:** coordinator precedence stays exactly as
implemented (clarify → spec-only → full implementation → decline);
it already cannot invent workflow ids (`availableWorkflows`
re-validation). The one change: routing inputs must reflect *parsed*
configuration (the `figmaSourceMode` fix).

**Output behavior (role-named stages):** "Understanding your request"
(coordinator) → "Reading your project" → "Reading the design (Figma)"
→ "Design specification ready (Design Specification agent)" →
"Implementation proposal ready (Implementation agent) — N files" →
approval preview (exists today) → "Applied and validated / rolled
back" → "Visual check (Visual Validation agent): status, findings" →
"A correction pass is available (beta)" → artifacts + run id. Progress
currently de-slugs capability ids; MVP-3D maps them to role labels.

## 9. Placeholder-workflow decision — **Option C** (deprecate from the user journey)

Evidence: the placeholder's five capabilities are deterministic string
manipulation over typed-in frame names; it never opens a design file;
its validation step cannot fail by construction; its output is
`export function Name() { return null; }` — while the worker line
users see claims "Transforms designs into production-ready
applications" (`design-engineer.ts:16`) and the workflow describes
itself as "production-ready code artifacts" (`workflow.ts:22`,
`manifest.ts:17`). The README's honest "structural placeholder" caveat
never reaches the CLI.

**Recommendation:** route new users through the supported
spec/implementation journey; when prerequisites for it are absent,
offer an honestly-labeled "design scaffold (prototype)" outcome rather
than presenting the placeholder as the product. Keep the
`design-to-code` workflow id registered (COMPATIBILITY_ONLY — history,
artifacts, and reuse identities reference it; 0.1.1 is unreleased so
the burden is small) but: fix the three description strings
immediately, remove it as the flagship's default claim, and never let
two commands both claim "Figma to Code". Explicitly rejected: Option A
(silently swapping an artifacts-only command's behavior to one that
writes projects violates safety expectations); Option B alone (renaming
without rerouting leaves the flagship worker pointing at a stub).

## 10. Proposed MVP product contract

- **Product:** DesignFlow Design Engineer.
- **Entry point:** `designflow run design-engineer`.
- **Supported outcome:** from a real Figma source and a registered
  project — a reviewed, explicitly approved, snapshot-protected,
  atomically applied, validated (with rollback) implementation change
  set, plus a deterministic + agent-interpreted visual verification
  report; every step recorded as inspectable artifacts with lineage.
  Spec-only outcome supported when no project is selected.
- **Stages (agent/deterministic):** coordinator (intent, eligibility,
  clarification, routing) → deterministic project inspection →
  deterministic Figma retrieval (MCP) → Figma Specification agent →
  deterministic design-system mapping → Implementation agent →
  deterministic proposal/hash binding → human approval → deterministic
  snapshot/apply/validate/rollback → deterministic evidence capture +
  comparison → Visual Validation agent.
- **Beta:** visual correction loop (bounded ≤ 8 iterations,
  per-iteration approval, explicit beta label); pending MVP-4 evidence:
  live-model quality, real-Figma transports, browser capture.
- **Non-goals (MVP):** web dashboard; Supabase/team mode;
  PRD-to-Handoff productization; general agent-graph runtime;
  arbitrary agent swarms; automatic unapproved writes; full AST
  intelligence; validated multi-transport Figma support beyond what
  MVP-4 proves; equal maturity across the four workers (QA/Research/PM
  remain standard workers, not flagship).
- **Safety contract (unchanged authority):** proposal before write;
  explicit approval; snapshot; atomic apply; validation; rollback;
  bounded correction; root cancellation (130/EPIPE semantics);
  artifacts + provenance. Agents decide and propose only; the
  coordinator holds no write/shell/approval/rollback/retry authority.

## 11. Prerequisite and clarification behavior

As §8; clarification stays coordinator-owned with the existing
turn-limited session loop and `designflow answer` resume. Add the
missing approval resume path (a `sessions`-surfaced pending-approval
listing plus an approve/reject verb or `answer`-style reentry) —
today, quitting at the inline prompt strands the run.

## 12. Model-profile configuration assessment

Mechanics are healthy: nine built-in profiles, per-profile
`{providerId, model, temperature, maxOutputTokens, timeoutMs}`
overrides merged field-wise with hard failure on invalid input;
independent per-agent strategies; deterministic fallback when the key
is absent. **Gaps:** no CLI command reads or writes overrides (hand-
edited JSON keyed by profile ids shown nowhere), and `settings` walks
workers only — the five specialist/alias profiles are invisible.
Classification: **MVP documentation need + small MVP-3C visibility
item** (show all profiles + their ids in `settings`); a write-command
is a **post-MVP enhancement**. Not an MVP blocker: overrides work and
defaults are sane.

## 13. Real-environment evidence boundary (per feature)

| Feature | Current best evidence | Productize in MVP-3? |
|---|---|---|
| Coordinator routing/clarification | unit + integration + installed-CLI | yes |
| Public scaffold outcome | installed-distribution | yes (relabeled) |
| Figma spec via MCP | fake-MCP integration | yes, labeled; live proof in MVP-4 |
| Implementation propose/approve/apply/rollback | integration + fake-MCP + subprocess (SIGINT/EPIPE) | yes behind consent gate; real apply proof in MVP-4 |
| Visual capture/comparison | integration incl. real preview/Playwright units | yes; real browser journey in MVP-4 |
| Visual correction loop | integration | **beta until MVP-4** |
| Live OpenRouter quality | 1 skipped credential-gated test | MVP-4 |
| Real Figma transports | none (fake only) | MVP-4 |

## 14. Implementation slices for MVP-3

**MVP-3B — Product contract and command routing.**
Objective: canonical journey + honesty + gating fixes. Files:
`packages/workers/src/catalog/design-engineer.ts` (description),
`workflows/workflow-design-to-code/src/workflow.ts` + `manifest.ts`
(strings), `apps/designflow-cli/src/services/cli-runner.ts`
(auto-detect Figma config; consent-gate rename with migration read of
the old key; `figmaSourceMode` from parsed config; close/align the
direct-workflow-id and `--project`-bypass paths),
`apps/designflow-cli/src/commands/run.ts` (prerequisite messages),
`services/doctor.ts` (name exact keys), plus focused tests
(routing, gating, message assertions; existing figma/stage4 suites
must stay green with the renamed gate via compatibility read).
Acceptance: unflagged install reaches an honestly-labeled scaffold or
setup guidance; consent gate explicit; no internal ids required.
No real-environment evidence required. Compatibility: config key
migration message; smoke-test gating assertion updated.

**MVP-3C — Configuration and onboarding.** Objective: setup surface.
Files: `commands/settings.ts`/`cli-runner.ts` (show all model
profiles + ids; show experimental/consent state), a `figma` setup
guidance path (likely inside `doctor` + a `settings`-adjacent
command), `usage()` in `ui/terminal.ts` (document `projects`,
`memory`, `run --project`, `--no-cache`), README/USER_GUIDE
corrections (stale "never writes" claims). Tests: settings/doctor
snapshots, smoke additions. No real-environment evidence required.

**MVP-3D — User-facing progress and artifacts.** Objective: role-named
progress + truthful artifact surfaces. Files: `packages/product`
progress/narration mapping, `commands/artifacts.ts` (fix the
unconditional "No project files were changed."; render feedback-loop
and child-execution artifacts; render key summary metadata),
`implementation-side-effect-capabilities.ts` (thread real
agentVersion/profileId — small production fix, justified by the
provenance bug), optional artifact→trace hint. Tests: artifact
rendering, provenance threading. No real-environment evidence
required.

**MVP-3E — Beta correction-loop integration.** Objective: reachable,
labeled, bounded. Files: `commands/session-flow.ts` (offer the
correction pass after a completed visual report), `commands/
feedback-loop.ts` (generate the input JSON from the parent run instead
of demanding hand-authored fingerprints; keep `--input` for advanced
use; replace Stage-6 wording with "correction (beta)"), tests
(generated-input path, per-iteration approval, bound enforcement).
Acceptance: user reaches the loop from a run without writing JSON;
every iteration approval-gated; beta labeled. Real-environment
evidence NOT required for the wiring, but the loop stays beta until
MVP-4.

## 15. Evidence requirements
MVP-4 (real-environment gate) must supply: live OpenRouter run,
real Figma MCP (per transport shipped as supported), Playwright
browser capture on a clean machine, real apply/validate/rollback on a
real registered project, and a correction iteration on real evidence —
matching launch gates G-06…G-10.

## 16. Blocker table

| Finding | Classification |
|---|---|
| Experimental flags named nowhere user-visible (journey unreachable) | MVP_3_BLOCKER (3B) |
| Flagship "production-ready" claim vs placeholder behavior (3 strings) | MVP_3_BLOCKER (3B) |
| `figmaSourceMode` derived from flag, not parsed config (MCP-less MCP routing) | MVP_3_BLOCKER (3B) |
| Direct workflow-id path bypasses `--project` guard; unrestricted id fallback | MVP_3_BLOCKER (3B) |
| No approval-resume verb (stranded pending approval) | MVP_3_BLOCKER (3B/3D) |
| `artifacts` prints "No project files were changed." unconditionally | MVP_3_BLOCKER (3D) |
| Feedback loop reachable only via hand-authored strict JSON | MVP_3_BLOCKER (3E) |
| Hardcoded agentVersion/profileId in `generated-implementation` | MVP_3_BLOCKER (3D, small) |
| Specialist model profiles invisible in `settings`; no override docs | DOCUMENTATION_ONLY + small 3C item |
| `usage()` omits `projects`/`memory`/flags; Stage-N terminology in UX | DOCUMENTATION_ONLY (3C/3E) |
| README stale "never writes"/"not connected" claims | DOCUMENTATION_ONLY (3C) |
| Live model/Figma/browser/apply proof | MVP_4_REAL_ENVIRONMENT_GATE |
| Artifact→trace linkage; child-artifact reachability beyond 3D minimum | POST_MVP |
| figma-spec workflow has no approval rule (read-only) | NO_ACTION (state in docs) |
| **L1-06 visual-validation type cleanup** | **POST_MVP** — type-annotation defect only; consumers re-parse with correct schemas; zero user-journey impact; does not block the supported product |

## 17. Agent-centric architecture rules (binding for MVP-3)
Coordinator understands/clarifies/routes/declines only — no writes,
shell, approvals, rollback, retries. Specialists keep independent
identity, model profile, typed contracts, and are invoked only by
deterministic workflow capabilities. Engine/capabilities keep all side
effects, ordering, validation, evidence, bounds, and security.
Deterministic project inspection stays deterministic. No merging of
specialists into one prompt; no public exposure of registries; no
autonomy theater.

---

# Implementation status — MVP-3D: role progress, artifact visibility, provenance (2026-08-07)

**MVP-3D is implemented.** MVP-3E remains open; MVP-3 is NOT complete.

- **Presentation view-model** (`apps/designflow-cli/src/services/presentation.ts`,
  pure/typed): capability→{agent role | deterministic stage} mapping (roles
  only for the four real agent-invoking capabilities; everything else uses
  deterministic-stage language; unmapped ids fall back to the existing
  de-slug — raw ids never print by default), artifact stage-grouping,
  evidence marking, provenance join, related-execution projection, and
  run/visual outcome classification. Role vocabulary stays in
  `readiness.ts` (`designRoleName`), so the source-vocabulary scan needed
  no new exceptions — pinned by a test.
- **Progress & summaries** (`session-flow.ts`): progress lines render
  role/stage labels; final summaries now cover specification-only (with
  the producing role from the artifact's own provenance), applied +
  validated, rolled back with reason, rejected, and cancelled — all
  artifact/state-derived; visual outcome sentence derives from the
  stage-5 summary's `overallStatus` (passed / inconclusive / unavailable
  never conflated).
- **Artifacts command:** stage-grouped default listing for design runs
  (plain list preserved for other workers), a producer line per artifact
  (role vs "(deterministic step)"), provenance lines in the detail view
  with "Producer details: not recorded in this artifact version" for
  historical gaps, evidence payload bodies suppressed (screenshot bytes
  never print), redaction + 20k truncation untouched. The feedback-loop
  parent stub is replaced by a real listing (outcome, stop reason,
  iteration count, final report) plus a **Related executions** section.
- **Parent/child visibility:** persisted relations only — new additive
  `ProductExecutionService.listChildOverviews` /
  `WorkflowRunner.children()` read execution-lineage metadata; feedback
  iterations come from the parent store's own records. Each related run
  shows status/outcome lines and its `designflow artifacts <child-id>`
  inspect command. No timestamp/name inference; no artifact duplication
  or identity change.
- **Provenance correction:** the hardcoded
  `agentVersion "0.1.0"` / `modelProfileId "implementation-default"`
  literals in `store-generated-implementation` are gone — the workflow
  node now maps `implementationAgentVersion` /
  `implementationAgentModelProfileId` through its (previously empty)
  inputMap and the capability threads them. **Hash-safety verified:** the
  generated-implementation payload participates in no approval hash,
  reuse fingerprint, or staleness objectHash (approval binds proposal
  hash + project fingerprint; staleness hashes visual reports and
  project files). The input-identity change intentionally invalidates
  reuse of the mis-provenanced node. Historical artifacts are not
  rewritten. Limitation (recorded): strategy mode (model-backed vs
  deterministic fallback) is not displayed — joining a traced model call
  to a specific invocation isn't cleanly available without a trace-store
  redesign; provenance shows only what artifacts recorded.
- **Provider display:** every user-facing surface (workers detail,
  settings summary, settings specialists) routes through
  `displayProviderName` (openrouter → OpenRouter; unknown ids pass
  through); canonical ids retained in structured output. The installed
  smoke's raw-provider check was **promoted from warning to hard
  failure** after a zero-occurrence run.
- **Traces command:** role/stage labels replace raw
  `Specialized agent: <id>` / `Step: <capabilityId>`; model calls show
  provider display name, profile, status, and only usage fields actually
  reported (no zero-filled tokens or invented cost).
- **Tests:** 30 new (24 presentation-projection, 3 artifacts-grouping,
  1 settings, 2 workflow provenance incl. a source-level
  no-hardcoded-literal assertion) plus strengthened cli/stage6
  assertions. Suites: CLI 368/1 skip/0, workflow-design-to-code 94/0,
  product 221/0.
- **Smoke hardening en route:** fixed a latent stdin-drain hang in the
  smoke's gating step (`run <workflow-id>` without `</dev/null>` blocks
  when the harness stdin is a held-open pipe) — same class as the
  MVP-3B fix.
- **Validation (serial):** smoke PASS (exit 0, zero provider warnings,
  hard check active); freshness verifier PASS; full forced suite build
  26/26, typecheck 44/44, lint 26/26, tests **2,408 pass / 1 skip /
  0 fail**. No live services contacted.
- **Remaining:** MVP-3E (reachable beta correction loop from the
  canonical journey, generated input, per-iteration approval, beta
  labeling), then MVP-4 real-environment evidence.

---

# Implementation status — MVP-3C: onboarding, readiness, and discoverability (2026-08-06)

**MVP-3C is implemented.** MVP-3D/3E remain open; MVP-3 is NOT complete.

- **Shared readiness model** (`apps/designflow-cli/src/services/readiness.ts`):
  one typed, side-effect-free model — pure
  `buildDesignEngineerReadiness(facts)` plus a CLI assembler — deriving
  model mode (live vs deterministic fallback), Figma connection
  (missing vs invalid vs configured, transport; discriminated on top of
  the existing `readFigmaMcpConfig` result with no second parser),
  project counts, Playwright package vs browser runtime, journey
  readiness with reasons and real next-step commands, and the beta
  status of visual correction. It is the single source for `doctor`,
  `settings`, and `run design-engineer` guidance — the same sentence
  appears in all three (test-pinned), so the surfaces cannot drift.
  No credential value is read, printed, or persisted.
- **Doctor:** new "Design Engineer readiness" section (model mode with
  the env-var name, Figma status/transport/next step with the real
  config path, projects, Playwright package vs browser distinguished,
  journeys — implementation explicitly noted as still requiring per-run
  journey consent AND later exact-proposal approval; visual correction
  labeled beta, not yet connected). Exit rules unchanged and documented:
  incomplete-but-usable setups exit 0; only genuinely broken setups fail.
  Readiness also appears in `doctor --json`.
- **Settings:** configuration path/exists/parsed; model mode; the five
  Design Engineer roles (Coordinator + Figma Specification /
  Implementation / Visual Validation / Visual Correction (beta)
  specialists) each with its own profile id, provider, model, and
  numeric settings, per-field `built-in` vs `override` provenance from
  the same merged registry a run resolves against; safe Figma metadata
  (transport, host:port or command basename, envPassthrough NAMES only);
  feature tiers (supported-pending-MVP-4 / beta / compatibility-only).
  Other workers' assignments retained; profile independence visible.
- **Onboarding:** package README gained a quick start (install/npx →
  doctor → optional `OPENROUTER_API_KEY` → real `figmaMcp` stdio and
  http examples → `projects add` → run; consent vs approval
  distinguished) plus a supported-fields model-override example, tier
  table, and limitations; root README's stale claims ("does not yet read
  a real design file", "no worker writes files") replaced. README
  examples are parse-verified against the actual schema by a test.
  usage() now lists doctor/settings/projects and the package/npx names.
  The hidden `settings.experimental.*` keys appear nowhere in the setup
  path (compatibility reads remain).
- **Smoke:** new onboarding-discoverability step (doctor readiness
  section + deterministic-fallback line + no experimental keys; settings
  role names + no credential patterns; help names doctor) — PASS. One
  non-fatal pre-existing-class warning: the specialists section prints
  the raw provider id `openrouter` (display-name mapping is an MVP-3D/5
  cosmetic item, deliberately kept loud by the smoke script).
- **Tests:** 43 new/updated (26 readiness-matrix, 7 settings, 4 doctor,
  3 run-guidance, 3 README-example). Two scoped deviations, both forced
  by the existing source-vocabulary scan: `services/readiness.ts` is now
  the one sanctioned home for the human role vocabulary, and help says
  `designflow run <worker>` rather than embedding the worker id literal.
- **Validation:** smoke exit 0; freshness verifier PASSED; full forced
  suite build 26/26, typecheck 44/44, lint 26/26, tests 2,378 pass /
  1 skip / 0 fail. No live services contacted.
- **Remaining:** MVP-3D (role-named progress, feedback-loop/child
  artifact rendering, provenance-literal fix, provider display names),
  MVP-3E (reachable beta correction loop), then MVP-4 evidence.

---

# Implementation status — MVP-3B reconciliation: genuine coordinator intent routing (2026-08-06)

**The reconciliation is implemented.** MVP-3C/3D/3E remain open.

- **Why prerequisite-only routing was insufficient:** the first MVP-3B
  pass made routing purely a function of what was *permitted* (Figma,
  project, consent), removing the coordinator's model call entirely. Safe,
  but not agent-centric: when both journeys are permitted, "document this
  frame" and "implement this frame" must route differently — permission
  cannot substitute for understanding the goal.
- **Responsibility split (final):** deterministic prerequisite resolver
  (host) → produces allowed PRODUCT ACTIONS and safe facts → coordinator
  agent interprets intent among them → deterministic validator re-checks
  the choice and translates it to a workflow. The coordinator never sees
  or selects workflow ids; a model answer can narrow behavior but never
  broaden authority.
- **Product-action contract** (`packages/agents/src/decision-prompt.ts`):
  `create_specification` / `prepare_implementation` /
  `request_clarification` / `decline`; flat provider transport with a
  per-request action enum; `productActionFromTransport` refuses actions
  outside the allowed set; `buildProductActionPrompt` carries action
  descriptions and host facts (Figma connected, project selected, consent
  given, classifier verdict) — no secrets, ids, config, or registry
  objects.
- **Model-backed behavior:** when a route exists and the request is
  meaningful, the coordinator makes exactly one model call through its
  own profile (`design-engineer-coordinator-default`, overridable,
  independent settings) via the existing model runtime — normal
  provenance/trace recording applies. Choice → deterministic translation
  → post-decision revalidation against live prerequisites; a disallowed
  or invented answer becomes a typed decline/clarification, never the
  placeholder. Model failure declines with a safe reason.
- **Deterministic fallback (no credential):** same contract, conservative
  intent reading — explicit specification vocabulary (or
  "do not change …") wins even with a consented project; explicit
  implementation vocabulary routes to implementation only when permitted
  and clarifies (naming the missing prerequisite, no internal ids)
  otherwise; unrecognisable non-design requests decline; ambiguous
  design requests clarify. For form-style requests with no prose, the
  explicit yes to "Prepare changes for this project?" this run is the
  intent signal — documented deliberately: consent is an answered intent
  question, not mere project presence, and a specification-worded request
  still overrides it.
- **Hard short-circuits (zero model calls):** no supported route (setup
  guidance), nothing to decide (empty request/input), malformed Figma
  config (unavailable upstream). Test-pinned.
- **Consent unchanged:** per-run, non-persisted, distinct from proposal
  approval; permits implementation as an *option*, never forces it.
- **Tests:** product-action transport/refusal; model-backed intent
  routing (one call, own profile, spec-over-impl when asked, disallowed
  and invented answers refused, prerequisite-absence short-circuits with
  zero calls, input passthrough); deterministic intent matrix; source
  boundary test pinning `productActionFromTransport` and the absence of
  workflow-id transport in the DE strategy. CLI/API suites unchanged and
  green (their no-Figma harnesses exercise the short-circuit paths, so
  model-mode expectations still hold). No safety authority moved into any
  agent.

---

# Implementation status — MVP-3B: canonical routing, gating, and honesty (2026-08-06)

**MVP-3B is implemented.** MVP-3C/3D/3E remain open; MVP-3 is NOT complete.

**Canonical routing contract (as shipped):**
- Route A (specification): real Figma source (validated availability) →
  `design-to-code-figma-specification`; explicitly reported as
  "Design specification generated — no project files were written."
- Route B (implementation): Figma + registered project + **explicit
  per-run journey consent** → the implementation pipeline with all
  deterministic safety gates unchanged. Consent is asked at the terminal
  ("Prepare changes for this project? … nothing is written until you
  approve that exact proposal"), is distinct from proposal approval, is
  not persisted, and must be supplied explicitly on piped invocations.
  Declining consent continues as specification-only. Project presence is
  never consent (`wantsImplementation` additionally requires
  `projectWriteConsent === true` — defense in depth at the strategy).
- Route C (clarification/setup): no Figma → deterministic CLI setup
  guidance naming `designflow doctor` (never internal flags/ids) before
  any session; in-session gaps → coordinator clarification with the same
  vocabulary rules. Route D (decline) unchanged.
- The coordinator's model strategy no longer performs any model call:
  deterministic prerequisites fully determine the permitted outcome, so a
  model answer can never override them (pinned by tests asserting zero
  wire requests).

**Placeholder disposition (Option C, as accepted):** the flagship never
routes to `design-to-code`; the workflow id remains registered
(compatibility/state), its three "production-ready" strings corrected to
"Legacy artifacts-only design scaffold (a structural prototype; writes no
project files)", and the worker description is now "Turns a connected
Figma design into reviewed code changes you approve before anything is
written".

**Figma availability model:** one validated result —
`readFigmaMcpConfig` parse success — now drives registration,
`figmaSourceMode`, run input, and routing. The legacy
`settings.experimental.*` keys are read for compatibility but can no
longer force availability without a valid config (the malformed-config →
MCP-routing defect is closed), and a valid `figmaMcp` block alone
unlocks the supported journey — no hidden stage flags required.
Registration is capability presence; consent + approval gate effects.

**Input honesty:** empty form answers stay absent (the placeholder is a
visual example, not data); routing can no longer be driven by fabricated
values; empty-input requests clarify.

**Public bypass protections:** the synthetic
`run design-to-code-implementation` worker (which skipped the project
guard and consent) is removed; gated/internal workflow ids
(figma-specification, implementation, feedback-loop, agent-foundation)
resolve to "No such worker" on the public run surface; internal
harnesses keep `runner.start`. The old pre-session "project required"
hard gate is gone (spec-only is the no-project journey).

**Result-summary honesty:** derived from artifacts, never workflow ids —
applied ("Project files were updated after your approval."),
specification-only, artifacts-only, and on stopped runs "No changes were
applied to your project." when nothing applied; the `artifacts` command's
unconditional "No project files were changed." line is removed.

**Tests:** agents suite rewritten to the contract (consent semantics,
never-scaffold, no-model-call, clarification vocabulary — 223 pass);
CLI suites migrated (generic fixtures → qa-reviewer; DE-specific tests
assert guidance/consent/summary; new coverage: guidance names a command
and no internal switch; project-without-consent → spec route;
consent-yes → implementation with preview) — CLI 297 pass / 1 skip / 0
fail; API fixtures migrated similarly (65 pass). Smoke journey updated:
DE step now asserts the setup-guidance contract and history reflects
three completed workers.

**Compatibility impact:** unreleased 0.1.1 — the legacy scaffold is no
longer reachable through the worker (by design); stored history/artifacts
referencing `design-to-code` remain valid and inspectable; the
experimental config keys remain readable but are no longer required or
sufficient; `--project` without consent no longer implies implementation.
One documented test exemption: `run.ts` hardcodes the "The Design
Engineer works from a connected Figma design" guidance sentence, so the
no-worker-name-literal invariant exempts that file (worker-name-derived
phrasing would wrongly imply every worker needs Figma).

**Remaining:** MVP-3C (onboarding/config surface incl. naming the
`figmaMcp` keys somewhere discoverable, settings profile visibility,
usage() gaps), MVP-3D (role-named progress, feedback-loop/child artifact
rendering, provenance literal fix), MVP-3E (reachable beta correction
loop), MVP-4 (real-environment evidence; supported-pending-validation
messaging stands until then).

## 18. Confirmation
No production code, tests, manifests, scripts, or existing
documentation were modified. This file is the only change.
Investigation was performed by four parallel read-only audits plus
direct CLI verification (`workers`, `settings`, gating probe) against
the built package.
