# `designflow` (CLI)

User-facing command-line interface package (`designflow`) providing the `wf` executable.

## Dependency Boundaries

- **Depends on `@designflow/core` and workflow packages.**

This is the legacy `wf` application and remains separate from the current
`designflow` CLI. It owns command parsing and presentation only; it must not
become a shared library for the current CLI. Use its package root and preserve
the existing `wf` command name.
