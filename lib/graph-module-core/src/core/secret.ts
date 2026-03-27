import { defineType } from "@io/graph-module";

import { defineCoreIconSeed } from "../icon/seed.js";
import { dateTypeModule } from "./date.js";
import { node } from "./node.js";
import { numberTypeModule } from "./number.js";

const secretHandleMetadataAuthority = {
  visibility: "replicated",
  write: "server-command",
} as const;

const secretIconSeed = defineCoreIconSeed("secret", {
  name: "Secret",
  svg: `<svg viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" fill="none" width="24" height="24" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" />
  <circle cx="10" cy="16" r="2" />
  <path d="M16 10l-4.5 4.5" />
  <path d="M15 11l1 1" />
</svg>`,
});

export const secretHandle = defineType({
  values: { key: "core:secretHandle", name: "Secret Handle", icon: secretIconSeed },
  fields: {
    ...node.fields,
    name: {
      ...node.fields.name,
      authority: secretHandleMetadataAuthority,
    },
    createdAt: {
      ...node.fields.createdAt,
      authority: secretHandleMetadataAuthority,
    },
    updatedAt: {
      ...node.fields.updatedAt,
      authority: secretHandleMetadataAuthority,
    },
    version: numberTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Secret version",
      },
      authority: secretHandleMetadataAuthority,
    }),
    lastRotatedAt: dateTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Last rotated",
      },
      authority: secretHandleMetadataAuthority,
    }),
  },
});
