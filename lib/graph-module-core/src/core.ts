import { applyGraphIdMap } from "@io/graph-kernel";

import coreIdMap from "./core.json";
import { booleanTypeModule } from "./core/boolean.js";
import { cardinality } from "./core/cardinality.js";
import { colorTypeModule } from "./core/color.js";
import { dateTypeModule } from "./core/date.js";
import { durationTypeModule } from "./core/duration.js";
import { emailTypeModule } from "./core/email.js";
import { enumType } from "./core/enum.js";
import { icon } from "./core/icon.js";
import {
  admissionApproval,
  admissionApprovalStatus,
  admissionBootstrapMode,
  admissionPolicy,
  admissionSignupPolicy,
  authSubjectProjection,
  authSubjectStatus,
  capabilityGrant,
  capabilityGrantResourceKind,
  capabilityGrantStatus,
  capabilityGrantTargetKind,
  principal,
  principalKind,
  principalRoleBinding,
  principalRoleBindingStatus,
  principalStatus,
  shareGrant,
  shareSurfaceKind,
} from "./core/identity.js";
import { jsonTypeModule } from "./core/json.js";
import { markdownTypeModule } from "./core/markdown.js";
import { moneyTypeModule } from "./core/money.js";
import { node } from "./core/node.js";
import { numberTypeModule } from "./core/number.js";
import { percentTypeModule } from "./core/percent.js";
import { predicate } from "./core/predicate.js";
import { quantityTypeModule } from "./core/quantity.js";
import { rangeTypeModule } from "./core/range.js";
import { rateTypeModule } from "./core/rate.js";
import { secretHandle } from "./core/secret.js";
import { slugTypeModule } from "./core/slug.js";
import { stringTypeModule } from "./core/string.js";
import { svgTypeModule } from "./core/svg.js";
import { tag } from "./core/tag.js";
import { coreType } from "./core/type.js";
import { urlTypeModule } from "./core/url.js";

const string = stringTypeModule.type;

const number = numberTypeModule.type;

const date = dateTypeModule.type;

const duration = durationTypeModule.type;

const boolean = booleanTypeModule.type;

const color = colorTypeModule.type;

const url = urlTypeModule.type;

const email = emailTypeModule.type;

const json = jsonTypeModule.type;

const markdown = markdownTypeModule.type;

const money = moneyTypeModule.type;

const slug = slugTypeModule.type;

const svg = svgTypeModule.type;

const percent = percentTypeModule.type;

const quantity = quantityTypeModule.type;

const range = rangeTypeModule.type;

const rate = rateTypeModule.type;

export const core = applyGraphIdMap(coreIdMap, {
  string,
  number,
  date,
  duration,
  boolean,
  color,
  url,
  email,
  json,
  markdown,
  money,
  slug,
  svg,
  percent,
  quantity,
  range,
  rate,
  icon,
  tag,
  type: coreType,
  cardinality,
  predicate,
  enum: enumType,
  node,
  secretHandle,
  admissionApprovalStatus,
  admissionBootstrapMode,
  admissionSignupPolicy,
  principalKind,
  principalStatus,
  authSubjectStatus,
  principalRoleBindingStatus,
  capabilityGrantResourceKind,
  capabilityGrantTargetKind,
  capabilityGrantStatus,
  shareSurfaceKind,
  principal,
  authSubjectProjection,
  principalRoleBinding,
  admissionPolicy,
  admissionApproval,
  capabilityGrant,
  shareGrant,
});
