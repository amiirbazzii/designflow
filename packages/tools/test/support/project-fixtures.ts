// packages/tools/test/support/project-fixtures.ts
//
// Real-project-shaped fixtures written to a temporary directory. Shapes only:
// no user project is ever read, and no real project path appears in product
// code or in these fixtures.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export interface FixtureProject {
  readonly root: string;
  cleanup(): void;
}

export function writeProject(files: Record<string, string>): FixtureProject {
  const root = mkdtempSync(join(tmpdir(), "designflow-project-fixture-"));
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const COMPONENT = (name: string) =>
  `export function ${name}({ label }: { label: string }) {\n  return <button className="rounded-[10px]">{label}</button>;\n}\n`;

/** A. Next.js App Router + TypeScript + Tailwind + aliases + a UI directory. */
export function nextAppRouterFixture(extra: Record<string, string> = {}): FixtureProject {
  return writeProject({
    "package.json": JSON.stringify(
      {
        name: "spendly-like",
        packageManager: "bun@1.3.14",
        scripts: { dev: "next dev", build: "next build", lint: "next lint", typecheck: "tsc --noEmit", test: "vitest run" },
        dependencies: { next: "15.0.0", react: "18.3.1", "react-dom": "18.3.1", "lucide-react": "0.400.0" },
        devDependencies: { typescript: "5.5.0", tailwindcss: "3.4.0", vitest: "2.0.0", "@playwright/test": "1.47.0" },
      },
      null,
      2,
    ),
    "bun.lock": "",
    "tsconfig.json": JSON.stringify(
      {
        compilerOptions: {
          baseUrl: ".",
          paths: { "@/*": ["./src/*"], "@ui/*": ["./src/components/ui/*"], "@missing/*": ["./nope/*"] },
        },
      },
      null,
      2,
    ),
    "tailwind.config.ts": "export default { content: ['./src/**/*.tsx'] };\n",
    "src/app/layout.tsx": "export default function RootLayout({ children }: { children: React.ReactNode }) {\n  return <html><body>{children}</body></html>;\n}\n",
    "src/app/page.tsx": "export default function Home() {\n  return <main>home</main>;\n}\n",
    "src/app/add/page.tsx": "export default function AddPage() {\n  return <main>add</main>;\n}\n",
    "src/components/ui/button.tsx": COMPONENT("Button"),
    "src/components/ui/text-field.tsx": COMPONENT("TextField"),
    "src/components/history-card.tsx": COMPONENT("HistoryCard"),
    "src/styles/globals.css": ":root {\n  --color-surface: #F8F8F8;\n  --radius-md: 10px;\n}\n",
    ...extra,
  });
}

/** B. React + Vite + TypeScript, react-router, jsconfig-free aliases. */
export function reactViteFixture(extra: Record<string, string> = {}): FixtureProject {
  return writeProject({
    "package.json": JSON.stringify(
      {
        name: "vite-app",
        scripts: { dev: "vite", build: "vite build", test: "jest" },
        dependencies: { react: "18.3.1", "react-router-dom": "6.26.0" },
        devDependencies: { typescript: "5.5.0", vite: "5.4.0", jest: "29.0.0" },
      },
      null,
      2,
    ),
    "pnpm-lock.yaml": "",
    "tsconfig.json": JSON.stringify({ extends: "./tsconfig.base.json", compilerOptions: { paths: { "~/*": ["./src/*"] } } }, null, 2),
    "tsconfig.base.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@shared/*": ["./src/shared/*"] } } }, null, 2),
    "src/App.tsx": "import { createBrowserRouter } from 'react-router-dom';\nexport const router = createBrowserRouter([{ path: '/dashboard', element: null }]);\nexport default function App() { return null; }\n",
    "src/main.tsx": "export {};\n",
    "src/components/Card.tsx": COMPONENT("Card"),
    "src/shared/Badge.tsx": COMPONENT("Badge"),
    ...extra,
  });
}

/** C. Sparse: a directory with almost nothing in it. */
export function sparseFixture(): FixtureProject {
  return writeProject({ "README.md": "# nothing here\n" });
}

/** A project with more components than the inventory bound retains. */
export function largeComponentFixture(count: number): FixtureProject {
  const files: Record<string, string> = {
    "package.json": JSON.stringify({ name: "big", dependencies: { react: "18.3.1" } }, null, 2),
  };
  for (let index = 0; index < count; index += 1) {
    files[`src/components/Component${String(index).padStart(3, "0")}.tsx`] = COMPONENT(`Component${index}`);
  }
  return writeProject(files);
}
