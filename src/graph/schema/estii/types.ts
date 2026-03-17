export * from "./account/index.js";
export * from "./card/index.js";
export * from "./theme/index.js";
export * from "./resourceTag/index.js";
export * from "./resource/index.js";
export * from "./person/index.js";
export * from "./variable/index.js";
export * from "./milestone/index.js";
export * from "./estimate/index.js";
export * from "./reply/index.js";
export * from "./comment/index.js";
export * from "./task/index.js";
export * from "./feature/index.js";
export * from "./phase/index.js";
export * from "./deal/index.js";
export * from "./space/index.js";

import { account } from "./account/index.js";
import { card } from "./card/index.js";
import { comment } from "./comment/index.js";
import { deal } from "./deal/index.js";
import { estimate } from "./estimate/index.js";
import { feature } from "./feature/index.js";
import { milestone } from "./milestone/index.js";
import { person } from "./person/index.js";
import { phase } from "./phase/index.js";
import { reply } from "./reply/index.js";
import { resource } from "./resource/index.js";
import { resourceTag } from "./resourceTag/index.js";
import { space } from "./space/index.js";
import { task } from "./task/index.js";
import { theme } from "./theme/index.js";
import { variable } from "./variable/index.js";

export const estiiSchema = {
  account,
  card,
  theme,
  resourceTag,
  resource,
  person,
  variable,
  milestone,
  estimate,
  reply,
  comment,
  task,
  feature,
  phase,
  deal,
  space,
} as const;
