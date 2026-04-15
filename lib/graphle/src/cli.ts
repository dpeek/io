#! /usr/bin/env bun

import { runGraphleCli } from "./index.js";

if (import.meta.main) {
  try {
    await runGraphleCli(Bun.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
