import { describe, expect, it } from "bun:test";

import { country, countryTypeModule, currency, currencyTypeModule } from "@io/graph-module-core";

describe("core enum data modules", () => {
  it("keeps country members on the existing enum export", () => {
    expect(country.values.us).toMatchObject({
      key: "core:country.us",
      name: "United States",
      code: "US",
    });
    expect(country.options.us).toBe(country.values.us);
    expect(countryTypeModule.type).toBe(country);
  });

  it("keeps currency members on the existing enum export", () => {
    expect(currency.values.usd).toMatchObject({
      key: "core:currency.usd",
      symbol: "$",
      name: "US Dollar",
      symbol_native: "$",
      decimal_digits: 2,
      rounding: 0,
      code: "USD",
      name_plural: "US dollars",
    });
    expect(currency.options.usd).toBe(currency.values.usd);
    expect(currencyTypeModule.type).toBe(currency);
  });
});
