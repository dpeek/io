import { describe, expect, it } from "bun:test";

import { appRoutes, hrefForAppRoute, resolveAppRoute } from "./routes.js";

describe("app routes", () => {
  it("maps the workspace pathname to the management route", () => {
    expect(resolveAppRoute({ pathname: "/workspace" })).toBe("workspace");
    expect(hrefForAppRoute("workspace")).toBe("/workspace");
  });

  it("maps the env-var settings pathname to the operator route", () => {
    expect(resolveAppRoute({ pathname: "/settings/env-vars" })).toBe("envVars");
    expect(hrefForAppRoute("envVars")).toBe("/settings/env-vars");
  });

  it("keeps the legacy env-var surface alias from the root route", () => {
    expect(resolveAppRoute({ pathname: "/", search: "?surface=env-vars" })).toBe("envVars");
  });

  it("stops resolving proof surfaces from the legacy surface query param", () => {
    expect(resolveAppRoute({ pathname: "/", search: "?surface=query" })).toBe("company");
  });

  it("prefers explicit route paths over legacy surface params", () => {
    expect(resolveAppRoute({ pathname: "/query", search: "?surface=env-vars" })).toBe("query");
  });

  it("falls back to the pathname when an unknown legacy surface alias is present", () => {
    expect(resolveAppRoute({ pathname: "/query", search: "?surface=missing" })).toBe("query");
  });

  it("registers unique route keys and paths for the shared shell", () => {
    expect(new Set(appRoutes.map((route) => route.key)).size).toBe(appRoutes.length);
    expect(new Set(appRoutes.map((route) => route.path)).size).toBe(appRoutes.length);
  });
});
