# `@designflow/storage-sqlite`

Owns SQLite-backed persistence adapters for approvals, artifacts, events,
executions, and sessions.

It must not own HTTP handlers, UI code, workflow policy, or domain scheduling.
Wire it in an application composition root and import only its package root.
