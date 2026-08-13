# Project Mutation

**Purpose** — the only code in DesignFlow that writes to a user's project.

**Owns** — snapshot creation, atomic apply, rollback, the single-writer lock
and Git safety checks.

**Does not own** — deciding *what* to write (`../proposal`) or *whether it is
allowed* (`../approval`). It refuses to act without a verified approval and a
matching project fingerprint.

**Tests** — `./test/`.
