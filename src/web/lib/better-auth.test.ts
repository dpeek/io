import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";

import { betterAuthBasePath, createBetterAuthOptions } from "./better-auth.js";

describe("web Better Auth factory", () => {
  it("builds the shared worker options from the auth env surface", () => {
    const authDb = new Database(":memory:");
    const options = createBetterAuthOptions({
      AUTH_DB: authDb,
      BETTER_AUTH_SECRET: "L5tH1pQ8xJ2mR9vN4sC7kW3yF6uB0dE!ZaG1oP5qT8xV2",
      BETTER_AUTH_TRUSTED_ORIGINS: "https://app.local, https://admin.local ,",
      BETTER_AUTH_URL: "https://web.local",
    });

    expect(options.baseURL).toBe("https://web.local");
    expect(options.basePath).toBe(betterAuthBasePath);
    expect(options.secret).toBe("L5tH1pQ8xJ2mR9vN4sC7kW3yF6uB0dE!ZaG1oP5qT8xV2");
    expect(options.database).toBe(authDb);
    expect(options.emailAndPassword).toEqual({
      enabled: true,
      autoSignIn: true,
    });
    expect(options.trustedOrigins).toEqual(["https://app.local", "https://admin.local"]);
  });

  it("leaves trusted origins unset when the worker env does not provide them", () => {
    const options = createBetterAuthOptions({
      AUTH_DB: new Database(":memory:"),
      BETTER_AUTH_SECRET: "L5tH1pQ8xJ2mR9vN4sC7kW3yF6uB0dE!ZaG1oP5qT8xV2",
      BETTER_AUTH_URL: "https://web.local",
    });

    expect(options.trustedOrigins).toBeUndefined();
  });
});
