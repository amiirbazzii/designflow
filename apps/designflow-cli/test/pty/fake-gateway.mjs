// Deterministic stand-in for the DesignFlow managed AI gateway, used by the
// PTY acceptance tests. Answers every ModelRequest with an output synthesized
// from the request's own responseSchema, so runs progress without paid AI.
//
// Two special cases make full journeys deterministic:
// - schema fields whose names look like node/frame ids get real snapshot ids
//   ("1:2"), so specification cross-validation against the fake Figma
//   document passes;
// - the implementation-agent schema (files + coverageClaims) gets a fixed,
//   compilable two-file proposal so runs reach the manual-approval review.
import { createServer } from "node:http";

const componentSource = (name, lines) => {
  const body = Array.from({ length: lines }, (_, i) => `  // ${name} presentation line ${i + 1}`).join("\n");
  return `import React from "react";\n\nexport default function ${name}({ label }) {\n${body}\n  return <div className="df-${name.toLowerCase()}">{label}</div>;\n}\n`;
};

const FIXTURE_PROPOSAL = {
  files: [
    { path: "src/components/Button.jsx", action: "create", content: componentSource("Button", 30), reason: "Implements the Button component from the design." },
    { path: "src/components/TextField.jsx", action: "create", content: componentSource("TextField", 8), reason: "Implements the TextField component from the design." },
  ],
  assumptions: ["Fixture proposal for PTY acceptance."],
  unresolvedItems: [],
  implementationVersion: "0.1.0",
  coverageClaims: [
    { targetId: "frame:1:2", mode: "proposed_change", paths: ["src/components/Button.jsx", "src/components/TextField.jsx"], supportingPaths: [] },
  ],
};

function instantiate(schema, depth = 0, hint = "") {
  if (schema === undefined || schema === null || depth > 12) return {};
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum.includes("prepare_implementation") ? "prepare_implementation" : schema.enum[0];
  }
  if (Array.isArray(schema.type) && schema.type.includes("null")) return null;
  if (schema.const !== undefined) return schema.const;
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (schema.anyOf) return instantiate(schema.anyOf[0], depth + 1, hint);
  if (schema.oneOf) return instantiate(schema.oneOf[0], depth + 1, hint);
  if (schema.allOf) return Object.assign({}, ...schema.allOf.map((s) => instantiate(s, depth + 1, hint)));
  switch (type) {
    case "string": return /node|frame|^id$/i.test(hint) ? "1:2" : schema.format === "uri" ? "https://example.com" : "placeholder";
    case "number": case "integer": return schema.minimum ?? 1;
    case "boolean": return true;
    case "array": {
      const min = /artifact|screenshot/i.test(hint)
        ? (schema.minItems ?? 0)
        : Math.max(schema.minItems ?? 0, depth <= 2 ? 1 : 0);
      const item = instantiate(schema.items ?? {}, depth + 1, hint);
      return Array.from({ length: min }, () => item);
    }
    case "object": default: {
      const out = {};
      const props = schema.properties ?? {};
      for (const key of schema.required ?? Object.keys(props)) out[key] = instantiate(props[key] ?? {}, depth + 1, key);
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
    const props = (body.responseSchema ?? {}).properties ?? {};
    const output = props.files !== undefined && props.coverageClaims !== undefined
      ? FIXTURE_PROPOSAL
      : instantiate(body.responseSchema);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      requestId: body.requestId ?? "unknown",
      providerId: "designflow-managed",
      model: body.model ?? "placeholder-model",
      output,
      durationMs: 5,
    }));
  });
});
server.listen(Number(process.env.FAKE_GATEWAY_PORT ?? 0), "127.0.0.1", () => {
  process.stdout.write(`LISTENING ${server.address().port}\n`);
});
