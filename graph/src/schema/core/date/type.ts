import { defineScalar } from "../../../graph/schema.js";
import { formatDate, parseDate } from "./parse.js";

export const dateType = defineScalar({
  values: { key: "core:date", name: "Date" },
  encode: formatDate,
  decode: parseDate,
});
