# DesignFlow

DesignFlow is an AI workflow platform where you run specialized AI workers from
the terminal to get real work done — design implementation, QA review,
research, and product planning. You describe what you need, a worker does it,
and you get back a DesignFlow artifact — a report, a brief, or a generated
code sample — that you can inspect and use right away.

## Workers

DesignFlow currently ships four workers:

- **Design Engineer** (development) — Works from a Figma design you connect,
  produces a design specification from it, and — only when you point it at a
  registered project and approve the exact changes it proposes — writes those
  changes into that project. Connecting Figma is a prerequisite: without it
  the worker explains the setup instead of running. See
  [Working from a Figma design](#working-from-a-figma-design) below.
- **QA Reviewer** (quality) — Reviews implementation artifacts for
  correctness, accessibility and consistency. Point it at a file and it comes
  back with a severity-rated list of findings.
- **Research Analyst** (research) — Synthesizes supplied sources into
  structured findings and citations. Give it a question and a set of sources,
  and it returns a brief where every claim is traceable back to a source.
- **Product Manager** (product) — Turns a product request into a structured
  brief with requirements and acceptance criteria, including risks and things
  explicitly out of scope.

## Installation

```bash
npm install -g designflow-ai
```

## Quick start

```bash
designflow doctor                  # what is configured, and what is ready to run
designflow workers                 # see what's available
designflow workers design-engineer # see detail on one worker
designflow run design-engineer     # put a worker to work
designflow settings                # configuration, agents, feature status
```

Start with `designflow doctor`. It is read-only, and its **Design Engineer
readiness** section is the one place that says plainly whether a design
specification or an implementation proposal can run right now, and what to
do about it if not. An incomplete setup is reported, not treated as a
failure.

Running `designflow` with no arguments drops you into an interactive menu
that walks you through the same things. Each worker asks for a small set of
plain-language fields — e.g. the Design Engineer asks for a design file, a
framework, and which frames to build; the QA Reviewer asks what to review and
how strict to be. Blank answers fall back to a sensible default, so you can
press through the form quickly.

## Projects

A project lets you point a worker at a folder of your own code so it has
context — the framework you use, where your components live, your testing
setup, and so on — instead of guessing or asking you every time.

```bash
designflow projects add --name my-app --path ./my-app
designflow projects              # list registered projects
designflow projects show <id>    # see what DesignFlow knows about one
designflow run design-engineer --project <id>
```

Nothing is registered automatically — a project only exists once you add it
yourself with `projects add`.

## Sessions

Sometimes a worker needs a bit more detail before it can start. Rather than
guess, it asks — and DesignFlow keeps the conversation open so you can answer
whenever you're ready.

```bash
designflow sessions           # see what's waiting on you
designflow answer <id>        # answer a worker's question
designflow cancel <id>        # give up on a waiting conversation
```

If you're mid-run and a worker asks a question, you can answer it right there
in the terminal. If you step away (or close the terminal) before answering,
the conversation is saved — `designflow answer <session-id>` picks it back up
later exactly where you left off.

A conversation left unanswered for too long (7 days by default) eventually
expires rather than waiting forever. `designflow cleanup` marks anything
stale as expired and tells you what it touched — it never removes your
completed history.

## Memory

Workers can remember useful, project-specific notes between runs — things
like your preferred report format or your accessibility requirements — so you
don't have to repeat yourself every time. Nothing is written to memory
silently: you either add it yourself, or approve something a worker proposed.

```bash
designflow memory                    # see what's remembered
designflow memory proposals          # see what a worker wants to remember
designflow memory approve <id>       # accept a proposed memory
designflow memory reject <id>        # decline it
designflow memory add --scope project --project <id> --key ... --value ...
designflow memory revoke <id>        # forget something for good
```

You're always in control of what's remembered — review it, approve or reject
proposals, and revoke anything at any time.

## Results

When a worker finishes, it hands back whatever the job called for — a written
report, a structured summary, or a design specification — stored as a
DesignFlow artifact. The one thing that reaches your own files is an
implementation change you explicitly consented to and then approved, in a
project you registered yourself. Past runs are kept so you can revisit them
later:

```bash
designflow history             # see previous runs
designflow history <worker>    # previous runs for one worker
designflow doctor              # check local runtime and state health
```

## Artifacts and reuse

Every run's output — analysis, tokens, generated code, reports — is stored as
a DesignFlow artifact. Nothing reaches your own files except an
implementation change you consented to and then approved. `designflow run`
says what happened when a run completes, and you can inspect exactly what was
produced:

```bash
designflow artifacts <run-id>                # list what a run produced or reused
designflow artifacts <run-id> <artifact-id>  # inspect one artifact's content
```

The interactive menu (`designflow` with no arguments) offers the same view
right after a run finishes: answer "yes" to "View artifacts now?".

**Reuse is based on the true identity of a run, not just an artifact's name.**
Re-running with the exact same design, frames, framework and project safely
reuses prior artifacts (you'll see `Reused` counts and no recomputation). Any
of the following invalidates that reuse and forces regeneration: a different
design file, different frames, a different framework, a different (or no)
registered project, an upstream artifact that changed, or DesignFlow's own
reuse rules changing between versions. Artifacts produced by a DesignFlow
version before this reuse-identity system existed are never treated as
reusable — they are safely regenerated the first time you run against them
again, rather than silently reused under new rules they were never checked
against. Your existing run history remains fully readable either way.

## Working from a Figma design

The Design Engineer reads a Figma design you connect. Connect one by adding a
`figmaMcp` block to `~/.designflow/config.json` — either a server command you
launch, or a Figma Desktop local endpoint. The exact schema, with working
examples for both, is in
[`apps/designflow-cli/README.md`](apps/designflow-cli/README.md#quick-start-working-from-a-figma-design);
`designflow doctor` tells you which state you are in, and distinguishes "no
`figmaMcp` block" from "a block that is present but unusable".

Optionally set `OPENROUTER_API_KEY` in your environment for live model
reasoning. Without it DesignFlow runs a deterministic fallback, which is a
supported mode rather than a stub. The value is never written to
configuration, printed, or stored.

Two independent gates protect your files:

- **Journey consent.** Passing `--project <id>` asks, per run, whether to
  prepare changes for that project. Declining continues as a specification.
- **Proposal approval.** Nothing is written until you approve the exact
  proposed changes.

`designflow settings` shows the five specialized agents behind the worker,
which model profile each uses, and which fields you have overridden locally.

**What is supported today.** A design specification, and implementation
proposal and apply, are supported and consent- and approval-gated. Visual
correction is a bounded beta continuation from eligible Design Engineer runs,
off by default and one iteration per explicit opt-in. The legacy
scaffold workflow is kept for compatibility with older runs and is no longer
the product path. "Supported" here means implemented and covered by this
repository's tests — it has not yet been verified against a real Figma
workspace and a live model provider, which is the next milestone's work.
Visual validation additionally needs the optional Playwright package and an
installed Chromium; `doctor` reports those two separately.

For local diagnostics, Git-aware write safety, state compatibility and the
remaining release gates, see
[`docs/STAGE_7_PRODUCTION_READINESS.md`](docs/STAGE_7_PRODUCTION_READINESS.md).
Design decisions behind the Figma integration and the specialized agents are
in [`docs/adr/20260810-figma-mcp-integration.md`](docs/adr/20260810-figma-mcp-integration.md)
and
[`docs/adr/20260803-design-engineer-specialized-agent-foundation.md`](docs/adr/20260803-design-engineer-specialized-agent-foundation.md).

## For developers

This README intentionally avoids internal vocabulary. If you're working on
DesignFlow itself, the architecture — agents, workflows, worker manifests, and
how they fit together — is documented in the Architecture Decision Records
under [`docs/adr/`](docs/adr/), not here.

## License

MIT — see [`LICENSE`](LICENSE).
