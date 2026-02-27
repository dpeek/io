import { core, defineType, rangeOf } from "@io/graph";
import { country } from "./country";

export const address = defineType({
  values: { key: "core:address", name: "Address" },
  fields: {
    recipient: { range: rangeOf(core.string), cardinality: "one?" },
    organization: { range: rangeOf(core.string), cardinality: "one?" },
    address_line1: { range: rangeOf(core.string), cardinality: "one" },
    address_line2: { range: rangeOf(core.string), cardinality: "one?" },
    locality: { range: rangeOf(core.string), cardinality: "one?" },
    dependent_locality: { range: rangeOf(core.string), cardinality: "one?" },
    administrative_area: { range: rangeOf(core.string), cardinality: "one?" },
    postal_code: { range: rangeOf(core.string), cardinality: "one?" },
    country: { range: rangeOf(country), cardinality: "one" },
  },
});
