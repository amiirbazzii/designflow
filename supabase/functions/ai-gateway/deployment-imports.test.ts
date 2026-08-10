import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const functionRoot = fileURLToPath(new URL(".", import.meta.url));
const localImportPattern = /(?:from\s+|import\s*)["'](\.[^"']+)["']/g;

function reachableLocalImports(entryFiles: readonly string[]): Array<{ file: string; specifier: string; target: string }> {
  const seen = new Set<string>();
  const imports: Array<{ file: string; specifier: string; target: string }> = [];
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(localImportPattern)) {
      const specifier = match[1];
      const target = resolve(dirname(file), specifier);
      imports.push({ file, specifier, target });
      if (target.startsWith(functionRoot) && target.endsWith(".ts") && existsSync(target)) visit(target);
    }
  };

  for (const entry of entryFiles) visit(resolve(functionRoot, entry));
  return imports;
}

describe("ai-gateway Deno deployment imports", () => {
  test("all reachable local TypeScript imports use existing explicit .ts files", () => {
    const imports = reachableLocalImports(["index.ts", "handler.ts"]);
    expect(imports.length).toBeGreaterThan(0);
    for (const { file, specifier, target } of imports) {
      expect(specifier.endsWith(".ts")).toBe(true);
      expect(existsSync(target)).toBe(true);
      expect(file.startsWith(functionRoot)).toBe(true);
    }
  });
});
