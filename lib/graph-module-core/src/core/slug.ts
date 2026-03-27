import type { TypeModuleFilter } from "@io/graph-module";
import { defineValidatedStringTypeModule } from "@io/graph-module";

import { defineCoreIconSeed } from "../icon/seed.js";

const slugLabel = "company-slug";

const slugIconSeed = defineCoreIconSeed("slug", {
  name: "Slug",
  svg: `<svg viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" fill="none" width="24" height="24" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <path d="M22 17v1c0 0.5-0.5 1-1 1H3c-0.5 0-1-0.5-1-1v-1" />
</svg>`,
});

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const slugFragmentPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*-?$/;

function normalizeSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/-+/g, "-");
}

function parseSlug(raw: string): string {
  const value = normalizeSlug(raw);
  if (!slugPattern.test(value)) {
    throw new Error(`Invalid slug value "${raw}"`);
  }
  return value;
}

function parseSlugFragment(raw: string): string {
  const value = normalizeSlug(raw).replace(/^-+/, "");
  if (!slugFragmentPattern.test(value)) {
    throw new Error(`Invalid slug filter value "${raw}"`);
  }
  return value;
}

export const slugFilter = {
  defaultOperator: "prefix",
  operators: {
    equals: {
      label: "Equals",
      operand: {
        kind: "string",
        placeholder: slugLabel,
      },
      parse: parseSlug,
      format: (operand: string) => operand,
      test: (value: string, operand: string) => value === operand,
    },
    prefix: {
      label: "Starts with",
      operand: {
        kind: "string",
        placeholder: "acme",
      },
      parse: parseSlugFragment,
      format: (operand: string) => operand,
      test: (value: string, operand: string) => value.startsWith(operand),
    },
  },
} satisfies TypeModuleFilter<string>;

export const slugTypeModule = defineValidatedStringTypeModule({
  values: { key: "core:slug", name: "Slug", icon: slugIconSeed },
  parse: parseSlug,
  filter: slugFilter,
  placeholder: slugLabel,
  autocomplete: "off",
});

export const slugType = slugTypeModule.type;
