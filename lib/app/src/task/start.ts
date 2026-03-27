import { $ } from "bun";

export async function run() {
  // Keep the local auth-store D1 database in sync with the same persisted
  // Worker state directory used by Vite's Cloudflare dev integration.
  await $`bun run auth:migrations:apply:local`;
  await $`portless io vite dev`;
}
