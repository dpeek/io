import { defineType } from "@io/graph-module";
import { defineReferenceField } from "@io/graph-module";

import { defineCoreIconSeed } from "../icon/seed.js";
import { cardinalityTypeModule } from "./cardinality.js";
import { iconReferenceField } from "./icon.js";
import { node } from "./node.js";
import { stringTypeModule } from "./string.js";
import { coreType } from "./type.js";

const edgeIconSeed = defineCoreIconSeed("edge", {
  name: "Edge",
  svg: `<svg viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" fill="none" width="24" height="24" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <rect width="6" height="6" rx="1" x="16" y="16" />
  <rect width="6" height="6" rx="1" x="2" y="16" />
  <rect width="6" height="6" rx="1" x="9" y="2" />
  <path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3" />
  <path d="M12 12V8" />
</svg>`,
});

export const predicate = defineType({
  values: { key: "core:predicate", name: "Predicate", icon: edgeIconSeed },
  fields: {
    ...node.fields,
    key: stringTypeModule.field({
      cardinality: "one",
      icon: stringTypeModule.type.values.icon,
      meta: {
        label: "Key",
      },
      filter: {
        operators: ["equals", "prefix"] as const,
        defaultOperator: "equals",
      },
    }),
    range: defineReferenceField({
      range: coreType.values.key,
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
    icon: iconReferenceField(),
  },
});
