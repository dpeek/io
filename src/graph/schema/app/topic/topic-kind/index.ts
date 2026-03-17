import { defineDefaultEnumTypeModule } from "../../../core/enum-module.js";
import { topicKindType } from "./type.js";

export const topicKindTypeModule = defineDefaultEnumTypeModule(topicKindType);

export const topicKind = topicKindTypeModule.type;

export { topicKindType };
