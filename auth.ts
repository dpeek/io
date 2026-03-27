import Database from "better-sqlite3";

import { createBetterAuth } from "./lib/app/src/web/lib/better-auth.js";

// The Better Auth CLI needs a concrete sqlite database to infer the auth
// schema. Use a Node-compatible sqlite driver here because the CLI loads this
// config outside Bun. The Worker runtime uses the dedicated AUTH_DB D1 binding
// instead.
const cliAuthStore = new Database(":memory:");

export const auth = createBetterAuth({
  AUTH_DB: cliAuthStore,
  BETTER_AUTH_SECRET:
    process.env.BETTER_AUTH_SECRET ?? "development-only-better-auth-secret-change-me",
  BETTER_AUTH_TRUSTED_ORIGINS: process.env.BETTER_AUTH_TRUSTED_ORIGINS,
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? "http://localhost:8787",
});
