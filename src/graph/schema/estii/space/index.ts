import { defineType } from "@io/core/graph/def";

import { core } from "../../core.js";
import { booleanTypeModule } from "../../core/boolean/index.js";
import { currencyTypeModule } from "../../core/currency/index.js";
import { jsonTypeModule } from "../../core/json/index.js";
import { numberTypeModule } from "../../core/number/index.js";
import { stringTypeModule } from "../../core/string/index.js";
import { estiiReferenceField } from "../reference-field.js";

export const space = defineType({
  values: { key: "estii:space", name: "Space" },
  fields: {
    ...core.node.fields,
    currency: currencyTypeModule.field({
      cardinality: "one",
      meta: { label: "Currency" },
      filter: {
        operators: ["is"] as const,
        defaultOperator: "is",
      },
    }),
    rounding: numberTypeModule.field({
      cardinality: "one",
      meta: { label: "Rounding" },
    }),
    workUnit: stringTypeModule.field({
      cardinality: "one",
      meta: { label: "Work unit" },
    }),
    contingencyNone: numberTypeModule.field({
      cardinality: "one",
      meta: { label: "No-risk contingency" },
    }),
    contingencyLow: numberTypeModule.field({
      cardinality: "one",
      meta: { label: "Low-risk contingency" },
    }),
    contingencyNormal: numberTypeModule.field({
      cardinality: "one",
      meta: { label: "Normal-risk contingency" },
    }),
    contingencyHigh: numberTypeModule.field({
      cardinality: "one",
      meta: { label: "High-risk contingency" },
    }),
    onboarded: booleanTypeModule.field({
      cardinality: "one",
      meta: { label: "Onboarded" },
      filter: {
        operators: ["is"] as const,
        defaultOperator: "is",
      },
    }),
    workHoursPerDay: numberTypeModule.field({
      cardinality: "one",
      meta: { label: "Work hours per day" },
    }),
    workDaysPerWeek: numberTypeModule.field({
      cardinality: "one",
      meta: { label: "Work days per week" },
    }),
    workWeeksPerYear: numberTypeModule.field({
      cardinality: "one",
      meta: { label: "Work weeks per year" },
    }),
    probabilityDraft: numberTypeModule.field({
      cardinality: "one?",
      meta: { label: "Draft probability" },
    }),
    probabilityApproved: numberTypeModule.field({
      cardinality: "one?",
      meta: { label: "Approved probability" },
    }),
    probabilityProgressed: numberTypeModule.field({
      cardinality: "one?",
      meta: { label: "Progressed probability" },
    }),
    probabilityOptions: jsonTypeModule.field({
      cardinality: "one",
      meta: { label: "Probability options" },
    }),
    flags: jsonTypeModule.field({
      cardinality: "one",
      meta: { label: "Flags" },
    }),
    terminology: jsonTypeModule.field({
      cardinality: "one",
      meta: { label: "Terminology" },
    }),
    tags: estiiReferenceField(core.tag, {
      cardinality: "many",
      collection: "ordered",
      create: true,
      editorKind: "entity-reference-combobox",
      label: "Tags",
    }),
    accounts: estiiReferenceField("estii:account", {
      cardinality: "many",
      collection: "ordered",
      label: "Accounts",
    }),
    themes: estiiReferenceField("estii:theme", {
      cardinality: "many",
      collection: "ordered",
      label: "Themes",
    }),
    cards: estiiReferenceField("estii:card", {
      cardinality: "many",
      collection: "ordered",
      label: "Cards",
    }),
    resources: estiiReferenceField("estii:resource", {
      cardinality: "many",
      collection: "ordered",
      label: "Resources",
    }),
    resourceTags: estiiReferenceField("estii:resourceTag", {
      cardinality: "many",
      collection: "ordered",
      label: "Resource tags",
    }),
    people: estiiReferenceField("estii:person", {
      cardinality: "many",
      collection: "ordered",
      label: "People",
    }),
    deals: estiiReferenceField("estii:deal", {
      cardinality: "many",
      collection: "ordered",
      label: "Deals",
    }),
  },
});
