// packages/mcp/src/fake-server-fixtures.ts
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
    /** Artificial per-tool response delay in milliseconds, for timeout tests. */
    delayMs: z.record(z.string(), z.number().int().nonnegative()).default({}),
  })
  .strict();

export type FakeMcpFixtures = z.infer<typeof fakeMcpFixturesSchema>;
