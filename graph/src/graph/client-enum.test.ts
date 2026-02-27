import { describe, expect, it } from "bun:test";
import { app } from "./app";
import { bootstrap } from "./bootstrap";
import { createTypeClient } from "./client";
import { core } from "./core";
import { createStore } from "./store";

describe("enum range client behavior", () => {
  it("accepts valid enum value ids", () => {
    const store = createStore();
    bootstrap(store, core);
    bootstrap(store, app);
    const graph = createTypeClient(store, app);

    const id = graph.company.create({
      name: "Acme",
      website: new URL("https://acme.com"),
      status: app.status.values.active.id,
    });

    const company = graph.company.get(id);
    expect(company.status).toBe(app.status.values.active.id);
  });

  it("rejects unknown enum value ids", () => {
    const store = createStore();
    bootstrap(store, core);
    bootstrap(store, app);
    const graph = createTypeClient(store, app);

    expect(() =>
      graph.company.create({
        name: "Bad Co",
        website: new URL("https://bad.example"),
        status: "active",
      }),
    ).toThrow(/Invalid enum value/);
  });
});
