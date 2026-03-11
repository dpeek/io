import { defineType } from "../../graph/schema.js";
import { countryTypeModule } from "../country";
import { stringTypeModule } from "../string";

export const addressFields = {
  recipient: stringTypeModule.field({
    cardinality: "one?",
    meta: {
      label: "Recipient",
    },
  }),
  organization: stringTypeModule.field({
    cardinality: "one?",
    meta: {
      label: "Organization",
    },
  }),
  address_line1: stringTypeModule.field({
    cardinality: "one?",
    meta: {
      label: "Address line 1",
    },
  }),
  address_line2: stringTypeModule.field({
    cardinality: "one?",
    meta: {
      label: "Address line 2",
    },
  }),
  locality: stringTypeModule.field({
    cardinality: "one?",
    meta: {
      label: "Locality",
    },
  }),
  dependent_locality: stringTypeModule.field({
    cardinality: "one?",
    meta: {
      label: "Dependent locality",
    },
  }),
  administrative_area: stringTypeModule.field({
    cardinality: "one?",
    meta: {
      label: "Administrative area",
    },
  }),
  postal_code: stringTypeModule.field({
    cardinality: "one?",
    meta: {
      label: "Postal code",
    },
  }),
};

export const address = defineType({
  values: { key: "core:address", name: "Address" },
  fields: {
    ...addressFields,
    address_line1: stringTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Address line 1",
      },
    }),
    country: countryTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Country",
      },
    }),
  },
});
