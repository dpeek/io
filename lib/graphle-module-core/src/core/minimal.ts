import type { GraphBootstrapOptions } from "@dpeek/graphle-bootstrap";
import { defineReferenceField, defineType } from "@dpeek/graphle-module";
import { applyGraphIdMap, type ResolvedGraphNamespace } from "@dpeek/graphle-kernel";

import coreIdMap from "../core.json";
import { booleanTypeModule } from "./boolean.js";
import { cardinality, cardinalityTypeModule } from "./cardinality.js";
import { dateTypeModule } from "./date.js";
import { jsonTypeModule } from "./json.js";
import { markdownTypeModule } from "./markdown.js";
import { node } from "./node.js";
import { numberTypeModule } from "./number.js";
import { slugTypeModule } from "./slug.js";
import { stringTypeModule } from "./string.js";
import { urlTypeModule } from "./url.js";

const string = stringTypeModule.type;

const number = numberTypeModule.type;

const boolean = booleanTypeModule.type;

const date = dateTypeModule.type;

const json = jsonTypeModule.type;

const markdown = markdownTypeModule.type;

const slug = slugTypeModule.type;

const url = urlTypeModule.type;

const minimalType = defineType({
  values: { key: "core:type", name: "Type" },
  fields: {
    ...node.fields,
  },
});

const minimalPredicate = defineType({
  values: { key: "core:predicate", name: "Predicate" },
  fields: {
    ...node.fields,
    key: stringTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Key",
      },
      filter: {
        operators: ["equals", "prefix"] as const,
        defaultOperator: "equals",
      },
    }),
    range: defineReferenceField({
      range: "core:type",
      cardinality: "one?",
    }),
    cardinality: cardinalityTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Cardinality",
      },
      filter: {
        operators: ["is"] as const,
        defaultOperator: "is",
      },
    }),
  },
});

const minimalEnum = defineType({
  values: { key: "core:enum", name: "Enum" },
  fields: {
    ...node.fields,
    member: defineReferenceField({
      range: "core:type",
      cardinality: "many",
    }),
  },
});

type MinimalCoreNamespaceInput = {
  string: typeof string;
  number: typeof number;
  boolean: typeof boolean;
  date: typeof date;
  json: typeof json;
  markdown: typeof markdown;
  slug: typeof slug;
  url: typeof url;
  node: typeof node;
  type: typeof minimalType;
  predicate: typeof minimalPredicate;
  enum: typeof minimalEnum;
  cardinality: typeof cardinality;
};

export type MinimalCoreNamespace = ResolvedGraphNamespace<MinimalCoreNamespaceInput>;

/**
 * Minimal `core:` namespace required by the personal-site MVP boot path.
 *
 * This slice intentionally omits icons, SVG, saved-query/view, workflow,
 * identity, admission, share, capability, secret, and other product records.
 */
export const minimalCore: MinimalCoreNamespace = applyGraphIdMap(coreIdMap, {
  string,
  number,
  boolean,
  date,
  json,
  markdown,
  slug,
  url,
  node,
  type: minimalType,
  predicate: minimalPredicate,
  enum: minimalEnum,
  cardinality,
});

export const minimalCoreGraphBootstrapOptions: GraphBootstrapOptions = Object.freeze({
  availableDefinitions: minimalCore,
  cacheKey: minimalCore,
  coreSchema: minimalCore,
});
