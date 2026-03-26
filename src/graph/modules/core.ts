import { applyGraphIdMap as applyIdMap } from "@io/graph-kernel";

import coreIdMap from "./core.json";
import { booleanTypeModule } from "./core/boolean/index.js";
import { cardinality } from "./core/cardinality/index.js";
import { colorTypeModule } from "./core/color/index.js";
import { dateTypeModule } from "./core/date/index.js";
import { durationTypeModule } from "./core/duration/index.js";
import { emailTypeModule } from "./core/email/index.js";
import { enumType } from "./core/enum/index.js";
import { icon } from "./core/icon/index.js";
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
} from "./core/identity/index.js";
import { jsonTypeModule } from "./core/json/index.js";
import { markdownTypeModule } from "./core/markdown/index.js";
import { moneyTypeModule } from "./core/money/index.js";
import { node } from "./core/node/index.js";
import { numberTypeModule } from "./core/number/index.js";
import { percentTypeModule } from "./core/percent/index.js";
import { predicate } from "./core/predicate/index.js";
import { quantityTypeModule } from "./core/quantity/index.js";
import { rangeTypeModule } from "./core/range/index.js";
import { rateTypeModule } from "./core/rate/index.js";
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

export const core = applyIdMap(coreIdMap, {
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
