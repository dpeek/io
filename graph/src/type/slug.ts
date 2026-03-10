import type { TypeModuleFilter } from "../graph/type-module.js";
import { defineValidatedStringTypeModule } from "./validated-string.js";

const slugLabel = "company-slug";
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const slugFragmentPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*-?$/;

function normalizeSlug(raw: string): string {
  return raw.trim().toLowerCase().replace(/[_\s]+/g, "-").replace(/-+/g, "-");
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
  values: { key: "core:slug", name: "Slug" },
  parse: parseSlug,
  filter: slugFilter,
  placeholder: slugLabel,
  autocomplete: "off",
});

export const slugType = slugTypeModule.type;
