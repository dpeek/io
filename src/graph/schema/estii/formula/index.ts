import { defineEnum } from "@io/core/graph/def";

import { defineDefaultEnumTypeModule } from "../../core/enum-module.js";

const formulaType = defineEnum({
  values: { key: "estii:formula", name: "Formula" },
  options: {
    fixed: { name: "Fixed" },
    linear: { name: "Linear" },
    percent: { name: "Percent" },
    compound: { name: "Compound" },
    easeIn: { key: "estii:formula.ease_in", name: "Ease in" },
    easeOut: { key: "estii:formula.ease_out", name: "Ease out" },
    easeInOut: { key: "estii:formula.ease_in_out", name: "Ease in out" },
  },
});

export const formulaTypeModule = defineDefaultEnumTypeModule(formulaType);
export const formula = formulaTypeModule.type;
