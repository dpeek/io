import { defineType } from "@io/graph-module";

import { defineCoreIconSeed } from "../icon/seed.js";
import { colorType, colorTypeModule } from "./color.js";
import { node } from "./node.js";
import { slugTypeModule } from "./slug.js";
import { stringTypeModule } from "./string.js";

const tagIconSeed = defineCoreIconSeed("tag", {
  name: "Tag",
  svg: `<svg viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" fill="none" width="24" height="24" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 0.586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
  <circle fill="currentColor" cx="7.5" cy="7.5" r="0.5" />
</svg>`,
});

export const tag = defineType({
  values: { key: "core:tag", name: "Tag", icon: tagIconSeed },
  fields: {
    ...node.fields,
    key: slugTypeModule.field({
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
    color: colorTypeModule.field({
      cardinality: "one",
      icon: colorType.values.icon,
      meta: {
        label: "Color",
      },
    }),
  },
});
