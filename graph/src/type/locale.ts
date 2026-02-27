import { defineEnum } from "@io/graph";
import { country } from "./country";
import { language } from "./language";

export const locale = defineEnum({
  values: { key: "core:locale", name: "Locale" },
  options: {
    en: {
      name: "English",
      code: "en",
      language: language.values.en,
    },
    enAU: {
      name: "Australian English",
      code: "en-AU",
      language: language.values.en,
      country: country.values.au,
    },
    enGB: {
      name: "British English",
      code: "en-GB",
      language: language.values.en,
      country: country.values.gb,
    },
    enUS: {
      name: "American English",
      code: "en-US",
      language: language.values.en,
      country: country.values.us,
    },
    enCA: {
      name: "Canadian English",
      code: "en-CA",
      language: language.values.en,
      country: country.values.ca,
    },
  },
});
