import { resolve } from "node:path";

import { $ } from "bun";

async function listRepoTestFiles() {
  const output = await $`rg --files src lib -g '*.test.ts' -g '*.test.tsx'`.text();
  return output
    .split("\n")
    .filter(Boolean)
    .map((file) => resolve(file));
}

export async function run() {
  try {
    await $`tsgo --noEmit`;
    await $`oxfmt`;
    await $`oxlint --fix`;
    const testFiles = await listRepoTestFiles();
    const testProcess = Bun.spawn(["bun", "test", ...testFiles], {
      stdout: "inherit",
      stderr: "inherit",
    });
    const exitCode = await testProcess.exited;

    if (exitCode !== 0) {
      process.exit(exitCode);
    }
  } catch (err: any) {
    console.log(err.stderr?.toString?.() ?? String(err));
    process.exit(err.exitCode ?? 1);
  }
}
