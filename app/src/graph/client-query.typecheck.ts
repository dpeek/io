import { app } from "./app";
import { bootstrap } from "./bootstrap";
import { createTypeClient } from "./client";
import { core } from "./core";
import { createStore } from "./store";

const store = createStore();
bootstrap(store, core);
bootstrap(store, app);

const graph = createTypeClient(store, app);

void graph.company
  .query({
    where: { id: "company-1" },
    select: {
      id: true,
      name: true,
      foundedYear: true,
      address: {
        locality: true,
      },
    },
  })
  .then((company) => {
    if (!company) return;

    const id: string = company.id;
    const name: string = company.name;
    const foundedYear: number | undefined = company.foundedYear;
    const locality: string | undefined = company.address.locality;

    void id;
    void name;
    void foundedYear;
    void locality;

    // @ts-expect-error unselected fields do not appear in the query result
    void company.website;
  });

void graph.person
  .query({
    where: { id: "person-1" },
    select: {
      worksAt: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  })
  .then((person) => {
    if (!person) return;

    const employerId: string = person.worksAt[0]!.id;
    const employerName: string = person.worksAt[0]!.name;

    void employerId;
    void employerName;

    // @ts-expect-error nested entity selection does not return raw string ids
    const invalidEmployerId: string = person.worksAt[0];
    void invalidEmployerId;
  });

void graph.person
  .query({
    where: { id: "person-1" },
    select: {
      worksAt: true,
    },
  })
  .then((person) => {
    if (!person) return;

    const employerIds: string[] = person.worksAt;
    void employerIds;

    // @ts-expect-error raw id selection does not expose nested fields
    void person.worksAt[0].name;
  });

void graph.block
  .query({
    where: { id: "block-1" },
    select: {
      parent: {
        select: {
          id: true,
          text: true,
        },
      },
    },
  })
  .then((block) => {
    if (!block?.parent) return;

    const parentId: string = block.parent.id;
    const parentText: string = block.parent.text;

    void parentId;
    void parentText;
  });

void graph.company.query({
  where: { id: "company-1" },
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

void graph.company.query({
  where: { id: "company-1" },
  select: {
    name: true,
    // @ts-expect-error field groups require a nested selection object
    address: true,
  },
});

void graph.company.query({
  select: {
    name: true,
  },
}).then((companies) => {
  const name: string = companies[0]!.name;
  void name;

  // @ts-expect-error list queries still omit unselected fields
  void companies[0]!.id;
});
