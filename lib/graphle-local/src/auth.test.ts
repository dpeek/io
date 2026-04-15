import { describe, expect, it } from "bun:test";

import {
  createLocalAuthController,
  graphleAdminCookieName,
  parseCookieHeader,
  signLocalAdminSession,
  verifyLocalAdminSession,
} from "./auth.js";

describe("local auth", () => {
  it("signs and verifies local admin sessions", () => {
    const signed = signLocalAdminSession(
      {
        projectId: "project-1",
        subject: "local-admin",
        issuedAt: "2026-04-15T00:00:00.000Z",
      },
      "secret",
    );

    expect(verifyLocalAdminSession(signed, "secret")).toEqual({
      projectId: "project-1",
      subject: "local-admin",
      issuedAt: "2026-04-15T00:00:00.000Z",
    });
    expect(verifyLocalAdminSession(`${signed}tampered`, "secret")).toBeNull();
    expect(verifyLocalAdminSession(signed, "other-secret")).toBeNull();
  });

  it("redeems the init token once unless the request is already authenticated", () => {
    const auth = createLocalAuthController({
      authSecret: "secret",
      projectId: "project-1",
      initToken: "init-token",
      now: () => new Date("2026-04-15T00:00:00.000Z"),
    });

    const first = auth.redeemInitToken("init-token", null);
    expect(first).toMatchObject({
      ok: true,
      alreadyAuthenticated: false,
    });
    if (!first.ok) {
      throw new Error("Expected first redemption to succeed.");
    }

    const cookie = parseCookieHeader(first.setCookie ?? "").get(graphleAdminCookieName);
    expect(typeof cookie).toBe("string");
    expect(auth.getSession(`${graphleAdminCookieName}=${cookie}`)).toEqual({
      projectId: "project-1",
      subject: "local-admin",
      issuedAt: "2026-04-15T00:00:00.000Z",
    });

    expect(auth.redeemInitToken("init-token", null)).toEqual({
      ok: false,
      code: "auth.init_token_invalid",
      message: "The local admin init token is invalid or has already been used.",
    });
    expect(auth.redeemInitToken("init-token", `${graphleAdminCookieName}=${cookie}`)).toEqual({
      ok: true,
      alreadyAuthenticated: true,
    });
  });
});
