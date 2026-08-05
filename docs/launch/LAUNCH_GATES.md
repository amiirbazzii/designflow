# DesignFlow Launch Gates

Measurable go/no-go gates for the public release of `designflow-ai@0.1.1`.
Statuses are updated only with recorded evidence. Evidence classes are kept
distinct and are **not interchangeable**:

- **unit** — package unit tests (mocks/fixtures allowed);
- **integration** — cross-package tests inside this repository;
- **fake-service** — synthetic MCP/model fixtures standing in for a real
  dependency;
- **real-environment** — live OpenRouter, real Figma MCP, real browser, real
  project;
- **installed-distribution** — behavior of the packed npm artifact installed
  in isolation.

A gate that requires real-environment or installed-distribution evidence is
never marked PASS on unit, integration, or fake-service evidence alone.

Status values: `PASS` / `FAIL` / `PENDING` (not yet attempted or evidence
class not yet satisfied). Severity: `BLOCKING` (no-go if not PASS) /
`ADVISORY`.

| Gate | Requirement | Verification procedure | Required evidence | Status (L0 audit, 2026-08-05) | Severity |
|---|---|---|---|---|---|
| G-01 | Clean build | `bunx turbo build --force` at release commit | 26/26 package tasks successful, exit 0 | PASS — 26/26 successful at `48480fa` | BLOCKING |
| G-02 | Clean typecheck | `bunx turbo typecheck --force` | 44/44 tasks successful, exit 0 | PASS — 44/44 successful at `48480fa` | BLOCKING |
| G-03 | Clean lint | `bunx turbo lint --force` | 26/26 tasks successful, 0 errors | PASS — 26/26 successful at `48480fa` | BLOCKING |
| G-04 | Complete test status | `bunx turbo test --force`; report pass/skip/fail exactly | 0 failures; every skip listed and justified | PASS with 1 known skip — 2,248 pass / 1 skip / 0 fail at `48480fa` (skip must be identified and justified before L6) | BLOCKING |
| G-05 | No unresolved launch-critical safety issue | All L1 items fixed or formally waived; re-audit of approval targets, policy enforcement, SIGINT propagation, MCP env inheritance, MCP protocol verification, visual-validation contract cast | L1 diffs + regression tests + waiver log | PENDING — six confirmed L1 items open | BLOCKING |
| G-06 | Verified approval/write/rollback protections | Exercise approval gate, proposal/hash binding, snapshot, atomic apply, validation failure, rollback on a real registered project | integration + real-environment transcripts | PENDING — unit/integration evidence exists (e.g. `packages/capabilities/implementation`, `apps/designflow-cli/src/stage6-feedback-loop.test.ts`); no real-environment run recorded | BLOCKING |
| G-07 | Verified installed-package journey | `npm pack` in `apps/designflow-cli`; install tarball into an isolated project; run `designflow` init→run journey | installed-distribution transcript | PENDING | BLOCKING |
| G-08 | Live OpenRouter evidence | Run a workflow in model mode against live OpenRouter with an operator credential | real-environment transcript (bounded, redacted) | PENDING — `apps/designflow-cli/src/live-openrouter.test.ts` exists but requires `OPENROUTER_API_KEY`; no recorded live run | BLOCKING |
| G-09 | Real Figma evidence | Exercise Figma MCP through supported transports (stdio and Desktop HTTP) against a real Figma design | real-environment transcript | PENDING — fake-service fixtures only (`figma-mcp-experimental.test.ts`) | BLOCKING |
| G-10 | Playwright and visual-validation evidence | Real browser capture, visual comparison, and correction loop on a representative project | real-environment screenshots + comparison artifacts | PENDING — fixture-based tests only | BLOCKING |
| G-11 | Accurate documentation | L4 audit: README, CLI help, ADR index, configuration docs, status labels, claims vs behavior | L4 audit table with zero unresolved mismatches | PENDING | BLOCKING |
| G-12 | Known limitations recorded | Release notes list real limitations (Chromium separate install, experimental gating, provider requirement, JSON-store growth, etc.) | published limitations section | PENDING — partial material in `docs/STAGE_7_PRODUCTION_READINESS.md` and `docs/RELEASE_NOTES.md` | BLOCKING |
| G-13 | Reproducible release procedure | Documented, executed-from-scratch release procedure with cache bypass (`--force`) at a tagged commit | procedure doc + one clean execution transcript | PENDING — `docs/RELEASE_CHECKLIST.md` exists; no end-to-end execution recorded for the RC | BLOCKING |

## Gate-status ground rules

1. Status changes require attached evidence of the required class; a
   fake-service run never satisfies a real-environment requirement.
2. G-01..G-04 must be re-run at the exact release-candidate commit with
   `--force`; results from earlier commits (including this L0 audit) expire.
3. Waivers are recorded inline in this file with owner, date, and rationale;
   only the program owner may waive a BLOCKING gate.
4. Any FAIL on a BLOCKING gate is an automatic no-go until resolved.
