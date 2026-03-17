import { defineType } from "@io/core/graph/def";

import { core } from "../../core.js";
import { booleanTypeModule } from "../../core/boolean/index.js";
import { colorTypeModule } from "../../core/color/index.js";
import { currencyTypeModule } from "../../core/currency/index.js";
import { dateTypeModule } from "../../core/date/index.js";
import { jsonTypeModule } from "../../core/json/index.js";
import { numberTypeModule } from "../../core/number/index.js";
import { stringTypeModule } from "../../core/string/index.js";
import {
  breakdownTypeTypeModule,
  dealStatusTypeModule,
  milestoneDateRoundingTypeModule,
  milestoneKindTypeModule,
} from "../enums.js";
import { estiiReferenceField } from "../reference-field.js";

export const deal = defineType({
  values: { key: "estii:deal", name: "Deal" },
  fields: {
    ...core.node.fields,
    order: numberTypeModule.field({
      cardinality: "one",
      meta: { label: "Order" },
    }),
    account: estiiReferenceField("estii:account", {
      cardinality: "one?",
      label: "Account",
    }),
    avatar: stringTypeModule.field({
      cardinality: "one?",
      meta: { label: "Avatar" },
    }),
    avatarColor: colorTypeModule.field({
      cardinality: "one",
      meta: { label: "Avatar color" },
    }),
    avatarIcon: stringTypeModule.field({
      cardinality: "one",
      meta: { label: "Avatar icon" },
    }),
    cost: numberTypeModule.field({
      cardinality: "one",
      meta: { label: "Cost" },
    }),
    price: numberTypeModule.field({
      cardinality: "one",
      meta: { label: "Price" },
    }),
    margin: numberTypeModule.field({
      cardinality: "one",
      meta: { label: "Margin" },
    }),
    roles: numberTypeModule.field({
      cardinality: "one",
      meta: { label: "Roles" },
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
    workUnit: stringTypeModule.field({
      cardinality: "one",
      meta: { label: "Work unit" },
    }),
    spaceCurrency: currencyTypeModule.field({
      cardinality: "one",
      meta: { label: "Space currency" },
      filter: {
        operators: ["is"] as const,
        defaultOperator: "is",
      },
    }),
    currency: currencyTypeModule.field({
      cardinality: "one",
      meta: { label: "Currency" },
      filter: {
        operators: ["is"] as const,
        defaultOperator: "is",
      },
    }),
    exchangeRates: jsonTypeModule.field({
      cardinality: "one",
      meta: { label: "Exchange rates" },
    }),
    rounding: numberTypeModule.field({
      cardinality: "one",
      meta: { label: "Rounding" },
    }),
    card: estiiReferenceField("estii:card", {
      cardinality: "one",
      label: "Rate card",
    }),
    targetMargin: numberTypeModule.field({
      cardinality: "one",
      meta: { label: "Target margin" },
    }),
    targetPrice: numberTypeModule.field({
      cardinality: "one",
      meta: { label: "Target price" },
    }),
    dueAt: dateTypeModule.field({
      cardinality: "one?",
      meta: { label: "Due at" },
    }),
    startAt: dateTypeModule.field({
      cardinality: "one?",
      meta: { label: "Start at" },
    }),
    endAt: dateTypeModule.field({
      cardinality: "one?",
      meta: { label: "End at" },
    }),
    status: dealStatusTypeModule.field({
      cardinality: "one",
      meta: { label: "Status" },
      filter: {
        operators: ["is"] as const,
        defaultOperator: "is",
      },
    }),
    probability: numberTypeModule.field({
      cardinality: "one",
      meta: { label: "Probability" },
    }),
    approvedAt: dateTypeModule.field({
      cardinality: "one?",
      meta: { label: "Approved at" },
    }),
    progressedAt: dateTypeModule.field({
      cardinality: "one?",
      meta: { label: "Progressed at" },
    }),
    closedAt: dateTypeModule.field({
      cardinality: "one?",
      meta: { label: "Closed at" },
    }),
    closedReason: stringTypeModule.field({
      cardinality: "one?",
      meta: { label: "Closed reason" },
    }),
    archivedAt: dateTypeModule.field({
      cardinality: "one?",
      meta: { label: "Archived at" },
    }),
    theme: estiiReferenceField("estii:theme", {
      cardinality: "one?",
      label: "Theme",
    }),
    deckParams: jsonTypeModule.field({
      cardinality: "one",
      meta: { label: "Deck params" },
    }),
    cloneOf: estiiReferenceField("estii:deal", {
      cardinality: "one?",
      label: "Clone of",
    }),
    lastUpdatedAt: dateTypeModule.field({
      cardinality: "one?",
      meta: { label: "Last updated at" },
    }),
    template: booleanTypeModule.field({
      cardinality: "one",
      meta: { label: "Template" },
      filter: {
        operators: ["is"] as const,
        defaultOperator: "is",
      },
    }),
    owner: estiiReferenceField("estii:person", {
      cardinality: "one?",
      label: "Owner",
    }),
    milestoneKind: milestoneKindTypeModule.field({
      cardinality: "one",
      meta: { label: "Milestone kind" },
      filter: {
        operators: ["is"] as const,
        defaultOperator: "is",
      },
    }),
    milestoneDateRounding: milestoneDateRoundingTypeModule.field({
      cardinality: "one",
      meta: { label: "Milestone date rounding" },
      filter: {
        operators: ["is"] as const,
        defaultOperator: "is",
      },
    }),
    milestonePriceRounding: numberTypeModule.field({
      cardinality: "one",
      meta: { label: "Milestone price rounding" },
    }),
    milestoneTerms: stringTypeModule.field({
      cardinality: "one",
      meta: { label: "Milestone terms" },
    }),
    breakdowns: breakdownTypeTypeModule.field({
      cardinality: "many",
      meta: {
        label: "Breakdowns",
        collection: {
          kind: "ordered",
        },
      },
      filter: {
        operators: ["is", "oneOf"] as const,
        defaultOperator: "oneOf",
      },
    }),
    terminology: jsonTypeModule.field({
      cardinality: "one",
      meta: { label: "Terminology" },
    }),
    resourceTags: estiiReferenceField("estii:resourceTag", {
      cardinality: "many",
      collection: "unordered",
      label: "Resource tags",
    }),
    phases: estiiReferenceField("estii:phase", {
      cardinality: "many",
      collection: "ordered",
      label: "Phases",
    }),
    variables: estiiReferenceField("estii:variable", {
      cardinality: "many",
      collection: "ordered",
      label: "Variables",
    }),
    milestones: estiiReferenceField("estii:milestone", {
      cardinality: "many",
      collection: "ordered",
      label: "Milestones",
    }),
  },
});
