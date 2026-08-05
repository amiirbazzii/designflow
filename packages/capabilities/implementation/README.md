# `@designflow/capability-implementation`

Owns bounded project inspection, design-to-file mapping, approval binding,
Git safety checks, snapshots, safe application, rollback, and validation.

It must not own CLI command parsing, workflow orchestration, or model/provider
transport. Applications inject project roots and invoke the package-root API.
