# Stage 6 controlled visual correction

Stage 6 is installed as the internal workflow
`design-to-code-feedback-loop` when experimental implementation mode is
enabled. It is not a new public Stage 1 worker. The workflow accepts the
latest Stage 5 report and immutable artifact identities, then pauses for an
approval before `create-correction-snapshot`.

The normal post-apply path invokes the existing Stage 5 runtime directly. It
stores fresh browser, DOM/style, reference, comparison, and Visual Validation
Report artifacts before evaluating the iteration. An injected fresh report is
retained only as a deterministic test seam. A durable parent feedback-loop
record owns continuation: each child execution is one independently approved
iteration, and the next child is prepared only after deterministic improvement
and a new approval.

The preview must show the selected findings, exact relative paths, bounded
diffs, expected measured outcomes, validation commands, viewport/reference
configuration, and the one-snapshot rollback behavior. The approval answer is
for the exact proposal; changing the project, report, hashes, findings, files,
iteration, or expiry causes a stale-state rejection.

The default policy is:

- at most 3 iterations;
- at most 5 files and 200,000 changed bytes per iteration;
- no dependency changes;
- at most 5 selected findings;
- approval is required for every write iteration.

After a successful apply, project validation runs before visual revalidation.
Required validation failure restores the snapshot and stops. Stage 5 must then
capture fresh browser screenshots using the same references, viewports, renderer,
and comparison algorithm. A missing, reused, unavailable, or inconclusive
report never becomes a pass.

Troubleshooting:

- `no_actionable_findings`: check severity, evidence ids, expected/actual
  measurements, and the explicit affected-file map.
- `stale_state`: inspect the project fingerprint and base file hashes; generate
  a new proposal rather than retrying the old approval.
- `visual_validation_inconclusive`: connect a fresh Stage 5 report artifact;
  the previous report is intentionally not reusable after mutation.
- `project_validation_failed`: inspect the bounded validation artifact; the
  snapshot rollback is the authoritative project state.
- `renderer_unavailable`: install Playwright/Chromium in the runtime that
  executes Stage 5. Chromium is never bundled in the DesignFlow package.

Inspect all proposal, approval, snapshot, application, validation, rollback,
revalidation, iteration, and final report artifacts before treating a run as
complete.
