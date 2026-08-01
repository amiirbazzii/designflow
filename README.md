# DesignFlow

DesignFlow is an AI workflow platform where you run specialized AI workers from
the terminal to get real work done — design implementation, QA review,
research, and product planning. You describe what you need, a worker does it,
and you get back files, reports, or summaries you can use right away.

## Workers

DesignFlow currently ships four workers:

- **Design Engineer** (development) — Transforms designs into
  production-ready applications. Give it a design file and a framework, and
  it produces working, structured code.
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
npm install -g designflow
```

## Quick start

```bash
designflow workers                 # see what's available
designflow workers design-engineer # see detail on one worker
designflow run design-engineer     # put a worker to work
```

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

When a worker finishes, it hands back whatever the job called for — generated
files, a written report, or a structured summary you can act on immediately.
Past runs are kept so you can revisit them later:

```bash
designflow history             # see previous runs
designflow history <worker>    # previous runs for one worker
```

## For developers

This README intentionally avoids internal vocabulary. If you're working on
DesignFlow itself, the architecture — agents, workflows, worker manifests, and
how they fit together — is documented in the Architecture Decision Records
under [`docs/adr/`](docs/adr/), not here.

## License

This project's `package.json` declares an MIT license, but no `LICENSE` file
currently exists in this repository. Someone with authority to choose the
project's license should add one before this package is published.
