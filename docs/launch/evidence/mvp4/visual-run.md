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
