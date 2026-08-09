# MVP-5A — Release Candidate Baseline + Launch Freeze

Audit date: 2026-08-09
Audit scope: packed npm artifact, isolated installation, first-run UX,
configuration discoverability, public CLI inventory, and release
documentation. No MVP-4 journey was rerun.

## Baseline

- Branch: main
- Audit HEAD: b97ed043f42f52d121fba48faebbdfa967102741
- Product source baseline: 8ed4c7362c4ffeacea2a8846f2fee38285bbe35b
- Package: designflow-ai
- Binary: designflow
- Version: 0.1.1
- Package entry contract: CLI-only; bin designflow → dist/main.js; no importable
  library surface
- Product source: clean before documentation-only RC updates

MVP-4 final evidence is preserved by reference in
MVP4_REAL_ENVIRONMENT_ACCEPTANCE.md and commit
b97ed043f42f52d121fba48faebbdfa967102741.

## Architecture freeze

The following are frozen for the MVP release: Execution Engine, capability
interfaces, workflow semantics, approval model, cancellation and rollback
semantics, artifact/state contracts, Coordinator and specialized-agent
architecture, implementation proposal pipeline, visual validation and
correction pipelines, bounded correction iteration, model profiles, and MCP
transport/protocol architecture.

No new architecture work enters MVP-5 unless a release-blocking defect is
found.

## Release-blocker policy

A release blocker is an installation failure, CLI startup failure, inability to
run a supported flagship command, unsafe filesystem mutation, approval bypass,
rollback or cancellation integrity failure, credential/security leak, corrupt
persisted state, missing required package runtime file, or documented
supported configuration that cannot be used.

Safe Coordinator declines, imperfect model output, visual-fidelity
shortcomings, cosmetic wording, historical acceptance residue, incomplete
debugging detail, and fixture-only failures are not automatically blockers.

## Package audit

The package metadata is complete and truthful:

- name designflow-ai; version 0.1.1; MIT license;
- repository URL and apps/designflow-cli directory;
- Node engine >=18;
- bin designflow: dist/main.js;
- files: dist only;
- exports: package.json only;
- main and types explicitly null;
- dependencies and devDependencies null because the one-file CLI bundle
  inlines the internal runtime.

The packed tarball contains exactly four files:

- package/LICENSE
- package/README.md
- package/package.json
- package/dist/main.js

Tarball size: 266,302 bytes.
Tarball SHA-256:
72753b1f5ad64812154e6c3037db66c40382a2539efb09d226a23833561eddaa

No tests, source files, local databases, logs, credentials, acceptance
fixtures, .claude-flow, .swarm, or development caches were packed. The
compiled entry starts with the Node shebang, contains no internal
@designflow imports or workspace dependency specifiers, and resolves from the
installed artifact alone.

## Secret scan

The extracted tarball had zero forbidden credential filenames, zero provider
key values, zero bearer-token values, zero authorization-header values, and
zero .env files. Matches for the literal OPENROUTER_API_KEY name were only
documentation/runtime configuration references, not secret values.

## Isolated installation

The tarball installed successfully into a clean global prefix with plain npm:

  /tmp/designflow-mvp5a-global.1TOcYR

The installed binary resolved from that prefix and passed:

- designflow --version → DesignFlow 0.1.1
- designflow --help → exit 0
- designflow doctor → exit 0
- designflow settings → exit 0

The first local-prefix npm simulation produced an npm ls warning because npm
records a temporary file: dependency in that harness mode. The documented
global-prefix installation passed cleanly with designflow-ai@0.1.1 and no
runtime dependencies.

## No-credential onboarding

With OPENROUTER_API_KEY absent and a fresh DESIGNFLOW_HOME:

- first-run welcome completed;
- doctor reported deterministic fallback, missing model credential, missing
  Figma MCP, and actionable next steps;
- settings displayed profiles without reading or persisting credentials;
- run design-engineer stopped before work with explicit Figma setup guidance and
  “Nothing was run and no files were changed”;
- no stack trace, secret request, workflow, approval, or project write occurred.

## Project registration

Using the disposable MVP-4 frontend project, the installed CLI successfully
registered, listed, inspected, and showed project
50dcbbff-3bc4-4271-b9bf-807a3973860b. Eleven project facts were recorded in the
isolated MVP-5A home only. The frontend Git status remained clean.

## Design Engineer discoverability

The canonical surface is visible in top-level help, workers/list output, worker
detail, and README:

  designflow run design-engineer

The help text explains connected Figma, per-run consent, exact proposal
approval, visual-correction beta authorization, and project requirements.
Internal workflow IDs are not presented as the primary user experience.

## Public CLI inventory

SUPPORTED:

- doctor
- settings
- projects add/list/show/inspect
- workers and list
- run worker
- history
- artifacts
- traces
- sessions, answer, cancel, cleanup

BETA:

- visual correction via --visual-correction=once
- feedback-loop show/resume/stop continuation commands

COMPATIBILITY:

- legacy scaffold/design-to-code workflow and historical agent aliases

INTERNAL / NOT PRIMARY PUBLIC UX:

- workflow IDs and direct workflow-engine entry points
- raw correction JSON and internal artifact contracts

The legacy generic design-to-code path does not overshadow the Design Engineer
worker in help or worker discovery.

## Configuration surface

| Item | Required | Default/discovery |
| --- | --- | --- |
| OPENROUTER_API_KEY | Optional for deterministic mode; required for live model mode | Process environment; doctor/settings explain it |
| DESIGNFLOW_HOME | Optional | ~/.designflow; shown by settings/help |
| settings.figmaMcp | Required for Design Engineer | config.json; README and doctor provide stdio/HTTP examples |
| Registered project | Required for implementation proposal; not specification | projects add; doctor and run guidance explain it |
| Implementation consent | Required per project run | Interactive run prompt |
| Exact proposal approval | Required before project writes | Interactive approval prompt |
| visual-correction=once | Optional beta authorization | CLI help and README; off by default |
| Model profile overrides | Optional | settings.models.profiles in config.json |
| maxOutputTokens/timeoutMs | Optional profile overrides | settings and profile configuration docs |

## Environment variables

Documented public:

- DESIGNFLOW_HOME
- DESIGNFLOW_DEBUG=1
- OPENROUTER_API_KEY

Configuration-forwarded external names:

- Names listed by the user in figmaMcp.envPassthrough, such as
  FIGMA_ACCESS_TOKEN. DesignFlow forwards authorized names only.

Internal/test-only:

- DESIGNFLOW_LIVE_MODEL_TEST
- FAKE_MCP_FIXTURES
- DESIGNFLOW_STAGE6_FAILPOINT
- test-only secret and unrelated-secret fixtures

NODE_ENV is runtime/test infrastructure, not a user-facing DesignFlow
configuration requirement.

## User-facing error audit

The audited first-run and flagship error classes are actionable and fail
closed: missing OpenRouter credential, invalid provider auth, missing or
incorrect Figma MCP, wrong selection/node, missing project, missing consent,
Coordinator output exhaustion, proposal exhaustion, approval rejection,
cancellation, validation failure, and rollback failure. Default output is
bounded and sanitized; raw credentials, headers, and provider bodies are not
printed. Validation failure reports restoration when rollback occurred.

One cosmetic usability gap remains: projects --help is not a supported
subcommand; top-level help and projects output remain usable. This is not a
release blocker.

## Known limitations

Coordinator structured output can occasionally exhaust its bounded two-attempt
contract. It remains fail-closed: zero workflow, zero approval, and zero
project writes.

The final canonical Journey 6 did not obtain a product-owned
CORRECTION_APPLIED_AND_IMPROVED result. MVP-4 separately live-proved
implementation generation, compile/coverage gates, approval/apply, visual
detection, correction, runtime preflight, mounted build, rollback, and root
cancellation. This is an acceptance limitation, not an approval or filesystem
safety bypass.

## RC gate matrix

| Gate | Result | Evidence |
| --- | --- | --- |
| RC-01 Product source clean | PASS | main; product source 8ed4c73; docs-only RC changes |
| RC-02 Full regression green | PASS | MVP-4 final regression: 2,509 passed, 1 skipped, 0 failed; 52 Turbo tasks |
| RC-03 Package freshness | PASS | fresh npm pack/prepack; tarball SHA above |
| RC-04 Tarball contents valid | PASS | exactly four expected files; 266,158 bytes |
| RC-05 Secret scan clean | PASS | zero credential values/files/headers |
| RC-06 Clean install succeeds | PASS | global-prefix npm install; 4 packages |
| RC-07 Installed CLI starts | PASS | version/help/doctor/settings exit 0 |
| RC-08 No-credential UX | PASS | deterministic fallback and actionable setup guidance |
| RC-09 Project registration | PASS | add/list/show/inspect; frontend Git clean |
| RC-10 Design Engineer discoverable | PASS | help, workers, detail, README |
| RC-11 Configuration documented | PASS | README, package README, settings, doctor |
| RC-12 Approval safety | PASS | accepted MVP-4 approval-integrity evidence |
| RC-13 Rollback | PASS | LIVE_ROLLBACK_ACCEPTANCE = PASS |
| RC-14 Root cancellation | PASS | LIVE_ROOT_CANCELLATION_ACCEPTANCE = PASS |
| RC-15 Filesystem confinement | PASS | accepted MVP-4 filesystem audit |
| RC-16 Known limitations documented | PASS | this document and public README updates |
| RC-17 No release blockers open | PASS | MVP-4U final audit; none found |

## Version decision

Keep version 0.1.1 for this Release Candidate. MVP-5A changes are
documentation-only and do not require a semantic product version bump.
Publishing remains a separate human-authorized action.

## Smallest launch backlog

MUST BEFORE LAUNCH:

- Human-authorized npm publish of the already verified tarball.
- Post-publish install/version/help smoke test against the registry artifact.
- Confirm registry/tag/origin release bookkeeping.

SHOULD BEFORE LAUNCH:

- Add a subcommand-specific projects help view if CLI polish is desired.
- Replace historical L0 launch-gate presentation with the final release
  decision when the release owner publishes the launch record.

POST-LAUNCH:

- Improve Coordinator reliability without changing the frozen safety boundary.
- Persist bounded proposal-attempt failures[] detail.
- Clean archived historical acceptance state.
- Complete a future product-owned Journey 6 improved-recapture acceptance if
  the release program requires it.
- Keep the Northstar assertion as fixture-only debt unless fixture policy
  changes.

## Classification

MVP-5A: RC_READY_WITH_KNOWN_LIMITATIONS.

All package, installation, CLI, configuration, safety, security, and accepted
MVP-4 evidence gates pass. No MVP-5B implementation was started.

## MVP-5C release follow-up

This document preserves the historical MVP-5A audit at version 0.1.1. The
subsequent release-preparation decision bumps the immutable npm release to
designflow-ai@0.1.2; historical acceptance results above are not rewritten.

## MVP-5C publication evidence

Publication completed after exact-artifact verification.

- Release source: `main` at `6ce49f5b7ec538793b024b3781343aacaf4ef4aa`
- Package: `designflow-ai@0.1.2`
- Published tarball: `designflow-ai-0.1.2.tgz`
- Approved tarball SHA-256: `ee239d0bd94e12f2850df5db9ba27affc2f03d35d585c7b6968e26fefc5c46a8`
- Payload: four CLI-only files; no private package metadata
- Registry: `https://registry.npmjs.org/`
- Publication: PASS with public access; `latest` resolves to `0.1.2`
- Fresh public-registry installation: PASS
- Installed checks: `designflow --version`, `--help`, `doctor`, `settings`,
  and Design Engineer discovery all PASS
- Git tag: `v0.1.2`, pushed to `origin`, targeting the exact release commit

Known non-blocking limitations remain unchanged: bounded canonical
Coordinator output reliability and incomplete final canonical Journey 6
`CORRECTION_APPLIED_AND_IMPROVED` proof.
