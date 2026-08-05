# Test fixtures

This directory contains source-controlled acceptance fixtures used by tests.
They are not production application code and must not be imported by runtime
modules.

The tracked `designflow-stage7-preview` project is used by the visual
validation workflow to verify preview-script discovery and provenance. The
tracked `designflow-stage4-project` project is retained for stage-4 workflow
coverage. Tests that need disposable projects should create them under the
operating system temporary directory instead.

Generated copies and preview output belong under `test-fixtures/.generated/`,
which is ignored by Git.
