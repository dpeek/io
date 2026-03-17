import { defineNamespace } from "../graph/schema.js";
import coreIdMap from "./core.json";
import { booleanTypeModule } from "./core/boolean/index.js";
import { cardinality } from "./core/cardinality/index.js";
import { colorTypeModule } from "./core/color/index.js";
import { dateTypeModule } from "./core/date/index.js";
import { emailTypeModule } from "./core/email/index.js";
import { enumType } from "./core/enum/index.js";
import { icon } from "./core/icon/index.js";
import { jsonTypeModule } from "./core/json/index.js";
import { markdownTypeModule } from "./core/markdown/index.js";
import { node } from "./core/node/index.js";
import { numberTypeModule } from "./core/number/index.js";
import { predicate } from "./core/predicate/index.js";
import { secretHandle } from "./core/secret/index.js";
import { slugTypeModule } from "./core/slug/index.js";
import { stringTypeModule } from "./core/string/index.js";
import { svgTypeModule } from "./core/svg/index.js";
import { tag } from "./core/tag/index.js";
import { coreType } from "./core/type/index.js";
import { urlTypeModule } from "./core/url/index.js";

const string = stringTypeModule.type;

const number = numberTypeModule.type;

const date = dateTypeModule.type;

const boolean = booleanTypeModule.type;

const color = colorTypeModule.type;

const url = urlTypeModule.type;

const email = emailTypeModule.type;

const json = jsonTypeModule.type;

const markdown = markdownTypeModule.type;

const slug = slugTypeModule.type;

const svg = svgTypeModule.type;

export const core = defineNamespace(coreIdMap, {
  string,
  number,
  date,
  boolean,
  color,
  url,
  email,
  json,
  markdown,
  slug,
  svg,
  icon,
  tag,
  type: coreType,
  cardinality,
  predicate,
  enum: enumType,
  node,
  secretHandle,
});
