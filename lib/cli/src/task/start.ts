import { $ } from "bun";

export async function run() {
  // Keep the local auth-store D1 database in sync with the same persisted
  // Worker state directory used by the app-local Cloudflare Vite dev runtime.
  await $`bun --cwd lib/app run auth:migrations:apply:local`;
  await $`portless bun run web:dev`;
}
