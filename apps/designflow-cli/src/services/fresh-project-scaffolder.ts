import { mkdir, realpath, writeFile } from "node:fs/promises";
import { lstatSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { FreshFrameEvidence } from "./fresh-figma-evidence";

const DEFAULT_OUTPUT_DIRECTORY = "designflow-output";
const MAX_SLUG_LENGTH = 64;

const GENERATED_FILES = [
  "package.json",
  "vite.config.ts",
  "tsconfig.json",
  "index.html",
  "src/main.tsx",
  "src/App.tsx",
  "src/styles.css",
  "src/assets/.gitkeep",
] as const;

export interface FreshScaffoldRequest {
  readonly evidence: FreshFrameEvidence;
  readonly outputRoot?: string;
}

export interface FreshScaffoldResult {
  readonly outputRoot: string;
  readonly targetPath: string;
  readonly frameSlug: string;
  readonly files: readonly string[];
}

export class FreshScaffoldError extends Error {
  public constructor(
    public readonly code:
      | "ERR_FRESH_SCAFFOLD_PATH"
      | "ERR_FRESH_SCAFFOLD_CONFLICT"
      | "ERR_FRESH_SCAFFOLD_WRITE",
    message: string,
    public readonly metadata: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "FreshScaffoldError";
    Object.setPrototypeOf(this, FreshScaffoldError.prototype);
  }
}

/** Derives a portable, stable directory name from trusted frame evidence. */
export function deriveFreshFrameSlug(
  evidence: Pick<FreshFrameEvidence, "frame">,
): string {
  const name = evidence.frame.name.normalize("NFKC").trim().toLowerCase();
  const normalized = name
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");

  if (normalized.length > 0) return avoidReservedWindowsName(normalized);

  const nodePart = evidence.frame.id
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH - "frame-".length)
    .replace(/-+$/g, "");
  return avoidReservedWindowsName(nodePart.length > 0 ? `frame-${nodePart}` : "frame");
}

/** Resolves a slug and rejects every path that is not a direct child. */
export function resolveFreshScaffoldTarget(outputRoot: string, frameSlug: string): {
  readonly outputRoot: string;
  readonly targetPath: string;
} {
  if (!isSafeSlug(frameSlug)) {
    throw new FreshScaffoldError(
      "ERR_FRESH_SCAFFOLD_PATH",
      "Fresh project frame slug is not a safe single directory name.",
      { frameSlug },
    );
  }

  const root = resolve(outputRoot);
  const target = resolve(root, frameSlug);
  const escaped = relative(root, target);
  if (escaped.length === 0 || escaped === ".." || escaped.startsWith(`..${sep}`) || isAbsolute(escaped)) {
    throw new FreshScaffoldError(
      "ERR_FRESH_SCAFFOLD_PATH",
      "Fresh project target must remain inside the approved output root.",
      { outputRoot: root, frameSlug },
    );
  }

  return { outputRoot: root, targetPath: target };
}

/** Creates one fixed host-owned Vite project and never overwrites a target. */
export async function scaffoldFreshUiProject(
  request: FreshScaffoldRequest,
): Promise<FreshScaffoldResult> {
  const frameSlug = deriveFreshFrameSlug(request.evidence);
  const requestedTarget = resolveFreshScaffoldTarget(
    request.outputRoot ?? resolve(process.cwd(), DEFAULT_OUTPUT_DIRECTORY),
    frameSlug,
  );

  rejectSymlinkOutputRoot(requestedTarget.outputRoot);
  try {
    await mkdir(requestedTarget.outputRoot, { recursive: true });
  } catch (error) {
    throw new FreshScaffoldError(
      "ERR_FRESH_SCAFFOLD_WRITE",
      `Fresh project output root could not be created: ${requestedTarget.outputRoot}`,
      { outputRoot: requestedTarget.outputRoot, cause: error instanceof Error ? error.message : String(error) },
    );
  }
  let outputRoot: string;
  try {
    outputRoot = await realpath(requestedTarget.outputRoot);
  } catch (error) {
    throw new FreshScaffoldError(
      "ERR_FRESH_SCAFFOLD_WRITE",
      `Fresh project output root could not be resolved: ${requestedTarget.outputRoot}`,
      { outputRoot: requestedTarget.outputRoot, cause: error instanceof Error ? error.message : String(error) },
    );
  }
  const { targetPath } = resolveFreshScaffoldTarget(outputRoot, frameSlug);

  try {
    await mkdir(targetPath);
  } catch (error) {
    if (isAlreadyExists(error)) {
      throw new FreshScaffoldError(
        "ERR_FRESH_SCAFFOLD_CONFLICT",
        `Fresh project target already exists: ${targetPath}`,
        { targetPath, frameSlug },
      );
    }
    throw new FreshScaffoldError(
      "ERR_FRESH_SCAFFOLD_WRITE",
      `Fresh project directory could not be created: ${targetPath}`,
      { targetPath, cause: error instanceof Error ? error.message : String(error) },
    );
  }

  try {
    await mkdir(resolveInside(targetPath, "src/assets"), { recursive: true });
    const files = scaffoldFiles(frameSlug);
    for (const [relativePath, contents] of Object.entries(files)) {
      const destination = resolveInside(targetPath, relativePath);
      await writeFile(destination, contents, { encoding: "utf8", flag: "wx" });
    }
    return { outputRoot, targetPath, frameSlug, files: GENERATED_FILES };
  } catch (error) {
    throw new FreshScaffoldError(
      "ERR_FRESH_SCAFFOLD_WRITE",
      `Fresh project files could not be written: ${targetPath}`,
      { targetPath, cause: error instanceof Error ? error.message : String(error) },
    );
  }
}

function isSafeSlug(value: string): boolean {
  return value.length > 0
    && value.length <= MAX_SLUG_LENGTH
    && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
    && value !== "."
    && value !== ".."
    && !value.includes("/")
    && !value.includes("\\");
}

function resolveInside(root: string, child: string): string {
  const destination = resolve(root, child);
  const escaped = relative(root, destination);
  if (escaped.length === 0 || escaped === ".." || escaped.startsWith(`..${sep}`) || isAbsolute(escaped)) {
    throw new FreshScaffoldError(
      "ERR_FRESH_SCAFFOLD_PATH",
      "Fresh scaffold file escaped its target directory.",
      { root, child },
    );
  }
  return destination;
}

function rejectSymlinkOutputRoot(outputRoot: string): void {
  let current = outputRoot;
  for (;;) {
    try {
      if (lstatSync(current).isSymbolicLink()) {
        throw new FreshScaffoldError(
          "ERR_FRESH_SCAFFOLD_PATH",
          "Fresh project output root must not contain symbolic links.",
          { outputRoot, symlinkPath: current },
        );
      }
      return;
    } catch (error) {
      if (error instanceof FreshScaffoldError) throw error;
      if ((error as { code?: string }).code !== "ENOENT") throw error;
      const parent = dirname(current);
      if (parent === current) return;
      current = parent;
    }
  }
}

function isAlreadyExists(error: unknown): boolean {
  return (error as { code?: string }).code === "EEXIST";
}

function avoidReservedWindowsName(value: string): string {
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value) ? `frame-${value}` : value;
}

function scaffoldFiles(frameSlug: string): Record<string, string> {
  return {
    "package.json": `${JSON.stringify({
      name: frameSlug,
      private: true,
      version: "0.0.0",
      type: "module",
      scripts: { dev: "vite", build: "tsc --noEmit && vite build" },
      dependencies: { react: "18.3.1", "react-dom": "18.3.1" },
      devDependencies: {
        "@types/react": "18.3.31",
        "@types/react-dom": "18.3.7",
        typescript: "5.9.3",
        vite: "6.4.3",
      },
    }, null, 2)}\n`,
    "vite.config.ts": `import { defineConfig } from "vite";\n\nexport default defineConfig({});\n`,
    "tsconfig.json": `${JSON.stringify({
      compilerOptions: {
        target: "ES2020",
        useDefineForClassFields: true,
        lib: ["ES2020", "DOM", "DOM.Iterable"],
        allowJs: false,
        skipLibCheck: true,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        strict: true,
        forceConsistentCasingInFileNames: true,
        module: "ESNext",
        moduleResolution: "Bundler",
        resolveJsonModule: true,
        isolatedModules: true,
        noEmit: true,
        jsx: "react-jsx",
      },
      include: ["src", "vite.config.ts"],
    }, null, 2)}\n`,
    "index.html": `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>${escapeHtml(frameSlug)}</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.tsx"></script>\n  </body>\n</html>\n`,
    "src/main.tsx": `import { StrictMode } from "react";\nimport { createRoot } from "react-dom/client";\nimport App from "./App";\nimport "./styles.css";\n\ncreateRoot(document.getElementById("root")!).render(\n  <StrictMode>\n    <App />\n  </StrictMode>,\n);\n`,
    "src/App.tsx": `export default function App() {\n  return (\n    <main className="app-shell">\n      <h1>Fresh UI scaffold</h1>\n      <p>This project is ready for the next DesignFlow phase.</p>\n    </main>\n  );\n}\n`,
    "src/styles.css": `:root {\n  font-family: Inter, system-ui, sans-serif;\n  color: #172033;\n  background: #f6f7fb;\n}\n\n* { box-sizing: border-box; }\n\nbody { margin: 0; min-width: 320px; }\n\n.app-shell {\n  min-height: 100vh;\n  display: grid;\n  place-content: center;\n  gap: 0.5rem;\n  padding: 2rem;\n  text-align: center;\n}\n`,
    "src/assets/.gitkeep": "",
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
  })[character] ?? character);
}
