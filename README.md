# DesignFlow

DesignFlow is a universal, deterministic, capability-driven workflow compilation and execution engine.

## Repository Structure

```text
designflow/
├── apps/
│   └── cli/             # designflow CLI package (bin: wf)
├── packages/
│   ├── sdk/             # @designflow/sdk
│   ├── core/            # @designflow/core
│   ├── artifacts/       # @designflow/artifacts
│   └── state/           # @designflow/state
├── workflows/           # Domain-specific workflow packages
├── docs/
│   ├── ENGINEERING_CONSTITUTION.md
│   └── adr/             # Architecture Decision Records
├── turbo.json
├── package.json
├── bunfig.toml
├── tsconfig.base.json
└── README.md
```

## Quick Start

### Installation & Build

```bash
bun install
bun run build
```

### Scripts

- `bun run build`: Build all workspace packages via Turborepo
- `bun run lint`: Run linter across all packages
- `bun run typecheck`: Run TypeScript type checking across all packages
- `bun test`: Execute test suites using Bun native runner
