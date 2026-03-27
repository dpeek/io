import { describe, expect, it } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { createTestGraph, testNamespace } from "../../../src/graph/test-graph.js";
import { EntityPredicates, PredicateRelatedEntities } from "./index.js";

function setupGraph() {
  const { coreGraph, graph } = createTestGraph();

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
  const ownerId = graph.person.create({
    name: "Carol",
    email: "carol@example.com",
    status: testNamespace.status.values.draft.id,
  });

  const recordId = graph.record.create({
    name: "Acme",
    headline: "KS-1",
    owner: ownerId,
    reviewers: [reviewerId, secondReviewerId],
    score: 12,
    status: testNamespace.status.values.draft.id,
    tags: [enterpriseTagId, saasTagId],
  });

  return {
    ownerId,
    recordRef: graph.record.ref(recordId),
    reviewerIds: [reviewerId, secondReviewerId],
  };
}

function collectDataAttributes(markup: string, name: string): string[] {
  return [...markup.matchAll(new RegExp(`${name}="([^"]+)"`, "g"))].map((match) => match[1]!);
}

describe("entity traversal helpers", () => {
  it("renders one child per predicate in authored field order, including nested field groups", () => {
    const { recordRef } = setupGraph();

    const markup = renderToStaticMarkup(
      <ul>
        <EntityPredicates entity={recordRef}>
          {(entry) => <li data-path={entry.pathLabel} />}
        </EntityPredicates>
      </ul>,
    );

    expect(collectDataAttributes(markup, "data-path")).toEqual([
      "type",
      "name",
      "description",
      "createdAt",
      "updatedAt",
      "slug",
      "headline",
      "status",
      "statusHistory",
      "severity",
      "score",
      "completion",
      "duration",
      "quantity",
      "budget",
      "burnRate",
      "completionBand",
      "quantityBand",
      "estimate",
      "archived",
      "published",
      "website",
      "contactEmail",
      "details",
      "budgetBand",
      "accentColor",
      "externalId",
      "syncedAt",
      "owner",
      "reviewers",
      "tags",
      "secret",
      "parent",
      "relatedRecords",
      "review.reviewer",
      "review.approvedAt",
      "review.notes",
      "contact.website",
      "contact.email",
    ]);
  });

  it("renders the currently selected related entities for entity-range predicates", () => {
    const { ownerId, recordRef, reviewerIds } = setupGraph();

    const reviewersMarkup = renderToStaticMarkup(
      <ul>
        <PredicateRelatedEntities predicate={recordRef.fields.reviewers}>
          {({ entity, id }) => <li data-related={id}>{entity.fields.name.get()}</li>}
        </PredicateRelatedEntities>
      </ul>,
    );
    const ownerMarkup = renderToStaticMarkup(
      <ul>
        <PredicateRelatedEntities predicate={recordRef.fields.owner}>
          {({ entity, id }) => <li data-related={id}>{entity.fields.name.get()}</li>}
        </PredicateRelatedEntities>
      </ul>,
    );

    expect(collectDataAttributes(reviewersMarkup, "data-related")).toEqual(reviewerIds);
    expect(reviewersMarkup).toContain("Alice");
    expect(reviewersMarkup).toContain("Bob");
    expect(collectDataAttributes(ownerMarkup, "data-related")).toEqual([ownerId]);
    expect(ownerMarkup).toContain("Carol");
  });
});
