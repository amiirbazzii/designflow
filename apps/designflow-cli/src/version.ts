// apps/designflow-cli/src/version.ts

/**
 * The installed version, as `designflow --version` reports it.
 *
 * A constant rather than a read of `package.json`: the published entry point is
 * a single bundled `dist/main.js`, so resolving `package.json` at runtime means
 * guessing at a path relative to a bundle — which works in the workspace and
 * breaks once installed.
 *
 * The duplication that buys is real, so a test asserts this equals the version
 * in `package.json`. That is the check that would catch a release publishing one
 * number and reporting another.
 */
export const CLI_VERSION = "0.1.0";
