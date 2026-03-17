#! /usr/bin/env bun

async function run([cmd, ...args]: string[]) {
  const module = await import(`../task/${cmd}.js`);
  return await module.run(args);
}

await run(Bun.argv.slice(2));
