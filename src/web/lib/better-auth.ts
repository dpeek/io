import { betterAuth, type BetterAuthOptions } from "better-auth";

import { betterAuthBasePath } from "./auth-path.js";

export { betterAuthBasePath } from "./auth-path.js";

export type BetterAuthDatabaseBinding = NonNullable<BetterAuthOptions["database"]>;

export interface BetterAuthWorkerEnv {
  AUTH_DB: BetterAuthDatabaseBinding;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_TRUSTED_ORIGINS?: string;
  BETTER_AUTH_URL: string;
}

function parseBetterAuthList(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }

  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return entries.length > 0 ? entries : undefined;
}

export function createBetterAuthOptions(env: BetterAuthWorkerEnv): BetterAuthOptions {
  const trustedOrigins = parseBetterAuthList(env.BETTER_AUTH_TRUSTED_ORIGINS);

  return {
    baseURL: env.BETTER_AUTH_URL,
    basePath: betterAuthBasePath,
    secret: env.BETTER_AUTH_SECRET,
    database: env.AUTH_DB,
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
    },
    ...(trustedOrigins ? { trustedOrigins } : {}),
  };
}

type BetterAuthInstance = ReturnType<typeof createBetterAuth>;

const betterAuthByEnv = new WeakMap<BetterAuthWorkerEnv, BetterAuthInstance>();

export function getBetterAuth(env: BetterAuthWorkerEnv): BetterAuthInstance {
  const cached = betterAuthByEnv.get(env);
  if (cached) {
    return cached;
  }

  const auth = createBetterAuth(env);
  betterAuthByEnv.set(env, auth);
  return auth;
}

export function createBetterAuth(env: BetterAuthWorkerEnv) {
  return betterAuth(createBetterAuthOptions(env));
}
