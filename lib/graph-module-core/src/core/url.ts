import type { TypeModuleFilter } from "@io/graph-module";
import type { TypeModuleMeta } from "@io/graph-module";
import { defineScalar } from "@io/graph-module";
import { defineScalarModule } from "@io/graph-module";

import { defineCoreIconSeed } from "../icon/seed.js";
import { expectUrlInput } from "./input.js";

const urlIconSeed = defineCoreIconSeed("url", {
  name: "URL",
  svg: `<svg viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" fill="none" width="24" height="24" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <path d="M15 3h6v6" />
  <path d="M10 14 21 3" />
  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
</svg>`,
});

function parseUrl(raw: string): URL {
  return new URL(raw);
}

export const urlFilter = {
  defaultOperator: "equals",
  operators: {
    equals: {
      label: "Equals",
      operand: {
        kind: "url",
        placeholder: "https://example.com",
      },
      parse: parseUrl,
      format: (operand: URL) => operand.toString(),
      test: (value: URL, operand: URL) => value.toString() === operand.toString(),
    },
    host: {
      label: "Host",
      operand: {
        kind: "string",
        placeholder: "example.com",
      },
      parse: (raw: string) => raw,
      format: (operand: string) => operand,
      test: (value: URL, operand: string) => value.host === operand,
    },
  },
} satisfies TypeModuleFilter<URL>;

export const urlMeta = {
  searchable: true,
  summary: {
    kind: "value",
    format: (value: URL) => value.toString(),
  },
  display: {
    kind: "link",
    allowed: ["link", "external-link", "text"] as const,
    format: (value: URL) => value.toString(),
  },
  editor: {
    kind: "url",
    allowed: ["url", "text"] as const,
    placeholder: "https://example.com",
  },
} satisfies TypeModuleMeta<
  URL,
  readonly ["link", "external-link", "text"],
  readonly ["url", "text"]
>;

export const urlType = defineScalar({
  values: { key: "core:url", name: "URL", icon: urlIconSeed },
  encode: (value: URL) => expectUrlInput(value).toString(),
  decode: (raw) => new URL(raw),
});

export const urlTypeModule = defineScalarModule({
  type: urlType,
  meta: urlMeta,
  filter: urlFilter,
});
