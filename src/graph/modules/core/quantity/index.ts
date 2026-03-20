import { defineScalarModule } from "../../../graph/type-module.js";
import { quantityFilter } from "./filter.js";
import { quantityMeta } from "./meta.js";
import {
  decodeQuantity,
  formatQuantity,
  formatQuantityAmount,
  formatQuantityEditorValue,
  normalizeQuantityInput,
  parseQuantity,
  quantityType,
  type QuantityValue,
} from "./type.js";

export const quantityTypeModule = defineScalarModule({
  type: quantityType,
  meta: quantityMeta,
  filter: quantityFilter,
});

export {
  decodeQuantity,
  formatQuantity,
  formatQuantityAmount,
  formatQuantityEditorValue,
  normalizeQuantityInput,
  parseQuantity,
  quantityFilter,
  quantityMeta,
  quantityType,
};
export type { QuantityValue };
