import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { $ } from "bun";

const testFilePattern = /(?:\.test|\.spec|_test_|_spec_)\.[^.]+$/;
const skippedDirectoryNames = new Set([".git", "node_modules"]);

async function pathHasTests(target: string): Promise<boolean> {
  const absolutePath = resolve(target);

  let targetStat;
  try {
    targetStat = await stat(absolutePath);
  } catch {
    return false;
  }

  if (targetStat.isFile()) return testFilePattern.test(absolutePath);
  if (!targetStat.isDirectory()) return false;

  const entries = await readdir(absolutePath, { withFileTypes: true });
  for (const entry of entries) {
    if (skippedDirectoryNames.has(entry.name)) continue;

    const entryPath = resolve(absolutePath, entry.name);
    if (entry.isFile() && testFilePattern.test(entry.name)) return true;
    if (entry.isDirectory() && (await pathHasTests(entryPath))) return true;
  }

  return false;
}

async function hasTestTargets(targets: readonly string[]): Promise<boolean> {
  for (const target of targets) {
    if (await pathHasTests(target)) return true;
  }
  return false;
}

export async function run(paths: string[]) {
  const targets = paths.length > 0 ? paths : ["src", "lib"];

  try {
    await $`tsgo --noEmit`;
    await $`vp fmt ${targets}`;
    await $`vp lint --fix ${targets}`;
    if (await hasTestTargets(targets)) {
      await $`bun test ${targets}`;
    }
  } catch (err: any) {
    console.log(err.stderr?.toString?.() ?? String(err));
    process.exit(err.exitCode ?? 1);
  }
}
