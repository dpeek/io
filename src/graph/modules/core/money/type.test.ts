import { describe, expect, it } from "bun:test";

import { currency } from "../currency/index.js";
import { decodeMoney, formatMoney, normalizeMoneyInput, parseMoney } from "./type.js";

describe("money value module", () => {
  it("parses and formats amount-plus-currency values", () => {
    const value = parseMoney("1250 USD");

    expect(value).toEqual({
      amount: 1250,
      currency: currency.options.usd.key,
    });
    expect(formatMoney(value)).toBe("1250 USD");
  });

  it("normalizes persisted money objects against the currency catalog", () => {
    expect(decodeMoney('{"amount":12.5,"currency":"USD"}')).toEqual({
      amount: 12.5,
      currency: currency.options.usd.key,
    });
    expect(() =>
      normalizeMoneyInput({ amount: Number.NaN, currency: currency.options.usd.key }),
    ).toThrow("Money amounts must be finite.");
    expect(() => normalizeMoneyInput({ amount: 12.5, currency: "zzz" })).toThrow(
      'Unknown currency "zzz".',
    );
  });
});
