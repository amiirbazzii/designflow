# L1A — Safety Issue Reproduction and Fix Planning

- **Audit date:** 2026-08-05
- **Git commit:** `48480fa562a045e9cf1d05e7069a8a560575b754` (branch `main`, unchanged from the accepted L0 baseline)
- **Working-tree state before investigation** (`git status --short`):

  ```
   M .claude-flow/daemon-state.json
  ?? docs/DesignFlow-Current-Architecture-and-Product-Baseline.md
  ?? docs/launch/
  ```

  Difference from the L0 record: `.claude-flow/daemon.pid` is no longer
  present (local tooling state, out of scope). No production file has moved.

- **Package:** `designflow-ai@0.1.1` (unchanged).
- **Mode:** investigation only. **No fixes were implemented.** No production
  code, tests, manifests, lockfiles, or existing launch documents were
  modified; the only file created is this one.

## Executive summary

All six reported L1 issues are real. Five are **CONFIRMED**; L1-01 is
**PARTIALLY_CONFIRMED** because the reported "silently matches no nodes" is
true only at the ExecutionService pre-flight layer — the engine's per-node
gate does fire on a workflowId-only target, so approvals are not bypassed for
capability nodes, though child-workflow nodes are not gated and
`deny_capability` surfaces only mid-run. Two issues have notably narrower
root causes than reported: L1-06 is a type-level defect only (the cast never
corrupts runtime data), and L1-02's honest launch-safe fix is *removal* of
`resource_limit` from the public contract, not enforcement. One issue is
worse than reported: L1-04's additive env behavior directly contradicts an
ADR claim that is false as written.

| Issue | Classification | Severity |
|---|---|---|
| L1-01 approval target | PARTIALLY_CONFIRMED | high |
| L1-02 resource limits | CONFIRMED | medium |
| L1-03 SIGINT propagation | CONFIRMED | high |
| L1-04 MCP env inheritance | CONFIRMED | high |
| L1-05 MCP protocol check | CONFIRMED | medium |
| L1-06 visual contracts | CONFIRMED (narrower) | low |

Evidence-class legend used below: **[S]** static code evidence,
**[U]** existing unit-test evidence, **[R]** targeted runtime evidence,
**[I]** inferred impact.

---

## L1-01 — Workflow-ID-only approval target

1. **Classification:** PARTIALLY_CONFIRMED.
2. **Severity:** high (fail-open at one of two layers; accidental semantics; zero coverage).
3/4/5. **Files/symbols/lines:**
   - `packages/sdk/src/execution-policy.ts:15-22` — `policyRuleTargetSchema` (`.refine` accepts any one of the three fields, so workflowId-only is schema-valid). [S]
   - `packages/core/src/policy/in-memory-policy-evaluator.ts:117-129` — `targetMatches`; deciding line 128: `return nodeId !== undefined || target.capabilityId !== undefined;`. [S]
   - `packages/core/src/application/execution/execution-service.ts:638-645` — pre-flight context has no `nodeId` → rule matches nothing. [S]
   - `packages/core/src/engine.ts:1134-1143` — per-node gate passes `metadata: { nodeId }` → rule matches every capability node in the workflow. [S]
6. **Contract:** `policyRuleTargetSchema`, `ExecutionPolicy` (public SDK exports, `packages/sdk/src/index.ts:700-706`).
7. **Execution path:** `ExecutionService.execute` → `evaluatePolicy` (pre-flight) and `ExecutionEngine.nodeApprovalFor` (per-node, called from `runCapabilityNode` at `engine.ts:1018`).
8. **Failure scenario:** an SDK embedder writes `{type:"require_approval", target:{workflowId:"wf-1"}}` expecting a workflow-wide gate. Pre-flight passes silently; per-node approval does fire for capability nodes — but a `deny_capability` rule with the same target is invisible pre-flight and only surfaces mid-run as a thrown `ExecutionError` (`engine.ts:1145`) after the execution record exists; and child-workflow nodes (`engine.ts:905` branch) are evaluated against the child's workflowId, so the parent rule never gates them. [R for evaluator behavior — the investigator executed the evaluator against both context shapes: service-level `{"allowed":true}` vs engine-level `{"allowed":false, violations:[approval_required]}`; S for call-site paths]
9. **Fails open / closed:** fail-open at the ExecutionService layer; matches-everything at the engine layer; behavior determined by caller context shape, not by the rule — misleading by construction.
10. **Existing coverage:** `packages/core/src/policy/in-memory-policy-evaluator.test.ts` — only object-target test is `{workflowId, nodeId}` (line 147); all others are string targets. [U] No test covers workflowId-only, capabilityId-only, or the service/engine context divergence.
11. **Missing regression tests:** workflowId-only and capabilityId-only targets evaluated with and without `metadata.nodeId`; `deny_capability` with workflowId-only target rejected pre-flight; child-workflow gating behavior documented.
12. **Smallest safe fix:** replace line 128 with `return true;` (the three preceding guards already reject non-matching workflow/capability/node), making pre-flight and per-node behavior consistent. Alternative (stricter, less capable): tighten the `.refine` to require `nodeId` or `capabilityId`.
13. **Files likely to change:** `packages/core/src/policy/in-memory-policy-evaluator.ts`, its test file; `packages/sdk/src/execution-policy.ts` only on the schema route; reconcile the comment at `engine.ts:1134-1137`.
14. **Compatibility risks:** low — no in-repo policy uses object targets (all shipped rules use string step-id targets, e.g. `workflows/workflow-design-to-code/src/workflow.ts:109-123`); widening affects only external SDK consumers, in the direction they would expect.
15. **Acceptance criteria:** workflowId-only and capabilityId-only rules produce identical verdicts at both call sites; new tests pin both context shapes; full suite green.

---

## L1-02 — Resource-limit policies parsed but unenforced

1. **Classification:** CONFIRMED.
2. **Severity:** medium (false safety guarantee in a public contract; not end-user reachable via shipped config).
3/4/5. **Files/symbols/lines:**
   - `packages/sdk/src/execution-policy.ts:6-11` — `"resource_limit"` in `policyRuleTypeSchema`; rule schema (L26-31) has no typed limit fields (`metadata` is `z.record(z.string(), z.unknown())`). [S]
   - `packages/sdk/src/execution-policy.ts:52-56` — `policyViolationTypeSchema` has **no** resource-limit violation type: even a custom evaluator could not report a breach without failing `policyEvaluationResultSchema` (L70-73). [S]
   - `packages/core/src/policy/in-memory-policy-evaluator.ts:27,41-43,131-137` — rules filtered and routed to `evaluateResourceRule`, whose entire body is the comment `// Store rule only - no runtime resource tracking yet`. Verified directly. [S]
6. **Contract:** `ExecutionPolicy` / `policyRuleTypeSchema` (public SDK, re-exported `packages/sdk/src/index.ts:698-720`).
7. **Execution path:** the only two policy call sites (`execution-service.ts:224-247,625-646`; `engine.ts:1124-1157`) consume only the violation list; `allowed` is `violations.length === 0` (evaluator L46), so a resource-limit-only policy always returns `allowed: true`. `PolicyContext` (`execution-service.ts:636-643`) carries no resource measurements, so enforcement is impossible even in principle at this contract. [S]
8. **Failure scenario:** an SDK embedder sets `{type:"resource_limit", target:"memory", metadata:{maxMB:512}}`; it validates, is silently ignored, and execution proceeds unbounded (only per-node `execution.timeout` exists, unrelated to policy — `runner.ts:165-220`). [S+I]
9. **Fails open / misleading:** silently fails open; a validating-but-inert public rule type is a false safety guarantee.
10. **Existing coverage:** `in-memory-policy-evaluator.test.ts:157-176` — `"resource_limit rules are stored but not enforced"` is a characterization test *locking in* the non-enforcement. [U] I ran this suite: 12 pass / 0 fail.
11. **Missing regression test:** parse-time rejection (on the removal route) or loud-failure behavior.
12. **Smallest safe fix (recommended):** **remove** `"resource_limit"` from the public contract. Enforcement is not launch-sized (needs a metering subsystem plus context/violation contract extensions); parse-time explicit rejection keeps a public enum member whose only behavior is to fail while breaking the same consumers removal breaks. Fallback if roadmap visibility is wanted: make the evaluator throw "resource_limit rules are not enforced by this evaluator".
13. **Files likely to change:** `packages/sdk/src/execution-policy.ts` (drop enum member L10), `packages/core/src/policy/in-memory-policy-evaluator.ts` (drop L27, L41-43, L131-137), its test (replace L157-176 with a parse-rejection test); `packages/sdk/dist` regenerates on build.
14. **Compatibility risks:** external SDK consumers authoring such rules get a compile/parse error instead of a silent no-op — the correct outcome. Nothing in-repo authors one (shipped composition roots at `cli-runner.ts:660-673`, `designflow-api/src/host.ts:136-147`, `designflow-demo/src/host.ts:164` use only `require_approval` constants).
15. **Acceptance criteria:** `resource_limit` no longer validates; no dangling references (grep clean); full suite green.

---

## L1-03 — Missing SIGINT cancellation propagation

1. **Classification:** CONFIRMED.
2. **Severity:** high (state integrity on the primary interactive interface; write paths involved).
3/4/5. **Files/symbols/lines:**
   - No `SIGINT`/`SIGTERM`/`process.on`/`process.once` registration anywhere in `apps/` or `packages/` (grep, excluding node_modules/dist, returns nothing). Independently corroborated: zero `AbortController` references in `apps/designflow-cli/src` non-test sources. [S]
   - `apps/designflow-cli/src/main.ts:75-104` — `process.exit(await main())`; the `finally` running `context?.close()` is the only cleanup path and SIGINT never reaches it. [S]
   - `packages/core/src/application/execution/execution-service.ts:299` and `engine.ts:575` — an `AbortController` created solely to satisfy `ExecutionContext`; `abort()` is never called; `ExecutionRequest` (`packages/sdk/src/execution-contract.ts:14-19`) has no signal field, so callers structurally cannot cancel. [S]
6. **Contract:** `ExecutionRequest`/`ExecutionContext` (`packages/sdk`), `CliContext` (`cli-runner.ts:305-420` — no cancel surface).
7. **Execution path:** every layer *below* the CLI accepts and honors signals correctly — tools (`packages/tools/src/runtime.ts:200-223,312`), models (`packages/models/src/runtime.ts:179-212`), OpenRouter fetch (`provider.ts:106`), MCP stdio (`stdio-runtime.ts:84,148,254-293`) and HTTP (`http-runtime.ts:317-337,401`), capability runner (`runner.ts:176-223`), implementation validation (`validation.ts:44-45` kills the child on abort). The machinery is complete but never seeded with a real signal. Additional gap: `run.ts:9` never populates `options.validation.signal`, so the child-kill path is dead code in practice. [S]
8. **Failure scenario:** Ctrl+C during an experimental apply: readline (`main.ts:31-44`) re-raises SIGINT and the process dies at default disposition. Left behind: (a) partially applied file writes — `application.ts:46-57` rolls back only in `catch`, which SIGINT bypasses (recoverable: snapshot persists per file, `findResumableSnapshot` at :48 permits resume); (b) execution records stuck in `running` forever — nothing sweeps them (`execute()` marks executing at `execution-service.ts:310` and only finalizes on normal completion); (c) SQLite store never closed. MCP/validation children usually die with the foreground process group (not `detached`), but orphan when a supervisor signals only the CLI pid. The write lock self-heals (`project-write-lock.ts:86-98` reclaims dead-PID/30s-stale locks). Note: no preview server or Playwright capture exists at this commit — that part of the reported issue does not apply. [S; leaves-behind analysis is I grounded in S]
9. **Fails open / closed:** neither cleanly — abrupt termination with incomplete state; misleading in that lower layers advertise cancellation support that is unreachable.
10. **Existing coverage:** abort *mechanism* well tested (`packages/tools/src/runtime.test.ts:265-325`, `adversarial.test.ts:183-345`, `runner.test.ts:185-220`, models/provider/MCP suites) [U]; no test sends SIGINT or asserts an interruption exit code.
11. **Missing regression tests:** SIGINT → root abort → cleanup runs → exit 130; second SIGINT hard-exits; execution record not left `running` after graceful interrupt; validation child killed on abort.
12. **Smallest safe fix:** root `AbortController` in `main.ts` wired to `process.once("SIGINT"/"SIGTERM")`; thread the signal through `CliContextOptions`/`CliContext` into `ExecutionService.execute` as a separate non-schema parameter; link the inert controllers at `execution-service.ts:299`/`engine.ts:575` to the parent; populate `options.validation.signal` in `run.ts`. Exit codes 130 (SIGINT) / 143 (SIGTERM). Adjacent: replace `process.exit(await main())` with `process.exitCode` to avoid truncating piped stdout.
13. **Files likely to change:** `apps/designflow-cli/src/main.ts`, `apps/designflow-cli/src/services/cli-runner.ts`, `packages/core/src/application/execution/execution-service.ts`, `packages/core/src/engine.ts`, `packages/capabilities/implementation/src/run.ts` (+ tests).
14. **Compatibility risks:** `ExecutionService.execute` signature gains an optional parameter (additive); embedders unaffected. Signal handlers must not break non-TTY/CI usage.
15. **Acceptance criteria:** interrupt during a running workflow aborts model/MCP/validation work, runs cleanup, exits 130; no execution left `running`; repeated SIGINT force-exits; full suite green.

---

## L1-04 — stdio MCP inherits the full parent environment

1. **Classification:** CONFIRMED.
2. **Severity:** high (credential exposure to third-party, often `npx`-fetched, server code; contradicts a documented claim).
3/4/5. **Files/symbols/lines:**
   - `packages/mcp/src/stdio-runtime.ts:96-101` — `spawn(..., { env: { ...process.env, ...this.config.env } })`. Verified directly. The doc comment at :44 documents the merge as intentional. [S]
   - Allow-list half is correct: `apps/designflow-cli/src/services/figma-mcp-config.ts:125-129` resolves only named `envPassthrough` vars; passed via `cli-runner.ts:539-542` — then unioned over the full parent env at spawn. [S]
   - Secondary: `packages/capabilities/implementation/src/validation.ts:22` also spawns without `env` (full inheritance), though that child is the project's own validation command, a different trust profile. [S]
6. **Contract/docs:** `McpServerConfig.env`; **docs/adr/20260810-figma-mcp-integration.md:80-84 is false as written** ("only that resolved `env` map … ever reaches `child_process.spawn`"). The test name at `figma-mcp-config.test.ts:110` ("only forwards…") asserts the returned map, not the child env — misleading name, technically true. The gap itself is already recorded accurately in `docs/DesignFlow-Current-Architecture-and-Product-Baseline.md:219` (caveat 12 at :259).
7. **Execution path:** Figma MCP config → `McpRuntime` construction → `spawn` on `connect()`.
8. **Failure scenario:** user configures the documented `npx -y <figma-mcp-server>`; every shell secret — `OPENROUTER_API_KEY`, `GITHUB_TOKEN`, `AWS_*`, `ANTHROPIC_API_KEY`, `NPM_TOKEN`, `SSH_AUTH_SOCK` (a live signing capability) — reaches run-time-fetched third-party code. Exactly the supply-chain exposure the allow-list appears designed to prevent. [I grounded in S; no filtering code exists anywhere upstream]
9. **Fails open / misleading:** fail-open, and misleading — config surface implies restriction while spawn is additive.
10. **Existing coverage:** nothing asserts what is NOT passed to the child. `stdio-runtime.test.ts:28,116` set fixture env only; `figma-mcp-config.test.ts:110-143` covers the resolution map (suite run: 13 pass / 0 fail); `figma-mcp-experimental.test.ts:107-147` is trace redaction, not env isolation. [U]
11. **Missing regression test:** fake-server echo-env fixture; assert an unrelated secret in `process.env` is absent from the child's environment.
12. **Smallest safe fix:** build the child env explicitly in `stdio-runtime.ts`: a platform-aware base allow-list — POSIX: `PATH`, `HOME`, `TMPDIR/TMP/TEMP`, `LANG`/`LC_*`, `SHELL`, `TERM`; Windows adds `USERPROFILE`, `HOMEDRIVE/HOMEPATH`, `SystemRoot` (omitting it breaks Node networking), `SystemDrive`, `COMSPEC`, `PATHEXT`, `windir`, `APPDATA`, `LOCALAPPDATA`, `ProgramFiles`, `ProgramData`, `NUMBER_OF_PROCESSORS` — plus proxy/CA (`HTTP(S)_PROXY`, `NO_PROXY`, `NODE_EXTRA_CA_CERTS`), npm/npx (`npm_config_*`, `NPM_CONFIG_*`), and node-manager vars (`NVM_DIR`, `FNM_DIR`, `ASDF_DIR`, `VOLTA_HOME`, `MISE_*`) so the recommended `npx` path keeps working; union with `this.config.env`; export the constant for testability; optional `inheritParentEnv?: boolean` (default false) escape hatch on `McpServerConfig`.
13. **Files likely to change:** `packages/mcp/src/stdio-runtime.ts` (+ doc comment at :44), `stdio-runtime.test.ts`, `packages/mcp/test/fixtures/fake-server/fake-server-entry.ts`, `docs/adr/20260810-figma-mcp-integration.md:80-84` (correct the false claim), architecture-baseline caveat 12. `figma-mcp-config.ts` needs **no** change.
14. **Compatibility risks:** real — corporate proxies, node version managers, npm config; mitigated by the curated base list and the explicit opt-out. A naive deny-list "works on my machine, breaks behind the proxy".
15. **Acceptance criteria:** echo-env test proves unrelated secrets absent and `envPassthrough` vars present; fake-server suites (5 downstream consumers) still pass on macOS/Linux; ADR corrected; full suite green.

---

## L1-05 — stdio MCP protocol version not verified

1. **Classification:** CONFIRMED.
2. **Severity:** medium (silent operation against unsupported servers; diagnostic quality, not direct data exposure).
3/4/5. **Files/symbols/lines:**
   - HTTP path verifies: `packages/mcp/src/http-runtime.ts:31-32` (`INITIALIZE_PROTOCOL_VERSION = "2025-03-26"`, `SUPPORTED_PROTOCOL_VERSIONS` — private to the file), :254-263 (safeParse + set check + `McpProtocolUnsupportedError`), :284 (re-throw guard), :329-331 (header echo), :546 (`classifyThrown` → `ERR_MCP_PROTOCOL_UNSUPPORTED`). [S]
   - stdio path does not: `packages/mcp/src/stdio-runtime.ts:138-145` — the initialize response is never assigned; `mcpInitializeResultSchema` is not imported (imports at :13-19). Verified directly. [S]
   - Additional gaps in the same call: no `capabilities`/`clientInfo` sent (HTTP sends them at :232-236); `notifications/initialized` never sent; a JSON-RPC *error* response to initialize is not detected (`request()` resolves on any well-formed response; only `callTool` inspects `response.error` at :198) — a server replying with an error leaves the client believing it is connected. [S]
6. **Contract:** `mcpInitializeResultSchema` (`protocol.ts:51-63`, used by HTTP only); `McpProtocolUnsupportedError` (`errors.ts:197-207`, code in `MCP_ERROR_CODES` :27 and `MCP_CALL_FAILURE_CODES` :93; CLI message already exists at `apps/designflow-cli/src/ui/errors.ts:478` — plumbing exists, unused by stdio). No shared version constant; stdio hardcodes `"2024-11-05"` inline (:139), HTTP owns `"2025-03-26"` privately — two transports, two versions, no single source of truth.
7. **Execution path:** `McpRuntime.connect()` → `request("initialize", ...)` → result discarded → `tools/list` proceeds.
8. **Failure scenario:** a server answering `{"result":{"protocolVersion":"2099-01-01"}}`, `{"result":{}}`, `{"result":null}`, or even `{"error":{...}}` yields a successful `connect()`; mismatch surfaces later, if at all, as a misleading `ERR_MCP_CONNECTION_FAILED` ("tools/list response did not match the expected shape", :154). [S]
9. **Fails open:** silently continues with an unsupported or failed handshake.
10. **Existing coverage:** HTTP: `http-runtime.test.ts:249,263` (unsupported version → `ERR_MCP_PROTOCOL_UNSUPPORTED`; missing version → `ERR_MCP_CONNECTION_FAILED`). stdio: only `"connects to a real spawned process and completes the handshake"` (`stdio-runtime.test.ts:37`), which would pass regardless of the returned version. Fake server hardcodes its reply (`fake-server-entry.ts:45`); `fakeMcpFixturesSchema` is `.strict()` with no protocol override. I ran the MCP package suite: 26 pass / 0 fail. [U]
11. **Missing regression tests:** stdio version-mismatch, malformed-result, and error-response-to-initialize cases.
12. **Smallest safe fix:** move version constants into `protocol.ts` as a shared `SUPPORTED_PROTOCOL_VERSIONS` containing **both** `"2024-11-05"` and `"2025-03-26"` (keeps the shared fake-server fixture and its five downstream suites passing unchanged); in stdio: capture the initialize response, reject `response.error`, safeParse with `mcpInitializeResultSchema`, throw `McpProtocolUnsupportedError` on an out-of-set version. Two traps: re-throw before the blanket `McpConnectionError` wrap at :140 (mirror `http-runtime.ts:284`), and teach stdio's `classifyThrown` (:369-373) the new code so `callTool` doesn't flatten it.
13. **Files likely to change:** `packages/mcp/src/protocol.ts`, `stdio-runtime.ts`, `http-runtime.ts` (import shared set), fake-server fixtures (optional version override), `stdio-runtime.test.ts`. No CLI change needed.
14. **Compatibility risks:** low if both versions stay supported; narrowing to `"2025-03-26"` only would ripple through five downstream suites — avoid in this fix.
15. **Acceptance criteria:** `connect()`/`listTools()` reject with `ERR_MCP_PROTOCOL_UNSUPPORTED` on mismatch; `callTool()` returns `{type:"failure", code:"ERR_MCP_PROTOCOL_UNSUPPORTED"}`; malformed/missing version → `ERR_MCP_CONNECTION_FAILED` (HTTP precedent); existing suites green.

---

## L1-06 — Duplicate visual-validation contracts and unsafe cast

1. **Classification:** CONFIRMED — with a narrower root cause than reported: the cast bridges the Stage-5 *agent output* schema to a stale return-type annotation, not the two report schemas; no runtime data flows through it wrongly.
2. **Severity:** low (type-level defect; every consumer re-parses with the correct schema).
3/4/5. **Files/symbols/lines:**
   - Stage-2 contract: `packages/sdk/src/design-engineer-contracts.ts:506-520` — `visualValidationReportSchema` (8 fields: overallScore, threshold, passed, discrepancies (severity low|medium|high), screenshotReferences, validationAttempt, agentVersion, schemaVersion). [S]
   - Stage-5 contract: `packages/sdk/src/visual-validation-contracts.ts:143-165` — `visualValidationReportV1Schema` (22 fields, evidence-bound; severity info|minor|major|critical; overallStatus enum; structured evidence, findings, coverage, passFailPolicy, agent identity, traceIds). Only shared field: `schemaVersion`, and it differs in kind. All semantic overlaps are type-incompatible (disjoint severity vocabularies, boolean vs 5-value status, string[] vs structured evidence). [S]
   - Unsafe casts: `packages/agents/src/catalog/visual-validation-agent.ts:121-124` and :169 — `visualValidationAgentOutputV1Schema.parse({...}) as unknown as VisualValidationReport`. Verified directly. Forced by the narrowed return types at :61-65 (`VisualValidationStrategy`) and :203-207 (`perform`), even though the underlying port deliberately returns `Promise<unknown>` (`packages/sdk/src/agent-invocation.ts:106-112`). The value actually returned is a third shape, `VisualValidationAgentOutputV1` (`visual-validation-contracts.ts:167-171`). [S]
   - Identifier collision: `workflows/workflow-design-to-code/src/visual-validation-types.ts:86` exports `type VisualValidationReport = z.infer<typeof visualValidationReportV1Schema>` (re-exported at `index.ts:108`) — the same name means the Stage-2 shape from `@designflow/sdk` and the Stage-5 shape from the workflow package. [S]
6. **Contract:** both report schemas plus `visualValidationAgentOutputV1Schema`.
7. **Execution path / producers-consumers:**
   - Stage-2 report: produced by the agent's non-Stage-5 branches (:143-150, :190); consumed only by `agent-foundation-capabilities.ts:275,322`. The Stage-2 workflow (`designToCodeAgentFoundationWorkflowPackage`) is **not registered by the shipped CLI** (`cli-runner.ts:95-145` never imports it) — live only in tests and the library surface.
   - Stage-5 (canonical): agent output parsed with the correct schema at `visual-validation-capabilities.ts:454` (which is why the mistyped return never fails at runtime); report assembled/stored at :476; consumed across the feedback-loop modules and `apps/designflow-cli/src/commands/feedback-loop.ts`.
8. **Failure scenario:** a maintainer trusting the `VisualValidationReport` return type accesses `.passed`/`.overallScore` on a Stage-5 result and gets `undefined` — a compile-time lie, currently latent. [I]
9. **Behavior:** misleading (type-level), not fail-open; runtime unaffected.
10. **Existing coverage:** `visual-validation-stage5.test.ts` already parses the result with `visualValidationAgentOutputV1Schema` — asserting the true shape the cast denies; `specialized-agents.test.ts:129-150` pins the Stage-2 path; SDK contract round-trip tests; workflow and CLI suites. I ran the agents visual suites: 5 pass / 0 fail. [U]
11. **Missing regression test:** none strictly required — type-only change; typecheck is the gate. Optional: a type-level assertion test.
12. **Smallest safe fix:** widen `VisualValidationStrategy` and `perform` to `Promise<VisualValidationReport | VisualValidationAgentOutputV1>` and delete both casts. **No schema migration, no adapter, no deletion** — migration would invalidate the feedback loop's `objectHash` staleness comparisons (`feedback-loop-capabilities.ts:842,1246`); an adapter would fabricate fields nothing consumes; deleting Stage-2 is a separate dead-code decision while its package and tests are exported and green.
13. **Files likely to change:** `packages/agents/src/catalog/visual-validation-agent.ts` only.
14. **Compatibility risks:** none at runtime. Stored-artifact caveat to record: both stages write the **same artifact id** (`"visual-validation-report"`) and **same type** (`"validation.visual-report"`) with indistinguishable `schemaVersion` (`"1"` both — `design-engineer-contracts.ts:23`); no runtime overwrite (per-execution artifacts) but cross-execution queries by type get two incompatible shapes with no discriminator.
15. **Acceptance criteria:** both casts gone; typecheck clean; agents and workflow suites green. Follow-ups filed separately: rename the workflow-local alias to `VisualValidationReportV1`; give the two stages distinct artifact types.

---

## Recommended implementation order

1. **L1-04** (MCP env allow-list) — highest security payoff (credential exposure), fully isolated in `packages/mcp` + fixtures + docs; no shared-contract change; do first while it cannot collide with anything.
2. **L1-05** (stdio protocol verification) — same package and same fixture files as L1-04; land immediately after (or as a sibling PR) to reuse the fake-server fixture extension; no dependency on other fixes.
3. **L1-01** (target matching) — one-line semantic fix plus tests in `packages/core`; independent of MCP work; do before L1-02 so policy-evaluator tests are touched in a known-good state.
4. **L1-02** (resource_limit removal) — touches the shared public SDK enum; sequenced after L1-01 because both modify the same evaluator and test file; removal is mechanical once L1-01's tests are in.
5. **L1-06** (widen return type) — one-file type-level change; anywhere is safe; keep separate for reviewability.
6. **L1-03** (SIGINT propagation) — last: largest blast radius (CLI entry, `CliContext`, `ExecutionService.execute` signature, engine, implementation capability) and the hardest regression tests (process-level signal tests); benefits from all other suites being stable first. Its `ExecutionService.execute` signature addition is additive and does not conflict with L1-01/L1-02's evaluator changes.

Each issue remains a separate implementation step; only L1-04/L1-05 share files (fixtures) and may be reviewed as a pair.

## Regression-test plan

| Issue | New tests |
|---|---|
| L1-01 | evaluator: workflowId-only and capabilityId-only targets, with and without `metadata.nodeId`; `deny_capability` workflowId-only rejected pre-flight; child-workflow gating pinned |
| L1-02 | `policyRuleTypeSchema` rejects `"resource_limit"`; evaluator test replaced with parse-rejection |
| L1-03 | SIGINT → abort → cleanup → exit 130; double-SIGINT hard exit; no execution left `running`; validation child killed on abort |
| L1-04 | fake-server echo-env: unrelated secret absent, passthrough var present; base allow-list constant contents pinned |
| L1-05 | stdio: unsupported version → `ERR_MCP_PROTOCOL_UNSUPPORTED`; malformed result → `ERR_MCP_CONNECTION_FAILED`; error-response-to-initialize rejected |
| L1-06 | none required (typecheck gates); optional type-level assertion |

## L1 completion checklist

- [x] L1-04 implemented, echo-env negative test green, ADR 20260810 corrected (L1B-1, 2026-08-05 — see addendum F)
- [x] L1-05 implemented, shared version constants, stdio mismatch tests green (L1B-2, 2026-08-05 — see addendum G)
- [x] L1-01 implemented, both-context tests green, engine comment reconciled (L1B-3, 2026-08-05 — see addendum H)
- [ ] L1-02 `resource_limit` removed from public contract, grep clean
- [ ] L1-06 casts removed, typecheck clean
- [ ] L1-03 implemented, signal tests green, exit codes 130/143
- [ ] Full suite: build 26/26, typecheck 44/44, lint 26/26, tests 0 fail (with `--force`)
- [ ] Gate G-05 re-evaluated in `docs/launch/LAUNCH_GATES.md`

## Unresolved questions

1. **L1-01:** widen matching (`return true`) vs tighten the schema — recommend widening; needs owner sign-off since it changes public-SDK matching semantics. Child-workflow gating (parent workflowId rules never gate child-workflow nodes) may deserve its own issue rather than riding on L1-01.
2. **L1-02:** confirm removal over loud-failure with the product owner (removal deletes a visible roadmap hint).
3. **L1-04:** should `packages/capabilities/implementation/src/validation.ts:22` (project validation child, full env inheritance) be restricted too, or is the project's own command a different trust boundary? Recommend documenting as out of L1-04's scope, separate decision.
4. **L1-05:** the three adjacent handshake gaps (missing `capabilities`/`clientInfo`, missing `notifications/initialized`, undetected error-response) — fold the error-response check into L1-05 (cheap, same lines); defer the other two.
5. **L1-06 follow-ups:** identifier-collision rename and artifact-type disambiguation — post-L1 or L2 hygiene items.

---

# Reconciliation Addendum — 2026-08-05

This addendum corrects the original investigation where it was inaccurate.
The original text above is preserved unchanged. Commit at reconciliation:
`48480fa562a045e9cf1d05e7069a8a560575b754` (unmoved).

## A. Preview/Playwright claim — original statement was INCORRECT

The original L1-03 section stated "no preview server and no
Playwright/browser capture in this tree" and that
`packages/capabilities` holding only `figma-mcp`/`implementation`/
`test-artifact` proved it. That conflated "not under `packages/capabilities`"
and "not registered by default" with "does not exist." Repository evidence at
`HEAD` (verified via `git ls-tree`, `git grep HEAD`, and `git show`):

- `workflows/workflow-design-to-code/src/visual-validation-runtime.ts`
  exists and implements the full preview + browser stack: `PreviewRuntime`
  (child-process `spawn` at :301, abort-kills the child via
  `signal.addEventListener("abort", ...)` at :314-315, `close()` at :346-355
  with kill + close-wait), `loadOptionalPlaywrightRenderer` (:358-379,
  dynamic `createRequire(...).resolve("playwright")`, headless Chromium
  launch), `createPlaywrightRenderer` (:381-444, per-capture isolated
  context, context/page close in cleanup), `captureWithPreview` (:484-507,
  closes renderer and preview runtime on both paths),
  `RendererUnavailableError` (:99).
- `workflows/workflow-design-to-code/src/visual-validation-capabilities.ts`
  defines the Stage-5 nodes `start-preview-server` (:133) and
  `capture-implementation-screenshots` (:156), passing **`context.signal`**
  into `captureWithPreview` (:185-219) and into the agent invocation (:452).
  Renderer-missing degrades to `status: "unavailable"` with a
  `renderer_unavailable` warning (:169-182) rather than failing.
- `apps/designflow-cli/package.json` declares
  `"optionalDependencies": { "playwright": "1.62.1" }`.
- `workflows/workflow-design-to-code/src/implementation-workflow.ts` is the
  **23-node** `design-to-code-implementation` workflow (23 entries in
  `nodes:`; the 24th `id:` is the workflow's own) and includes
  `prepare-visual-validation` → `start-preview-server` →
  `capture-implementation-screenshots` →
  `store-dom-and-computed-style-evidence` → … (:16-19).
- The feedback loop re-runs the same capabilities directly
  (`feedback-loop-revalidation.ts:101-102`), and the CLI references the
  stage (`apps/designflow-cli/src/commands/feedback-loop.ts:298`,
  `packages/sdk/src/stage6-failpoint.ts:55`). `doctor` probes
  Playwright/Chromium (`services/doctor.ts:72-82`).

Reachability: **experimental but production-reachable.** The implementation
workflow registers when `implementationEnabled` is set
(`registerExperimentalDesignToCodeWorkflows`, `cli-runner.ts:155,618`); it is
not dead code and not test-only. Classification of the original claim:
**INCORRECT** (the accepted baseline claims are all confirmed, including the
23-node count).

## B. Corrected L1-03 cancellation scope

The L1-03 **verdict (CONFIRMED, high) and root cause are unchanged**: there
is still no signal source — no SIGINT/SIGTERM handler, an inert
`AbortController` at `execution-service.ts:299` / `engine.ts:575`, no signal
field on `ExecutionRequest`. What changes is the scope map:

| Subsystem | Signal status |
|---|---|
| Root CLI execution (`main.ts`) | **No root signal** — nothing to abort with; `finally` cleanup unreachable on SIGINT |
| Execution state persistence | No abort path → interrupted executions stuck in `running`; store never closed |
| Model requests (models runtime, OpenRouter fetch) | Already supports AbortSignal correctly |
| MCP stdio child | Already supports AbortSignal (timeout-link); child killed on process-group SIGINT only by OS default |
| MCP HTTP requests | Already supports AbortSignal (`activeControllers`) |
| Project validation child (`validation.ts:44`) | Supports a signal but **never receives one** (`run.ts:9` doesn't populate `options.validation.signal`) — kill path dead in practice |
| **Preview server child** (`visual-validation-runtime.ts:293-355`) | **Already supports AbortSignal correctly** — abort kills the child; `close()` waits for exit. Experimental-but-reachable; receives `context.signal`, which is never aborted (inert root controller) |
| **Playwright browser/context/page** (`:381-444,484-507`) | **Supports the signal and cleans up** — pre-capture abort check, per-capture context close, renderer+runtime close on completion and on the failure path of `captureWithPreview` |
| File application + snapshot recovery | No signal; rollback only in `catch`; snapshot-resumable (unchanged) |
| Project write locks | Self-healing (dead-PID/30s reclaim) (unchanged) |
| Store shutdown | Skipped on SIGINT (unchanged) |
| First SIGINT | Default Node termination after readline re-raise; no cleanup (unchanged) |
| Repeated SIGINT | No distinct handling; same default death (unchanged) |

Five-way separation requested by review:
- **Already signal-correct:** models, OpenRouter, MCP stdio, MCP HTTP,
  capability runner, preview runtime, Playwright renderer, agent invocation.
- **Receives a signal but cleanup imperfect:** none found — the preview and
  capture paths clean up on abort; the earlier concern was unfounded.
- **No root signal:** CLI entry, `CliContext`, `ExecutionService.execute`,
  engine controllers — the actual defect.
- **Unreachable under current registration:** Stage-2 agent-foundation
  workflow only.
- **Experimental but production-reachable when enabled:** the 23-node
  implementation workflow and feedback loop, including preview + Playwright
  nodes — these now sit **inside** L1-03's blast radius: an interrupted run
  can orphan a preview child and a headless Chromium only in the
  supervisor-signal case (they die with the foreground process group on an
  interactive Ctrl+C); the in-tree abort path would stop both if the root
  signal existed.

Consequence for the L1-03 fix plan: unchanged file list, but the acceptance
criteria must add: aborting during Stage-5 stops the preview child and
closes the browser (the existing runtime tests cover the mechanism; a root
signal test must cover the wiring). The original addendum item about
`options.validation.signal` stands.

## C. Parent/child workflow policy finding

1. **Child workflows exist.** `kind: "workflow"` nodes are first-class:
   compiled in `packages/core/src/compiler.ts:48` / `dag.ts:43`, executed by
   `runWorkflowNode` (`engine.ts:1468-1534`) via
   `WorkflowCompositionExecutor` (`packages/core/src/composition/workflow-composition-executor.ts:66-148`)
   and `ExecutionServiceWorkflowResolver.executeWorkflow` →
   `executionContract.executeChild` (`execution-service-resolver.ts:28-46`).
2. **ID representation:** child runs as a full execution with
   `workflowId = childWorkflowId`; lineage (parentExecutionId,
   parentWorkflowId, parentNodeId, compositionPath) travels in metadata
   (`workflow-composition-executor.ts:104-120`).
3. **Policy evaluated for child nodes:** the child execution flows through
   the same `ExecutionService`/engine pipeline and therefore the **same
   combined policy object**, evaluated under the *child's* workflowId.
   Children are not policy-free.
4. **Bypass potential:** a parent rule with a **string capability/step-id
   target still applies inside the child** (string targets match
   capabilityId regardless of workflow — evaluator :122). Only an
   **object target scoped to the parent's workflowId** fails to cascade.
   All shipped rules are string step-id targets except the feedback-loop
   rule (`feedback-loop-manifest.ts:8`), which is scoped to its own
   workflow and node — so no shipped protection can be bypassed by
   child-workflow placement.
5. **Filesystem/shell in children:** structurally possible (any workflow can
   reference any registered capability), but no shipped workflow definition
   contains a `kind: "workflow"` node at all (grep across `workflows/*/src`
   returns none).
6. **Stage-4/Stage-6 reliance:** none — the feedback loop re-invokes
   revalidation capabilities directly (`feedback-loop-revalidation.ts`),
   not via child workflows.
7. **Classification: PARTIALLY_CONFIRMED — severity low — does not block
   launch.** The narrow true claim: parent-workflowId-scoped *object*
   targets do not cascade to child workflows. Given (a) no shipped child
   workflows, (b) string targets do cascade, (c) child executions face the
   same policy under their own id, this is a semantics/documentation gap in
   the same `targetMatches` area as L1-01, not an exploitable bypass in the
   shipped product.

**Recommendation: fold into L1-01 acceptance criteria** (add a test pinning
that string targets gate child-workflow capabilities and a documented
statement that workflowId-scoped object targets are per-execution, i.e.
non-cascading — or extend matching to consult lineage metadata if the owner
wants cascade semantics). Do **not** create L1-07; do not add to the
roadmap as a separate stage item.

## D. Implementation order — unchanged

The order (L1-04 → L1-05 → L1-01 → L1-02 → L1-06 → L1-03) stands. L1-03
remains last and gains the Stage-5 preview/browser acceptance criterion; the
evidence strengthens that placement (its regression tests now span
process-signal behavior *and* experimental-path resource cleanup).

## E. Reconciliation test evidence

| Command | Result |
|---|---|
| `bun test visual-validation-runtime visual-validation-capabilities` in `workflows/workflow-design-to-code` | 13 pass / 0 fail (preview lifecycle + capture capabilities, incl. renderer-unavailable degradation) |
| `bun test composition` in `packages/core` | 28 pass / 0 fail (workflow composition, child execution, approval-pending child path) |
| `bun test src/composition-registration.test.ts` in `apps/designflow-cli` | 4 pass / 0 fail (experimental workflow registration) |

No production code or tests were modified during reconciliation; the only
file changed is this document. No issue is marked fixed.

## F. Implementation-status addendum — L1B-1 (2026-08-05)

**L1-04 implemented** (only L1-04; L1-01/02/03/05/06 remain open, and the
"no fixes implemented" statements above describe the L1A investigation
phase, which they still accurately record).

- New pure helper `packages/mcp/src/child-env.ts` (`buildMcpChildEnv`,
  exported baseline constants, explicit `platform`/`parentEnv` parameters
  for deterministic cross-platform tests, null-prototype accumulation
  against `__proto__`/`constructor`/`prototype` keys).
- `packages/mcp/src/stdio-runtime.ts:99` now spawns with
  `buildMcpChildEnv(...)` instead of `{ ...process.env, ...config.env }`;
  the `McpServerConfig.env` doc comment corrected.
- Fake server gained an `echoEnvTools` fixture; new spawn-boundary test
  proves fabricated parent secrets (`OPENROUTER_API_KEY`, AWS, CI, custom)
  are absent from the real child's `process.env` while an authorized
  variable arrives with its exact value.
- `docs/adr/20260810-figma-mcp-integration.md` §4 corrected (the previously
  false spawn claim).
- Two CLI test files (`figma-mcp-experimental.test.ts`,
  `stage4-routing.test.ts`) previously relied on implicit full-env
  inheritance to deliver `FAKE_MCP_FIXTURES` to the fake server; they now
  authorize it explicitly via `envPassthrough` — using the public contract
  rather than the removed leak. No assertion was weakened or removed.
- Validation: MCP package 39 pass / 0 fail; full suite re-run with
  `--force`: build 26/26, typecheck 44/44, lint 26/26, tests 2,261 pass /
  1 skip / 0 fail (13 new tests; the 1 skip remains the credential-gated
  live OpenRouter test).

## G. Implementation-status addendum — L1B-2 (2026-08-05)

**L1-05 implemented** (only L1-05 in this step; L1-01/02/03/06 remain open).

- Shared canonical source in `packages/mcp/src/protocol.ts`:
  `MCP_STDIO_PROTOCOL_VERSION` ("2024-11-05"),
  `MCP_HTTP_PROTOCOL_VERSION` ("2025-03-26"), and per-transport supported
  sets `STDIO_SUPPORTED_MCP_PROTOCOL_VERSIONS` /
  `HTTP_SUPPORTED_MCP_PROTOCOL_VERSIONS` — each transport accepts exactly
  the revision it requests; neither is widened by inference.
  Transport-local literals removed from both runtimes. (Reconciled
  2026-08-05: an earlier draft of this step shared one combined set, which
  would have widened HTTP acceptance to 2024-11-05 without evidence; that
  widening was reverted — Outcome B of the L1B-2 scope review.)
- `stdio-runtime.ts` now retains and validates the initialize response:
  JSON-RPC error → `McpConnectionError` carrying only the safe JSON-RPC
  code; malformed result → `McpConnectionError` matching the HTTP message;
  unsupported version → `McpProtocolUnsupportedError`; every failure calls
  `close()` first, so the child dies, pending entries are rejected, and no
  further MCP request is sent. `callTool` surfaces the protocol failure as
  `ERR_MCP_PROTOCOL_UNSUPPORTED`, matching HTTP.
- Fixed a latent race the new cleanup test exposed: a killed child's late
  `exit` event could tear down a newer connection's state; `onExit` is now
  child-identity-guarded.
- Fake server: initialize reply gained the spec-required `capabilities`;
  new `initializeError` / `initializeResult` fixture overrides.
- Nine new stdio tests (valid handshake, unsupported version via connect
  and callTool, missing/non-string/malformed result, JSON-RPC init error,
  cleanup + fail-fast reuse, shared-constant pinning).
- ADR 20260810 §3b added. Validation: MCP package 48 pass / 0 fail; full
  suite with `--force`: build 26/26, typecheck 44/44, lint 26/26, tests
  2,270 pass / 1 skip / 0 fail.
- HTTP acceptance behavior is unchanged from before L1B-2: only
  "2025-03-26" is accepted, now proven by an explicit test that HTTP
  rejects the stdio revision. The stdio adjacent handshake gaps deferred
  in the L1A plan (client `capabilities`/`clientInfo`,
  `notifications/initialized`) remain deferred.

## H. Implementation-status addendum — L1B-3 (2026-08-05)

**L1-01 implemented** (only L1-01, including its folded parent/child
sub-finding; L1-02/03/06 remain open).

**Final target contract** (`packages/sdk/src/execution-policy.ts`,
`policyRuleTargetSchema`):
- String targets: unchanged — match the node/capability identifier exactly
  as shipped workflows use them.
- Object targets: must name `nodeId` or `capabilityId`; `workflowId` is a
  scope qualifier only. A workflowId-only or empty object target is
  structurally invalid and rejected at parsing with a message stating the
  requirement.
- Matching (`InMemoryPolicyEvaluator.targetMatches`): AND semantics over
  supplied fields, decided by the target alone; omitted fields impose no
  condition. A node-scoped selector does not match a context without a
  node — pre-flight cannot misread it, per-node enforces it. Caller
  metadata can no longer change a rule's meaning; the pre-flight/per-node
  divergence is gone.
- Defense in depth: a structurally invalid object target reaching the
  evaluator through an unchecked internal path throws
  `PolicyViolationError` instead of silently failing open (the schema
  parse at `evaluate()` already rejects it first on every public path).

**Why workflowId-only is invalid:** under the old line-128 heuristic its
meaning flipped between "matches nothing" (service pre-flight, no nodeId
metadata) and "matches every node" (engine per-node) — an approval/denial
whose scope depends on incidental caller context is not a usable safety
control.

**Parent/child scoping:** string node/capability targets continue to gate
matching capabilities inside child workflows (child executions evaluate
the same combined policy under their own workflow id). An object target
scoped with a parent `workflowId` does not cascade to a child with a
different id; a child-intended rule must name the child's workflow id. No
automatic parent→child cascade was introduced. All three behaviors are
pinned by composition tests.

**Engine pre-filter** (`engine.ts` `nodeApprovalFor`): the
`workflowId === context.workflowId` admission clause was removed (object
targets always carry a node/capability selector now) and the stale
"legacy" comment reconciled with the code.

**Compatibility:** every shipped object target already uses
`{workflowId, nodeId}` (`implementation-manifest.ts`,
`feedback-loop-manifest.ts`) — valid and unchanged in behavior. All other
shipped rules are string targets — unchanged. No policy rules are
persisted to local state (composition roots hard-code them), so no
migration is needed at 0.1.1; a hypothetical invalid configured policy now
fails at the evaluation parsing boundary with the explanatory message,
before any capability runs.

**Tests:** new `packages/sdk/src/execution-policy.test.ts` (10 schema
cases); 7 new evaluator cases (AND semantics, mismatch cases,
context-independence of capabilityId-only targets, both-context rejection
of workflowId-only rules — the direct L1-01 divergence regression — and
the smuggled-invalid-target loud failure); a new execution-service case
(invalid rule rejected before any capability executes, side-effect counter
at 0); 3 new composition cases (string target gates child capability;
parent-scoped object target does not cascade; child-scoped target gates
the child). Resume/approval suites unchanged and green.

**Validation:** core 445 pass / 0 fail; SDK 302 pass; workflow-design-to-code
92 pass; CLI 260 pass / 1 skip. Full suite with `--force`: build 26/26,
typecheck 44/44, lint 26/26, tests 2,293 pass / 1 skip / 0 fail.

## Confirmation

**No fixes were implemented.** No production code, tests, package manifests,
lockfiles, existing launch documents, or `.claude-flow/` files were modified.
The only file created in this task is `docs/launch/L1_SAFETY_REPRODUCTION.md`.

### Targeted test commands run (read-only verification)

| Command | Result |
|---|---|
| `bun test policy` in `packages/core` | 12 pass / 0 fail (includes the resource_limit characterization test) |
| `bun test` in `packages/mcp` | 26 pass / 0 fail (stdio + http runtimes) |
| `bun test src/services/figma-mcp-config.test.ts` in `apps/designflow-cli` | 13 pass / 0 fail |
| `bun test visual` in `packages/agents` | 5 pass / 0 fail |

Evidence labeled [R] (runtime) for L1-01 comes from the investigator
executing the evaluator directly against both context shapes; all other
issue evidence is static code inspection [S] corroborated by the existing
unit suites above [U].
