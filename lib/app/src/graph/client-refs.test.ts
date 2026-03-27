import { describe, expect, it } from "bun:test";

import {
  fieldGroupFieldTree,
  fieldGroupId,
  fieldGroupKey,
  fieldGroupPath,
  fieldGroupSubjectId,
  isFieldGroupRef,
  type EntityRef,
  type FieldGroupRef,
  type PredicateRef,
} from "@io/graph-client";
import { edgeId, fieldTreeId } from "@io/graph-kernel";

import { createTestGraph, testDefs, testNamespace } from "./test-graph.js";

function setupGraph() {
  const { store, graph, coreGraph } = createTestGraph();

  const enterpriseTagId = coreGraph.tag.create({
    name: "Enterprise",
    key: "enterprise",
    color: "#6366f1",
  });
  const saasTagId = coreGraph.tag.create({
    name: "SaaS",
    key: "saas",
    color: "#10b981",
  });
  const aiTagId = coreGraph.tag.create({
    name: "AI",
    key: "ai",
    color: "#f59e0b",
  });
  const platformTagId = coreGraph.tag.create({
    name: "Platform",
    key: "platform",
    color: "#0ea5e9",
  });
  const b2bTagId = coreGraph.tag.create({
    name: "B2B",
    key: "b2b",
    color: "#ef4444",
  });

  const companyId = graph.record.create({
    name: "Acme",
    headline: "KS-1",
    status: testNamespace.status.values.draft.id,
    score: 12,
    website: new URL("https://acme.com"),
    tags: [enterpriseTagId, saasTagId],
    contact: {
      email: "team@acme.com",
      website: new URL("https://support.acme.com"),
    },
  });

  return {
    store,
    graph,
    companyId,
    tagIds: {
      aiTagId,
      b2bTagId,
      enterpriseTagId,
      platformTagId,
      saasTagId,
    },
  };
}

describe("typed refs", () => {
  it("returns stable entity and predicate refs for the same node", () => {
    const { graph, companyId } = setupGraph();

    const companyRefA = graph.record.ref(companyId);
    const companyRefB = graph.record.ref(companyId);

    expect(companyRefA).toBe(companyRefB);
    expect(graph.record.node(companyId)).toBe(companyRefA);
    expect(companyRefA.fields.name).toBe(companyRefB.fields.name);
    expect(companyRefA.fields.website).toBe(companyRefB.fields.website);
  });

  it("preserves nested field-group traversal shape as stable non-subscribing refs", () => {
    const { graph, companyId } = setupGraph();

    const companyRefA = graph.record.ref(companyId);
    const companyRefB = graph.record.ref(companyId);
    const addressRef: FieldGroupRef<typeof testNamespace.record.fields.contact, typeof testDefs> =
      companyRefA.fields.contact;

    expect(addressRef).toBe(companyRefB.fields.contact);
    expect(companyRefA.fields.contact.email).toBe(companyRefB.fields.contact.email);
    expect(isFieldGroupRef(addressRef)).toBe(true);
    expect(fieldGroupFieldTree(addressRef)).toBe(testNamespace.record.fields.contact);
    expect(fieldGroupKey(addressRef)).toBe("kitchen:record:contact");
    expect(fieldGroupId(addressRef)).toBe(fieldTreeId(testNamespace.record.fields.contact));
    expect(fieldGroupPath(addressRef)).toEqual(["contact"]);
    expect(fieldGroupSubjectId(addressRef)).toBe(companyId);
    expect("get" in (addressRef as Record<string, unknown>)).toBe(false);
    expect("subscribe" in (addressRef as Record<string, unknown>)).toBe(false);
  });

  it("preserves decoded value and cardinality typing through predicate refs", () => {
    const { graph, companyId, tagIds } = setupGraph();

    const companyRef: EntityRef<typeof testNamespace.record, typeof testDefs> =
      graph.record.ref(companyId);
    const nameRef: PredicateRef<typeof testNamespace.record.fields.name, typeof testDefs> =
      companyRef.fields.name;
    const addressRef: FieldGroupRef<typeof testNamespace.record.fields.contact, typeof testDefs> =
      companyRef.fields.contact;
    const localityRef: PredicateRef<
      typeof testNamespace.record.fields.contact.email,
      typeof testDefs
    > = addressRef.email;
    const name: string = nameRef.get();
    const estimate: number | undefined = companyRef.fields.estimate.get();
    const tags: string[] = companyRef.fields.tags.get();
    const website: URL | undefined = companyRef.fields.website.get();
    const status: string = companyRef.fields.status.get();
    const email: string | undefined = localityRef.get();
    const supportWebsite: URL | undefined = addressRef.website.get();

    expect(name).toBe("Acme");
    expect(estimate).toBeUndefined();
    expect(tags).toEqual([tagIds.enterpriseTagId, tagIds.saasTagId]);
    expect(website?.toString()).toBe("https://acme.com/");
    expect(status).toBe(testNamespace.status.values.draft.id);
    expect(email).toBe("team@acme.com");
    expect(supportWebsite?.toString()).toBe("https://support.acme.com/");
  });

  it("addresses entity-reference leaves as typed predicate refs", () => {
    const { graph, companyId } = setupGraph();
    const reviewerId = graph.person.create({
      name: "Alice",
      email: "alice@example.com",
      status: testNamespace.status.values.inReview.id,
    });
    const secondReviewerId = graph.person.create({
      name: "Bob",
      email: "bob@example.com",
      status: testNamespace.status.values.approved.id,
    });
    graph.record.update(companyId, { reviewers: [reviewerId] });

    const personRef = graph.record.ref(companyId);
    const worksAtRef: PredicateRef<typeof testNamespace.record.fields.reviewers, typeof testDefs> =
      personRef.fields.reviewers;
    const reviewers: string[] = worksAtRef.get();
    const reviewerRef = worksAtRef.resolveEntity(reviewerId);

    expect(worksAtRef.subjectId).toBe(companyId);
    expect(worksAtRef.predicateId).toBe(edgeId(testNamespace.record.fields.reviewers));
    expect(reviewers).toEqual([reviewerId]);
    expect(reviewerRef).toBe(graph.person.ref(reviewerId));
    expect(reviewerRef?.fields.name.get()).toBe("Alice");
    expect(worksAtRef.listEntities().map((entity) => entity.id)).toEqual([
      reviewerId,
      secondReviewerId,
    ]);
  });

  it("supports cardinality-aware predicate mutation helpers", () => {
    const { graph, companyId, tagIds } = setupGraph();
    const companyRef = graph.record.ref(companyId);

    companyRef.fields.name.set("Acme 2");
    expect(companyRef.fields.name.get()).toBe("Acme 2");

    companyRef.fields.estimate.set(1_200_000);
    expect(companyRef.fields.estimate.get()).toBe(1_200_000);
    companyRef.fields.estimate.clear();
    expect(companyRef.fields.estimate.get()).toBeUndefined();

    expect(companyRef.fields.tags.collection.kind).toBe("unordered");

    companyRef.fields.tags.add(tagIds.aiTagId);
    expect(companyRef.fields.tags.get()).toEqual([
      tagIds.enterpriseTagId,
      tagIds.saasTagId,
      tagIds.aiTagId,
    ]);

    companyRef.fields.tags.remove(tagIds.saasTagId);
    expect(companyRef.fields.tags.get()).toEqual([tagIds.enterpriseTagId, tagIds.aiTagId]);

    companyRef.fields.tags.replace([tagIds.platformTagId, tagIds.b2bTagId]);
    expect(companyRef.fields.tags.get()).toEqual([tagIds.platformTagId, tagIds.b2bTagId]);

    companyRef.fields.tags.clear();
    expect(companyRef.fields.tags.get()).toEqual([]);
  });

  it("treats unordered many fields as unordered collections", () => {
    const { graph, companyId, tagIds } = setupGraph();
    const companyRef = graph.record.ref(companyId);
    const updatedAtBefore = companyRef.fields.updatedAt.get();
    let notifications = 0;

    expect(companyRef.fields.tags.collection.kind).toBe("unordered");

    companyRef.fields.tags.subscribe(() => {
      notifications += 1;
    });

    companyRef.fields.tags.replace([
      tagIds.saasTagId,
      tagIds.enterpriseTagId,
      tagIds.enterpriseTagId,
    ]);
    expect(companyRef.fields.tags.get()).toEqual([tagIds.enterpriseTagId, tagIds.saasTagId]);
    expect(notifications).toBe(0);
    expect(companyRef.fields.updatedAt.get()?.getTime()).toBe(updatedAtBefore?.getTime());

    companyRef.fields.tags.add(tagIds.enterpriseTagId);
    expect(companyRef.fields.tags.get()).toEqual([tagIds.enterpriseTagId, tagIds.saasTagId]);
    expect(notifications).toBe(0);

    companyRef.fields.tags.add(tagIds.aiTagId);
    expect(companyRef.fields.tags.get()).toEqual([
      tagIds.enterpriseTagId,
      tagIds.saasTagId,
      tagIds.aiTagId,
    ]);
    expect(notifications).toBe(1);

    companyRef.fields.tags.remove(tagIds.saasTagId);
    expect(companyRef.fields.tags.get()).toEqual([tagIds.enterpriseTagId, tagIds.aiTagId]);
    expect(notifications).toBe(2);
  });

  it("runs lifecycle-managed updates when mutating through predicate refs", async () => {
    const { graph, companyId } = setupGraph();
    const companyRef = graph.record.ref(companyId);
    const before = companyRef.fields.updatedAt.get()!;
    let updatedAtNotifications = 0;

    const unsubscribe = companyRef.fields.updatedAt.subscribe(() => {
      updatedAtNotifications += 1;
    });

    await Bun.sleep(5);
    companyRef.fields.name.set("Acme 2");

    expect(companyRef.fields.updatedAt.get()!.getTime()).toBeGreaterThan(before.getTime());
    expect(updatedAtNotifications).toBe(1);

    unsubscribe();
  });

  it("flushes predicate notifications after the outer batch commits", () => {
    const { graph, companyId } = setupGraph();
    const companyRef = graph.record.ref(companyId);
    let nameNotifications = 0;
    let websiteNotifications = 0;

    companyRef.fields.name.subscribe(() => {
      nameNotifications += 1;
    });
    companyRef.fields.website.subscribe(() => {
      websiteNotifications += 1;
    });

    companyRef.fields.name.batch(() => {
      companyRef.fields.name.set("Acme 2");
      companyRef.fields.website.set(new URL("https://acme-2.com"));
      companyRef.fields.name.set("Acme 3");

      expect(nameNotifications).toBe(0);
      expect(websiteNotifications).toBe(0);
    });

    expect(nameNotifications).toBe(1);
    expect(websiteNotifications).toBe(1);
    expect(companyRef.fields.name.get()).toBe("Acme 3");
    expect(companyRef.fields.website.get()?.toString()).toBe("https://acme-2.com/");
  });

  it("subscribes through predicate refs without whole-entity notifications", () => {
    const { graph, companyId } = setupGraph();
    const companyRef = graph.record.ref(companyId);
    let notifications = 0;

    const unsubscribe = companyRef.fields.name.subscribe(() => {
      notifications += 1;
    });

    companyRef.update({ website: new URL("https://acme-2.com") });
    expect(notifications).toBe(0);

    companyRef.update({ name: "Acme 2" });
    expect(notifications).toBe(1);
    expect(companyRef.fields.name.get()).toBe("Acme 2");

    unsubscribe();
    companyRef.update({ name: "Acme 3" });
    expect(notifications).toBe(1);
  });

  it("keeps nested leaf refs predicate-local inside field groups", () => {
    const { graph, companyId } = setupGraph();
    const companyRef = graph.record.ref(companyId);
    let emailNotifications = 0;
    let websiteNotifications = 0;

    companyRef.fields.contact.email.subscribe(() => {
      emailNotifications += 1;
    });
    companyRef.fields.contact.website.subscribe(() => {
      websiteNotifications += 1;
    });

    companyRef.update({
      contact: {
        email: "support@example.com",
      },
    });

    expect(emailNotifications).toBe(1);
    expect(websiteNotifications).toBe(0);

    companyRef.fields.contact.website.set(new URL("https://docs.example.com"));

    expect(emailNotifications).toBe(1);
    expect(websiteNotifications).toBe(1);
    expect(companyRef.fields.contact.email.get()).toBe("support@example.com");
    expect(companyRef.fields.contact.website.get()?.toString()).toBe("https://docs.example.com/");
  });
});
