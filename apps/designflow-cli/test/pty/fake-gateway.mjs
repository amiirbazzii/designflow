// Deterministic stand-in for the DesignFlow managed AI gateway, used by the
// PTY acceptance tests. Answers every ModelRequest with an output synthesized
// from the request's own responseSchema, so runs progress without paid AI.
import { createServer } from "node:http";

function instantiate(schema, depth = 0) {
  if (schema === undefined || schema === null || depth > 12) return {};
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum.includes("prepare_implementation") ? "prepare_implementation" : schema.enum[0];
  }
  if (Array.isArray(schema.type) && schema.type.includes("null")) return null;
  if (schema.const !== undefined) return schema.const;
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (schema.anyOf) return instantiate(schema.anyOf[0], depth + 1);
  if (schema.oneOf) return instantiate(schema.oneOf[0], depth + 1);
  if (schema.allOf) return Object.assign({}, ...schema.allOf.map((s) => instantiate(s, depth + 1)));
  switch (type) {
    case "string": return schema.format === "uri" ? "https://example.com" : "placeholder";
    case "number": case "integer": return schema.minimum ?? 1;
    case "boolean": return true;
    case "array": {
      const item = instantiate(schema.items ?? {}, depth + 1);
      return Array.from({ length: Math.max(schema.minItems ?? 0, 0) }, () => item);
    }
    case "object": default: {
      const out = {};
      const props = schema.properties ?? {};
      for (const key of schema.required ?? Object.keys(props)) out[key] = instantiate(props[key] ?? {}, depth + 1);
      return out;
    }
  }
}

const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => { raw += chunk; });
  req.on("end", () => {
    let body;
    try { body = JSON.parse(raw); } catch { body = {}; }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      requestId: body.requestId ?? "unknown",
      providerId: "designflow-managed",
      model: body.model ?? "placeholder-model",
      output: instantiate(body.responseSchema),
      durationMs: 5,
    }));
  });
});
server.listen(Number(process.env.FAKE_GATEWAY_PORT ?? 0), "127.0.0.1", () => {
  process.stdout.write(`LISTENING ${server.address().port}\n`);
});
