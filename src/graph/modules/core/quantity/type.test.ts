import { describe, expect, it } from "bun:test";

import { decodeQuantity, formatQuantity, normalizeQuantityInput, parseQuantity } from "./type.js";

describe("quantity value module", () => {
  it("parses and formats amount-plus-unit values", () => {
    const value = parseQuantity("12.5 kg");

    expect(value).toEqual({
      amount: 12.5,
      unit: "kg",
    });
    expect(formatQuantity(value)).toBe("12.5 kg");
  });

  it("normalizes persisted quantity objects", () => {
    expect(decodeQuantity('{"amount":4,"unit":" pcs "}')).toEqual({
      amount: 4,
      unit: "pcs",
    });
    expect(() => normalizeQuantityInput({ amount: Number.NaN, unit: "kg" })).toThrow(
      "Quantity amounts must be finite.",
    );
    expect(() => normalizeQuantityInput({ amount: 4, unit: " " })).toThrow(
      "Quantity units must not be blank.",
    );
  });
});
