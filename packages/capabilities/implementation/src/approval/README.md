# Approval

**Purpose** — binding a human decision to one exact proposal.

**Owns** — the approval binding, its hash and fingerprint equality checks, and
its expiry.

**Does not own** — the UI that asks, or the write that follows.

**Known debt** — fingerprint verification is duplicated across three packages;
consolidation is scheduled before V2-7 pre-approval convergence.

**Tests** — `./test/`.
