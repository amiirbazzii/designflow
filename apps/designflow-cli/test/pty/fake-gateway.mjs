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


// ── V2 role synthesis (V2-9) ────────────────────────────────────
//
// The V2 flagship's Mapper and Builder prompts embed their own evidence as
// JSON, so this gateway answers from the request itself: real structured
// contracts, deterministic content, no hardcoded final artifacts. The
// Design Interpreter keeps the generic instantiation (a rejected semantic
// patch degrades additively, exactly like a real unavailable interpreter).

const userContent = (body) => {
  const message = (body.messages ?? []).find((entry) => entry.role === "user");
  return typeof message?.content === "string" ? message.content : "";
};

function balancedJson(content, from) {
  const start = content.slice(from).search(/[[{]/);
  if (start < 0) return undefined;
  const begin = from + start;
  const open = content[begin];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  for (let i = begin; i < content.length; i += 1) {
    const ch = content[i];
    if (inString) {
      if (ch === "\\") i += 1;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(content.slice(begin, i + 1)); } catch { return undefined; }
      }
    }
  }
  return undefined;
}

const section = (content, marker) => {
  const idx = content.indexOf(marker);
  return idx < 0 ? undefined : balancedJson(content, idx + marker.length);
};

const pascal = (label) => {
  const name = String(label ?? "Component").replace(/[^A-Za-z0-9]+/g, " ").trim()
    .split(" ").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("");
  return /^[A-Za-z]/.test(name) ? name : `C${name}`;
};

const FULL_COMPAT = { structure: "compatible", slots: "compatible", states: "compatible", visual: "compatible", interaction: "compatible" };

function synthesizeMappingPatch(body) {
  const content = userContent(body);
  const header = /Mapping partition: (\S+) \((\w+)\)/.exec(content);
  const stage = header?.[2] ?? "components";
  const design = section(content, "Design requirements (authoritative):") ?? {};
  const project = section(content, "Project facts (authoritative):") ?? {};
  const decide = section(content, "Decide exactly these:") ?? {};

  const patch = {
    componentDecisions: [],
    destinationDecision: null,
    styleDecisions: [],
    assetDecisions: [],
    compositionDecisions: [],
    uncertainties: [],
  };

  if (stage === "destination") {
    const candidate = (project.destinations ?? [])[0];
    if (candidate !== undefined) {
      // An existing composition root is used in place; only a genuinely new
      // page is created. Mirrors what a competent mapper would decide.
      const action = candidate.kind === "composition-root" && candidate.status === "existing"
        ? "use_existing"
        : "create_page";
      patch.destinationDecision = {
        requirementId: (decide.requirementIds ?? [])[0] ?? "requirement:screen",
        action,
        candidateId: candidate.id,
        compositionRootCandidateId: action === "use_existing" ? candidate.id : null,
        reason: "PTY fixture: first destination candidate.",
        confidence: "high",
      };
    }
  }

  if (stage === "composition") {
    for (const region of design.regions ?? []) {
      patch.compositionDecisions.push({
        blueprintRef: region.id,
        order: region.order ?? 0,
        componentRequirementId: null,
        childRefs: region.memberElementIds ?? [],
      });
    }
  }

  if (stage === "components") {
    const requirements = design.requirements ?? [];
    const candidateSets = new Map((project.candidates ?? []).map((set) => [set.requirementId, set.candidates ?? []]));
    const directory = (project.plannedDirectories ?? [])[0];
    for (const requirement of requirements) {
      if (requirement.kind !== "component-definition") continue;
      const candidates = candidateSets.get(requirement.id) ?? [];
      if (candidates.length > 0) {
        patch.componentDecisions.push({
          requirementId: requirement.id,
          action: "reuse",
          candidateId: candidates[0].id,
          plannedDirectoryId: null,
          plannedName: null,
          compatibility: FULL_COMPAT,
          requiredAdaptations: [],
          reason: "PTY fixture: reuse the first candidate.",
          confidence: "high",
        });
      } else if (directory !== undefined) {
        patch.componentDecisions.push({
          requirementId: requirement.id,
          action: "create",
          candidateId: null,
          plannedDirectoryId: directory.id,
          plannedName: pascal(requirement.label),
          compatibility: FULL_COMPAT,
          requiredAdaptations: [],
          reason: "PTY fixture: no candidate exists, create in the planned directory.",
          confidence: "high",
        });
      }
    }
  }

  return patch;
}

function synthesizeBuilderProposal(body) {
  const content = userContent(body);
  const design = section(content, "Design requirements (authoritative):") ?? {};
  const decisions = section(content, "Implementation decisions (immutable):") ?? {};
  const constraints = section(content, "Constraints:") ?? {};
  const allowed = new Set(constraints.allowedWritePaths ?? []);

  const copy = [
    ...(design.elements ?? []).map((element) => element.text).filter((text) => typeof text === "string"),
    ...((design.components ?? []).flatMap((component) =>
      (component.instances ?? []).flatMap((instance) => (instance.contents ?? []).map((slot) => slot.text)),
    )).filter((text) => typeof text === "string"),
  ];

  const files = [];
  const created = [];
  for (const decision of decisions.components ?? []) {
    if (decision.action === "create" && typeof decision.plannedPath === "string" && allowed.has(decision.plannedPath)) {
      const name = pascal(decision.label ?? decision.plannedPath.split("/").pop().replace(/\.[^.]+$/, ""));
      created.push({ path: decision.plannedPath, name });
      files.push({
        path: decision.plannedPath,
        action: "create",
        content: `export default function ${name}() {\n  return <div className="df-${name.toLowerCase()}">${name}</div>;\n}\n`,
        reason: `Implements ${name} from the design.`,
      });
    }
  }

  const destination = decisions.destination?.path;
  const destinationExists = decisions.destination?.action === "use_existing" || decisions.destination?.action === "integrate_existing_root";
  if (typeof destination === "string" && allowed.has(destination)) {
    const destinationDir = destination.split("/").slice(0, -1).join("/");
    const importFor = (path) => {
      const target = path.replace(/\.[^.]+$/, "");
      const fromParts = destinationDir.split("/").filter(Boolean);
      const toParts = target.split("/").filter(Boolean);
      let common = 0;
      while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) common += 1;
      const up = fromParts.length - common;
      const rel = [...Array(up).fill(".."), ...toParts.slice(common)].join("/");
      return rel.startsWith(".") ? rel : `./${rel}`;
    };
    const screenName = pascal(destination.split("/").pop().replace(/\.[^.]+$/, ""));
    const imports = created.map((entry) => `import ${entry.name} from "${importFor(entry.path)}";`).join("\n");
    // Each copy line renders inside its own section so the generated file —
    // and therefore its review diff — is taller than the TUI diff viewport,
    // letting the acceptance driver assert real scrolling.
    const body = [
      ...copy.map((text, index) => [
        `      <section className="df-block df-block-${index}">`,
        `        <div className="df-block-inner">`,
        `          <p>${String(text).replace(/[<>&]/g, " ")}</p>`,
        `        </div>`,
        `      </section>`,
      ].join("\n")),
      ...created.map((entry) => `      <${entry.name} />`),
      ...Array.from({ length: 14 }, (_, index) => `      <span className="df-spacer-${index}" />`),
    ].join("\n");
    files.push({
      path: destination,
      action: destinationExists ? "modify" : "create",
      content: `${imports}\n\nexport default function ${screenName}() {\n  return (\n    <main>\n${body}\n    </main>\n  );\n}\n`,
      reason: "Implements the screen at the planned destination.",
    });
  }

  return { files, assumptions: ["PTY fixture V2 builder proposal."], unresolvedItems: [] };
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
      : props.componentDecisions !== undefined && props.destinationDecision !== undefined
        ? synthesizeMappingPatch(body)
        : props.files !== undefined && props.unexecutableReason !== undefined
          ? synthesizeBuilderProposal(body)
          : instantiate(body.responseSchema);
    if (process.env.FAKE_GATEWAY_LOG !== undefined) {
      import("node:fs").then((fs) =>
        fs.appendFileSync(
          process.env.FAKE_GATEWAY_LOG,
          JSON.stringify({ schema: Object.keys(props), content: userContent(body).slice(0, 4000), output }) + "\n",
        ));
    }
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
