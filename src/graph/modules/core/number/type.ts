import { defineScalar } from "@io/core/graph/def";

import { graphIconSeeds } from "../icon/seed.js";
import { expectNumberInput } from "../input.js";

export const numberType = defineScalar({
  values: { key: "core:number", name: "Number", icon: graphIconSeeds.number },
  encode: (value: number) => String(expectNumberInput(value)),
  decode: (raw) => Number(raw),
  validate: ({ value }) =>
    Number.isFinite(value)
      ? undefined
      : {
          code: "number.notFinite",
          message: "Number values must be finite.",
        },
});
