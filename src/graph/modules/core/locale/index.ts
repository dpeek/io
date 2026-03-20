import { defineEnum } from "@io/core/graph/def";

import { country } from "../country/index.js";
import { defineDefaultEnumTypeModule } from "../enum-module.js";
import { graphIconSeeds } from "../icon/seed.js";
import { language } from "../language/index.js";

export const locale = defineEnum({
  values: { key: "core:locale", name: "Locale", icon: graphIconSeeds.locale },
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

export const localeTypeModule = defineDefaultEnumTypeModule(locale);
