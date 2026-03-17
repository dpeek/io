import { bootstrap, createStore, createTypeClient, core } from "@io/core/graph";

import { testNamespace } from "./test-graph.js";

const store = createStore();
bootstrap(store, core);
bootstrap(store, testNamespace);

const graph = createTypeClient(store, testNamespace);
const coreGraph = createTypeClient(store, core);

void graph.record
  .query({
    where: { id: "record-1" },
    select: {
      id: true,
      name: true,
      estimate: true,
      contact: {
        email: true,
      },
    },
  })
  .then((record) => {
    if (!record) return;

    const id: string = record.id;
    const name: string = record.name;
    const estimate: number | undefined = record.estimate;
    const email: string | undefined = record.contact.email;

    void id;
    void name;
    void estimate;
    void email;

    // @ts-expect-error unselected fields do not appear in the query result
    void record.website;
  });

void graph.record
  .query({
    where: { id: "record-1" },
    select: {
      createdAt: true,
      updatedAt: true,
    },
  })
  .then((record) => {
    if (!record) return;

    const createdAt: Date = record.createdAt;
    const updatedAt: Date = record.updatedAt;

    void createdAt;
    void updatedAt;
  });

void coreGraph.icon
  .query({
    where: { id: "seed:icon:string" },
    select: {
      createdAt: true,
      updatedAt: true,
    },
  })
  .then((icon) => {
    if (!icon) return;

    const createdAt: Date = icon.createdAt;
    const updatedAt: Date = icon.updatedAt;

    void createdAt;
    void updatedAt;
  });

void graph.record
  .query({
    where: { id: "record-1" },
    select: {
      reviewers: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  })
  .then((record) => {
    if (!record) return;

    const reviewerId: string = record.reviewers[0]!.id;
    const reviewerName: string = record.reviewers[0]!.name;

    void reviewerId;
    void reviewerName;

    // @ts-expect-error nested entity selection does not return raw string ids
    const invalidReviewerId: string = record.reviewers[0];
    void invalidReviewerId;
  });

void graph.record
  .query({
    where: { id: "record-1" },
    select: {
      reviewers: true,
    },
  })
  .then((record) => {
    if (!record) return;

    const reviewerIds: string[] = record.reviewers;
    void reviewerIds;

    // @ts-expect-error raw id selection does not expose nested fields
    void record.reviewers[0].name;
  });

void graph.record
  .query({
    where: { id: "record-1" },
    select: {
      parent: {
        select: {
          id: true,
          headline: true,
        },
      },
    },
  })
  .then((record) => {
    if (!record?.parent) return;

    const parentId: string = record.parent.id;
    const parentHeadline: string = record.parent.headline;

    void parentId;
    void parentHeadline;
  });

void graph.record.query({
  where: { id: "record-1" },
  select: {
    name: true,
    // @ts-expect-error scalar fields only allow `true`
    website: {
      select: {
        id: true,
      },
    },
  },
});

void graph.record.query({
  where: { id: "record-1" },
  select: {
    name: true,
    // @ts-expect-error field groups require a nested selection object
    contact: true,
  },
});

void graph.record
  .query({
    select: {
      name: true,
    },
  })
  .then((records) => {
    const name: string = records[0]!.name;
    void name;

    // @ts-expect-error list queries still omit unselected fields
    void records[0]!.id;
  });
