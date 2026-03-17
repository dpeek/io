export * from "./topic-kind/index.js";
export * from "./topic/index.js";

import { topicKind } from "./topic-kind/index.js";
import { topic } from "./topic/index.js";

export const topicSchema = {
  topic,
  topicKind,
} as const;
