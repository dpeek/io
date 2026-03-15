import { defineScalar } from "../../../graph/schema.js";
import { expectUrlInput } from "../../../type/input.js";

export const urlType = defineScalar({
  values: { key: "core:url", name: "URL" },
  encode: (value: URL) => expectUrlInput(value).toString(),
  decode: (raw) => new URL(raw),
});
