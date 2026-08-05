// packages/mcp/test/fixtures/fake-server/fake-server-fixtures.ts
import { z } from "zod";

/** What `fake-server-entry.ts` serves, configured via the `FAKE_MCP_FIXTURES` env var. */
export const fakeMcpFixturesSchema = z
  .object({
    tools: z
      .array(z.object({ name: z.string().min(1), description: z.string().optional() }).strict())
      .default([]),
    /** toolName -> the `content` a successful call returns. */
    toolResults: z.record(z.string(), z.unknown()).default({}),
    /** Tool names that respond with `isError: true` instead of a normal result. */
    errorTools: z.array(z.string().min(1)).default([]),
    /** Tool names the server does not recognise at all — JSON-RPC "method not found". */
    unknownTools: z.array(z.string().min(1)).default([]),
    /** Tool names that respond with an oversized payload, for size-limit tests. */
    oversizedTools: z.array(z.string().min(1)).default([]),
    oversizedByteCount: z.number().int().positive().default(10_000_000),
    /** When true, the server answers `initialize` with a JSON-RPC error instead of a result. */
    initializeError: z.boolean().default(false),
    /**
     * Overrides the entire `initialize` result verbatim — including malformed
     * shapes, missing or non-string `protocolVersion`, or unsupported
     * versions — so initialization-validation tests can drive every failure
     * path through the real transport.
     */
    initializeResult: z.unknown().optional(),
    /**
     * Tool names that respond with the server's own `process.env` as the
     * content, so a test can assert exactly which variables crossed the
     * spawn boundary. Test fixtures only ever carry fabricated values.
     */
    echoEnvTools: z.array(z.string().min(1)).default([]),
    /** Artificial per-tool response delay in milliseconds, for timeout tests. */
    delayMs: z.record(z.string(), z.number().int().nonnegative()).default({}),
  })
  .strict();

export type FakeMcpFixtures = z.infer<typeof fakeMcpFixturesSchema>;
