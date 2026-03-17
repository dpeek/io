import { defineType } from "@io/core/graph/def";

import { core } from "../../core.js";
import { dateTypeModule } from "../../core/date/index.js";
import { jsonTypeModule } from "../../core/json/index.js";
import { numberTypeModule } from "../../core/number/index.js";
import { distributionTypeModule, phaseStartTypeTypeModule } from "../enums.js";
import { estiiReferenceField } from "../reference-field.js";

export const phase = defineType({
  values: { key: "estii:phase", name: "Phase" },
  fields: {
    ...core.node.fields,
    order: numberTypeModule.field({
      cardinality: "one",
      meta: { label: "Order" },
    }),
    exclusions: jsonTypeModule.field({
      cardinality: "one",
      meta: { label: "Exclusions" },
    }),
    card: estiiReferenceField("estii:card", {
      cardinality: "one?",
      label: "Rate card",
    }),
    cardMargin: numberTypeModule.field({
      cardinality: "one?",
      meta: { label: "Card margin" },
    }),
    days: numberTypeModule.field({
      cardinality: "one",
      meta: { label: "Days" },
    }),
    cycle: numberTypeModule.field({
      cardinality: "one",
      meta: { label: "Cycle" },
    }),
    distribution: distributionTypeModule.field({
      cardinality: "one",
      meta: { label: "Distribution" },
      filter: {
        operators: ["is"] as const,
        defaultOperator: "is",
      },
    }),
    startType: phaseStartTypeTypeModule.field({
      cardinality: "one",
      meta: { label: "Start type" },
      filter: {
        operators: ["is"] as const,
        defaultOperator: "is",
      },
    }),
    startDate: dateTypeModule.field({
      cardinality: "one?",
      meta: { label: "Start date" },
    }),
    startPhase: estiiReferenceField("estii:phase", {
      cardinality: "one?",
      label: "Start phase",
    }),
    startOffset: numberTypeModule.field({
      cardinality: "one",
      meta: { label: "Start offset" },
    }),
    features: estiiReferenceField("estii:feature", {
      cardinality: "many",
      collection: "ordered",
      label: "Features",
    }),
  },
});
