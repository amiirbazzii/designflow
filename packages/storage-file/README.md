# `@designflow/storage-file`

Owns file-backed persistence adapters for state, project memory, sessions, and
feedback-loop records.

It must not own domain orchestration, CLI commands, or workflow definitions.
Use `@designflow/storage-file` from a composition root; domain code should use
SDK ports.
