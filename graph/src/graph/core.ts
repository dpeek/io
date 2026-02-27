import coreIdMap from "./core.json";
import { defineEnum, defineNamespace, defineScalar, defineType, rangeOf } from "./schema.js";

const string = defineScalar({
  values: { key: "core:string", name: "String" },
  encode: (value: string) => value,
  decode: (string) => string,
});

const number = defineScalar({
  values: { key: "core:number", name: "Number" },
  encode: (value: number) => String(value),
  decode: (string) => Number(string),
});

const date = defineScalar({
  values: { key: "core:date", name: "Date" },
  encode: (value: Date) => value.toISOString(),
  decode: (string) => new Date(string),
});

const boolean = defineScalar({
  values: { key: "core:boolean", name: "Boolean" },
  encode: (value: boolean) => String(value),
  decode: (string) => string === "true",
});

const url = defineScalar({
  values: { key: "core:url", name: "URL" },
  encode: (value: URL) => value.toString(),
  decode: (string) => new URL(string),
});

const node = defineType({
  values: { key: "core:node", name: "Node" },
  fields: {
    type: { range: "core:type", cardinality: "many" },
    name: { range: string.values.key, cardinality: "one" },
    label: { range: string.values.key, cardinality: "one?" },
    description: { range: string.values.key, cardinality: "one?" },
    createdAt: {
      range: date.values.key,
      cardinality: "one?",
      onCreate: ({ incoming, now }) => incoming ?? now,
    },
    updatedAt: {
      range: date.values.key,
      cardinality: "one?",
      onCreate: ({ now }) => now,
      onUpdate: ({ now, changedPredicateKeys }) =>
        [...changedPredicateKeys].some(
          (key) => !key.endsWith(":createdAt") && !key.endsWith(":updatedAt"),
        )
          ? now
          : undefined,
    },
  },
});

const type = defineType({
  values: { key: "core:type", name: "Type" },
  fields: {
    ...node.fields,
  },
});

const cardinality = defineEnum({
  values: { key: "core:cardinality", name: "Cardinality" },
  options: {
    one: {
      name: "Exactly one",
      description: "Predicate must have exactly one value",
    },
    oneOptional: {
      name: "Zero or one",
      description: "Predicate may have zero or one value",
    },
    many: {
      name: "Many",
      description: "Predicate may have multiple values",
    },
  },
});

const predicate = defineType({
  values: { key: "core:predicate", name: "Predicate" },
  fields: {
    ...node.fields,
    key: { range: string.values.key, cardinality: "one" },
    range: { range: type.values.key, cardinality: "one?" },
    cardinality: { range: rangeOf(cardinality), cardinality: "one" },
  },
});

const _enum = defineType({
  values: { key: "core:enum", name: "Enum" },
  fields: {
    ...node.fields,
    member: { range: type.values.key, cardinality: "many" },
  },
});

export const core = defineNamespace(coreIdMap, {
  string,
  number,
  date,
  boolean,
  url,
  type,
  cardinality,
  predicate,
  enum: _enum,
  node,
});
