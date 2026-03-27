import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const libRoot = join(repoRoot, "lib");
const sourceExtensions = new Set([".ts", ".tsx"]);
const importSpecifierPattern =
  /\b(?:import|export)\s+(?:type\s+)?(?:[^"'`]*?\sfrom\s*)?["']([^"']+)["']|\bimport\(["']([^"']+)["']\)/g;

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "out") continue;
    const path = join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(path));
      continue;
    }

    if (!sourceExtensions.has(extname(entry.name))) continue;
    files.push(path);
  }

  return files;
}

function relativeFromRepo(path: string): string {
  return relative(repoRoot, path).replaceAll("\\", "/");
}

describe("workspace package boundaries", () => {
  it("does not allow cross-package relative imports into another package src tree", () => {
    const violations: string[] = [];

    for (const file of collectSourceFiles(libRoot)) {
      const contents = readFileSync(file, "utf8");

      for (const match of contents.matchAll(importSpecifierPattern)) {
        const specifier = match[1] ?? match[2];
        if (!specifier?.startsWith(".") || !specifier.includes("/src/")) continue;
        violations.push(`${relativeFromRepo(file)} -> ${specifier}`);
      }
    }

    expect(violations).toEqual([]);
  });
});
