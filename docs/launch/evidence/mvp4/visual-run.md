# MVP-4 Journey 4 — Visual Acceptance

Run id: `fb0366d5-b6d1-49ba-9104-9b2b48897608` (same run as
`implementation-run.md`)

## Preview and capture

Preview target: `npm run preview -- --host 127.0.0.1 --port 51324`,
readiness `http://127.0.0.1:51324/`, shutdown policy `always`; the
runtime record notes the lifecycle runs inside the capture step. Real
Playwright/Chromium captures were taken for three viewports (desktop
1440×1024, tablet 768×1024, mobile 390×844); screenshot bytes are stored
as artifacts only (never printed). The captured pages are genuinely the
served fixture (verified manually from the stored PNGs).

## Reference evidence

Real Figma reference for node `1026:6098` (`iPhone 16 Pro Max - 14`),
`authenticity: real-figma`, source `figma-desktop` over MCP HTTP,
content hash `542ff58e…`, 413×1024.

## Deterministic comparison (not an agent)

Algorithm `png-rgba-pixel-diff-v1` (threshold 8, mismatch ratio 0.005),
mode `real-reference`. Results: mobile → **fail** with confirmed finding
`dimension-mismatch-mobile` (expected 413×1024, actual 390×844, origin
`deterministic`); desktop and tablet → `inconclusive` (no reference
image exists for those viewports — truthfully reported, not fabricated).

## Visual Validation Specialist

Live OpenRouter `openai/gpt-4o-mini`, profile
`visual-validation-default`, success (837 tokens). Consumed the
deterministic evidence and confirmed the finding without inventing
screenshot information. Typed Visual Validation Report stored
(`visual-validation-report`): overall status **fail**, 0 critical /
1 major / 0 minor, comparison mode real-reference, agent
`visual-validation-agent@0.1.0`.

## Manual visual assessment

Comparing the stored implementation capture against the Spendly frame:
the served page still renders the fixture's original "Northstar
Workspace" app. The three new components and token stylesheet were
created on disk but never imported into `src/App.jsx`, so the Spendly UI
(Add Transaction header, Expense/Income tabs, Add New Expense form,
expense history, bottom navigation) is not displayed at all.

Classification of discrepancy: **actionable** (correction-scale). This
is an implementation-quality gap, not an evidence-integrity failure —
DesignFlow itself reported visual status `fail` (no false clean pass),
the captures are real, and the deterministic stage truthfully reported
what it could and could not compare. Root cause of the gap: the
Implementation Specialist proposed only `create` operations and did not
propose the `modify src/App.jsx` needed to mount the new components — a
conservative outcome consistent with the MVP-4D instruction to modify
only inventoried paths (App.jsx *was* inventoried, so a follow-up
quality improvement is possible), recorded as Journey 6 correction
material.

Deterministic-comparison depth note (non-blocking): with mismatched
dimensions the pixel diff is skipped, so the only finding is the size
mismatch — the content-level divergence is currently caught by the human
(or a future correction loop), not the metric. Recorded as measurement
debt.

## Correction eligibility

`CORRECTION_ELIGIBLE` — a rollback snapshot exists, findings are
actionable, and no correction run was started, offered artifacts
declined. Journey 6 material.

## Verdict contribution

Journey 4 requires an honest validated implementation and truthful
visual evidence — both hold. All 22 PASS criteria are satisfied,
including "no false clean pass". Journey 4: `PASS`.

## MVP-4H — reference-aligned comparison — 2026-08-08

### Pipeline root cause (traced, exact)

- Implementation mobile is captured at the hard-coded preset 390×844
  (`visual-validation-runtime.ts` DEFAULT viewports) in CSS pixels at
  deviceScaleFactor 1 — PNG pixels equal CSS pixels.
- The Figma reference PNG for frame `1026:6098` (source 440×1092)
  arrives from Desktop MCP `get_screenshot` at 413×1024 — a uniformly
  scaled export. The mismatch is instrumentation-induced (preset vs
  scaled export), not application-induced.
- `comparePngImages` (`png-rgba-pixel-diff-v1`) has always diffed the
  top-left-aligned min-width×min-height region — the pixel diff was
  never actually skipped. The loss happened in finding construction
  (`visual-validation-capabilities.ts`): `if (!dimensionCompatible)`
  emitted only the size finding and the content branch was `else if` —
  mutually exclusive — and no deterministic finding carried
  `affectedFrame`, so `selectActionableFindings` (which requires
  severity + frame/component identity + mapped files) had nothing to
  select.

### Fix (narrow, per task)

1. **Reference-aligned capture** (`prepare-visual-validation`): when the
   Figma snapshot's screenshot decodes, a `reference-aligned` viewport
   with its exact pixel dimensions is appended (deduped, bounded to the
   4096 schema max; DPR-1 contract documented). The reference then
   associates exactly with that viewport, so the primary comparison is
   same-size; preset viewports remain as evidence.
2. **Overlap fallback** (`comparePngImages`): the existing overlap diff
   is now surfaced — `overlapWidth/Height`, `overlapCoverage`
   (overlap area ÷ larger image area), `overlapChangedPixelCount`,
   `overlapMismatchRatio` (changed ÷ overlap area), `pixelDiffExecuted`.
   No resampling/scaling was added.
3. **Findings**: dimension mismatch remains its own truthful size
   finding (still non-actionable by itself). When
   `overlapCoverage >= MIN_OVERLAP_COVERAGE = 0.5` (documented general
   comparable-area floor, not tuned to Spendly) and
   `overlapMismatchRatio` exceeds the existing 0.005 threshold, a
   separate `content-divergence-<viewport>` layout finding is emitted
   with expected/actual values and `affectedFrame` set to the reference
   frame's node id (root-frame attribution; `affectedComponent` is never
   fabricated). Below the coverage floor, an explicit
   `insufficient-comparable-area` warning is recorded instead of a
   fabricated finding. The same-size content branch also gained
   root-frame attribution and explicit expected/actual values.
4. **Schemas** (backward-compatible optional fields only): viewport
   metrics gained `overlapCoverage`, `overlapMismatchRatio`,
   `pixelDiffExecuted` in both the workflow metrics schema and the SDK
   report schema; historical artifacts still parse.

### Tests

5 new comparator tests (identical same-size; mismatch with identical
overlap → no divergence and truthful whole-canvas delta; mismatch with
different content → overlap ratio 1; tiny-overlap coverage measurement;
byte-for-byte determinism) and 2 new eligibility tests (a deterministic
root-frame content finding is selected while the bare dimension finding
is excluded; an instrumentation-only mismatch launches no correction).
Full forced regression: build 26/26, typecheck 44/44, lint 26/26, tests
52/52 tasks — **2,452 pass / 1 skip / 0 fail**; smoke PASS; freshness
PASS. Committed as `6ce904fdef168b70db97dc59b2b6875375585312`
("feat: compare overlapping visual content when reference dimensions
differ"); fresh pack `3e29b39661586cb1d53bff789ffa287580dd2050`
installed.

### Live rerun — blocked externally by DeepSeek upstream latency

Credit gate passed; the DeepSeek profile and all other profiles verified
unchanged; fixture healthy (fingerprint `8bc42afd…`); Spendly frame
re-verified selected. Four canonical run attempts:

1. `d99a1978-…`: attempt 1 completed as a live call (111s, 4,979 output
   tokens, valid model output) but the proposal failed validation
   (create-collision); the bounded regeneration attempt then hit the
   120s model timeout.
2. A 300000ms timeout override was rejected by the product's own
   schema (`MAX_TIMEOUT_MS = 120_000`) before any run started —
   correct config validation, recorded as positive evidence; the value
   was restored to 120000.
3. `313ac8b3-…` and 4. `68b6807d-…`: attempt 1 itself hit the 120s
   ceiling.

The same model completed in 26s in earlier runs — this is upstream
serving-latency variance on OpenRouter's DeepSeek providers exceeding
the product's hard 120s model-timeout ceiling, not a model-capability or
product regression. Per the no-mining rule no other model was tried. All
four attempts terminated pre-approval with zero writes; fixture
byte-identical; no orphans; no leaks.

**MVP-4H: `PASS` (product criteria 1–15, 17); the live rerun is
`BLOCKED_EXTERNAL — DEEPSEEK_UPSTREAM_LATENCY`. Journey 6 remains
`FAIL` (incomplete).** Resume when DeepSeek serving latency recovers
(a single rerun suffices — the comparator fix is fully tested and needs
only the live pass), or select a different low-cost implementation
model in a future task.
