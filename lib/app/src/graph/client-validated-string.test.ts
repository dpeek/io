import { describe, expect, it } from "bun:test";

import { createTestGraph, testNamespace } from "./test-graph.js";

function setupGraph() {
  return createTestGraph().graph;
}

describe("validated string scalar modules", () => {
  it("normalizes built-in email and slug values through the scalar codecs", () => {
    const graph = setupGraph();

    const recordId = graph.record.create({
      name: "Acme",
      headline: "KS-1",
      status: testNamespace.status.values.draft.id,
      score: 8,
      contactEmail: "TEAM@Acme.com",
      slug: "Acme Labs",
    });

    const record = graph.record.get(recordId);
    expect(record.contactEmail).toBe("team@acme.com");
    expect(record.slug).toBe("acme-labs");

    const recordRef = graph.record.ref(recordId);
    recordRef.fields.contactEmail.set("Sales@Acme.com");
    recordRef.fields.slug.set("Platform Team");

    expect(recordRef.fields.contactEmail.get()).toBe("sales@acme.com");
    expect(recordRef.fields.slug.get()).toBe("platform-team");
  });

  it("rejects invalid built-in email and slug values", () => {
    const graph = setupGraph();

    expect(() =>
      graph.record.create({
        name: "Bad Co",
        headline: "KS-2",
        status: testNamespace.status.values.inReview.id,
        score: 13,
        contactEmail: "not-an-email",
      }),
    ).toThrow(/Invalid email value/);

    const recordId = graph.record.create({
      name: "Acme",
      headline: "KS-3",
      status: testNamespace.status.values.approved.id,
      score: 21,
    });

    const recordRef = graph.record.ref(recordId);

    expect(() => recordRef.fields.contactEmail.set("still-not-an-email")).toThrow(
      /Invalid email value/,
    );
    expect(() => recordRef.fields.slug.set("***")).toThrow(/Invalid slug value/);
    expect(recordRef.fields.contactEmail.get()).toBeUndefined();
    expect(recordRef.fields.slug.get()).toBeUndefined();
  });
});
