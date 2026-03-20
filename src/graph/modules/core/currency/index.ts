import { defineEnum } from "@io/core/graph/def";

import { defineDefaultEnumTypeModule } from "../enum-module.js";
import { currencyOptions } from "./data.js";

export const currency = defineEnum({
  values: { key: "core:currency", name: "Country" },
  options: currencyOptions,
});

export const currencyTypeModule = defineDefaultEnumTypeModule(currency);
