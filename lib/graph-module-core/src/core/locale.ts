import { defineEnum } from "@io/graph-module";
import { defineDefaultEnumTypeModule } from "@io/graph-module";

import { defineCoreIconSeed } from "../icon/seed.js";
import { country } from "./country.js";
import { language } from "./language.js";

const localeIconSeed = defineCoreIconSeed("locale", {
  name: "Locale",
  svg: `<svg viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" fill="none" width="24" height="24" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <path d="M5 8l6 6" />
  <path d="M4 14l6-6 2-3" />
  <path d="M2 5h12" />
  <path d="M7 2h1" />
  <path d="M22 22 17 12 12 22" />
  <path d="M14 18h6" />
</svg>`,
});

export const locale = defineEnum({
  values: { key: "core:locale", name: "Locale", icon: localeIconSeed },
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
