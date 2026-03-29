#! /usr/bin/env bun

export async function runTask([cmd, ...args]: string[]) {
  const module = await import(`../task/${cmd}.js`);
  return await module.run(args);
}

export async function runCli(args: string[]) {
  await runTask(args);
}

if (import.meta.main) {
  await runCli(Bun.argv.slice(2));
}
