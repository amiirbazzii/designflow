// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Type-aware linting (typescript-eslint's `recommendedTypeChecked`) was
// evaluated and deliberately NOT used here. Each package's tsconfig.json
// is a composite project-reference config that EXCLUDES `**/*.test.ts`
// (tests aren't part of the build graph), so turning on `parserOptions.project`
// would either (a) fail to type-check every *.test.ts file across all ~22
// workspace packages, or (b) require adding a second, lint-only tsconfig per
// package (or a shared `projectService` config wired to test files) just to
// cover them. That's real, ongoing plumbing for every future package, not a
// one-time cost, so we fall back to the non-type-aware `recommended` config
// below. Revisit if/when per-package "tsconfig.eslint.json" files exist.

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/*.tsbuildinfo",
      "**/.turbo/**",
      "**/build/**",
      "**/coverage/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "no-duplicate-imports": "error",
    },
  },
  {
    // Library code (packages/**, workflows/**): no raw console output.
    // These are consumed as libraries by apps/**, so ad-hoc console.* calls
    // are almost always debugging leftovers or a missing use of the caller's
    // own Logger (see packages/sdk's `Logger` interface).
    files: ["packages/**/*.ts", "workflows/**/*.ts"],
    rules: {
      "no-console": "error",
    },
  },
  {
    // apps/** (CLI/API/demo/web): also kept at "error". Every app in this
    // repo already routes output through its own IO/Logger abstraction
    // (e.g. apps/cli/src/logger.ts, apps/designflow-demo/src/io.ts) rather
    // than calling console.* directly from business logic, so this rule
    // costs nothing in the common case and reveals genuine stragglers. The
    // one legitimate exception is the concrete Logger implementation itself,
    // which is allowed to call console.* via a narrowly-scoped
    // eslint-disable-next-line at each call site.
    files: ["apps/**/*.ts"],
    rules: {
      "no-console": "error",
    },
  },
  {
    // Tests matter too: keep no-unused-vars / no-explicit-any at full
    // strength. Only relax no-console, since console.log is a normal,
    // deliberate debugging tool inside test files.
    files: ["**/*.test.ts"],
    rules: {
      "no-console": "off",
    },
  },
);
