import ids from "./app.json";
import { core } from "./core";
import { defineEnum, defineNamespace, defineType, rangeOf } from "./schema.js";

const status = defineEnum({
  values: { key: "app:status", name: "Status" },
  options: {
    active: {
      name: "Active",
      description: "Entity is active",
    },
    paused: {
      name: "Paused",
      description: "Temporarily inactive",
    },
  },
});

const company = defineType({
  values: { key: "app:company", name: "Company" },
  fields: {
    ...core.node.fields,
    status: { range: rangeOf(status), cardinality: "one" },
    foundedYear: { range: rangeOf(core.number), cardinality: "one?" },
    tags: { range: rangeOf(core.string), cardinality: "many" },
    website: { range: rangeOf(core.url), cardinality: "one" },
  },
});

const person = defineType({
  values: { key: "app:person", name: "Person" },
  fields: {
    ...core.node.fields,
    worksAt: { range: rangeOf(company), cardinality: "many" },
  },
});

const block = defineType({
  values: { key: "app:block", name: "Outline Node" },
  fields: {
    ...core.node.fields,
    text: { range: rangeOf(core.string), cardinality: "one" },
    parent: { range: "app:block", cardinality: "one?" },
    order: { range: rangeOf(core.number), cardinality: "one" },
    collapsed: { range: rangeOf(core.boolean), cardinality: "one?" },
  },
});

export const app = defineNamespace(ids, { company, person, status, block });
