import { defineType } from "@io/graph-module";
import { defineReferenceField } from "@io/graph-module";

import { defineCoreIconSeed } from "../icon/seed.js";
import { node } from "./node.js";
import { coreType } from "./type.js";

const enumIconSeed = defineCoreIconSeed("enum", {
  name: "Enum",
  svg: `<svg viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" fill="none" width="24" height="24" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <rect width="7" height="7" rx="1" x="3" y="3" />
  <rect width="7" height="7" rx="1" x="3" y="14" />
  <path d="M14 4h7" />
  <path d="M14 9h7" />
  <path d="M14 15h7" />
  <path d="M14 20h7" />
</svg>`,
});

export const enumType = defineType({
  values: { key: "core:enum", name: "Enum", icon: enumIconSeed },
  fields: {
    ...node.fields,
    member: defineReferenceField({
      range: coreType.values.key,
      cardinality: "many",
    }),
  },
});
