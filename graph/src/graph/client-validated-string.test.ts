import { describe, expect, it } from "bun:test";
import { app } from "./app";
import { bootstrap } from "./bootstrap";
import { createTypeClient } from "./client";
import { core } from "./core";
import { createStore } from "./store";

function setupGraph() {
  const store = createStore();
  bootstrap(store, core);
  bootstrap(store, app);
  return createTypeClient(store, app);
}

describe("validated string scalar modules", () => {
  it("normalizes built-in email and slug values through the scalar codecs", () => {
    const graph = setupGraph();

    const companyId = graph.company.create({
      name: "Acme",
      website: new URL("https://acme.com"),
      status: app.status.values.active.id,
      contactEmail: "TEAM@Acme.com",
      slug: "Acme Labs",
    });

    const company = graph.company.get(companyId);
    expect(company.contactEmail).toBe("team@acme.com");
    expect(company.slug).toBe("acme-labs");

    const companyRef = graph.company.ref(companyId);
    companyRef.fields.contactEmail.set("Sales@Acme.com");
    companyRef.fields.slug.set("Platform Team");

    expect(companyRef.fields.contactEmail.get()).toBe("sales@acme.com");
    expect(companyRef.fields.slug.get()).toBe("platform-team");
  });

  it("rejects invalid built-in email and slug values", () => {
    const graph = setupGraph();

    expect(() =>
      graph.company.create({
        name: "Bad Co",
        website: new URL("https://bad.example"),
        status: app.status.values.active.id,
        contactEmail: "not-an-email",
      }),
    ).toThrow(/Invalid email value/);

    const companyId = graph.company.create({
      name: "Acme",
      website: new URL("https://acme.com"),
      status: app.status.values.active.id,
    });

    const companyRef = graph.company.ref(companyId);

    expect(() => companyRef.fields.contactEmail.set("still-not-an-email")).toThrow(
      /Invalid email value/,
    );
    expect(() => companyRef.fields.slug.set("***")).toThrow(/Invalid slug value/);
    expect(companyRef.fields.contactEmail.get()).toBeUndefined();
    expect(companyRef.fields.slug.get()).toBeUndefined();
  });
});
