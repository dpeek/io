import { defineType } from "@io/core/graph/def";

import { core } from "../../core.js";
import { colorTypeModule } from "../../core/color/index.js";
import { numberTypeModule } from "../../core/number/index.js";
import { stringTypeModule } from "../../core/string/index.js";

export const theme = defineType({
  values: { key: "estii:theme", name: "Theme" },
  fields: {
    ...core.node.fields,
    order: numberTypeModule.field({
      cardinality: "one",
      meta: { label: "Order" },
    }),
    logoImage: stringTypeModule.field({
      cardinality: "one?",
      meta: { label: "Logo image" },
    }),
    backgroundImage: stringTypeModule.field({
      cardinality: "one?",
      meta: { label: "Background image" },
    }),
    backgroundType: stringTypeModule.field({
      cardinality: "one",
      meta: { label: "Background type" },
    }),
    backgroundColor: colorTypeModule.field({
      cardinality: "one",
      meta: { label: "Background color" },
    }),
    foregroundColor: colorTypeModule.field({
      cardinality: "one",
      meta: { label: "Foreground color" },
    }),
    gradient1Color: colorTypeModule.field({
      cardinality: "one",
      meta: { label: "Gradient 1 color" },
    }),
    gradient2Color: colorTypeModule.field({
      cardinality: "one",
      meta: { label: "Gradient 2 color" },
    }),
    textPrimaryColor: colorTypeModule.field({
      cardinality: "one",
      meta: { label: "Primary text color" },
    }),
    textSecondaryColor: colorTypeModule.field({
      cardinality: "one",
      meta: { label: "Secondary text color" },
    }),
    textBrandedColor: colorTypeModule.field({
      cardinality: "one",
      meta: { label: "Branded text color" },
    }),
    shapeColor: colorTypeModule.field({
      cardinality: "one",
      meta: { label: "Shape color" },
    }),
    shapeHoverColor: colorTypeModule.field({
      cardinality: "one",
      meta: { label: "Shape hover color" },
    }),
    shapeTextColor: colorTypeModule.field({
      cardinality: "one",
      meta: { label: "Shape text color" },
    }),
    shapeCornerType: stringTypeModule.field({
      cardinality: "one",
      meta: { label: "Shape corner type" },
    }),
    gradientRotation: numberTypeModule.field({
      cardinality: "one",
      meta: { label: "Gradient rotation" },
    }),
    backgroundImageBlur: numberTypeModule.field({
      cardinality: "one",
      meta: { label: "Background image blur" },
    }),
    backgroundImageOpacity: numberTypeModule.field({
      cardinality: "one",
      meta: { label: "Background image opacity" },
    }),
    fontName: stringTypeModule.field({
      cardinality: "one",
      meta: { label: "Font name" },
    }),
    titleFontName: stringTypeModule.field({
      cardinality: "one?",
      meta: { label: "Title font name" },
    }),
    titleFontWeight: stringTypeModule.field({
      cardinality: "one?",
      meta: { label: "Title font weight" },
    }),
    titleFontStyle: stringTypeModule.field({
      cardinality: "one?",
      meta: { label: "Title font style" },
    }),
    headerRight: stringTypeModule.field({
      cardinality: "one",
      meta: { label: "Header text" },
    }),
    footerRight: stringTypeModule.field({
      cardinality: "one",
      meta: { label: "Footer text" },
    }),
    brandingTheme: stringTypeModule.field({
      cardinality: "one?",
      meta: { label: "Branding theme" },
    }),
  },
});
