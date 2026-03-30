import type { AgentTuiBlock } from "./transcript.js";

const ELLIPSIS = "...";

export const DEFAULT_MAX_BLOCK_LINES = 200;
export const DEFAULT_MAX_BLOCKS_PER_SESSION = 256;
export const DEFAULT_MAX_PARTS_PER_BLOCK = 32;
export const DEFAULT_MAX_TEXT_LENGTH = 16_384;
const DEFAULT_MAX_OBJECT_DEPTH = 4;
const DEFAULT_MAX_OBJECT_KEYS = 32;
const DEFAULT_MAX_ARRAY_ITEMS = 32;

export function truncateStoredText(text: string, maxLength = DEFAULT_MAX_TEXT_LENGTH) {
  if (text.length <= maxLength) {
    return text;
  }
  const tailLength = Math.max(0, maxLength - ELLIPSIS.length);
  return `${ELLIPSIS}${text.slice(text.length - tailLength)}`;
}

export function appendBoundedText(
  current: string,
  next: string,
  maxLength = DEFAULT_MAX_TEXT_LENGTH,
) {
  if (!next) {
    return truncateStoredText(current, maxLength);
  }
  return truncateStoredText(`${current}${next}`, maxLength);
}

export function appendBoundedLines(
  target: string[],
  next: readonly string[],
  maxLines = DEFAULT_MAX_BLOCK_LINES,
) {
  if (!next.length) {
    return;
  }
  target.push(...next.map((line) => truncateStoredText(line)));
  if (target.length > maxLines) {
    target.splice(0, target.length - maxLines);
  }
}

export function appendBoundedParts(
  target: string[],
  next: readonly string[],
  options: {
    maxItems?: number;
    maxTextLength?: number;
  } = {},
) {
  const maxItems = options.maxItems ?? DEFAULT_MAX_PARTS_PER_BLOCK;
  const maxTextLength = options.maxTextLength ?? DEFAULT_MAX_TEXT_LENGTH;
  if (!next.length) {
    return;
  }
  target.push(...next.map((part) => truncateStoredText(part, maxTextLength)));
  if (target.length > maxItems) {
    target.splice(0, target.length - maxItems);
  }
}

export function compactTranscriptValue(
  value: unknown,
  options: {
    depth?: number;
    maxArrayItems?: number;
    maxObjectKeys?: number;
    maxTextLength?: number;
  } = {},
): unknown {
  const depth = options.depth ?? 0;
  const maxArrayItems = options.maxArrayItems ?? DEFAULT_MAX_ARRAY_ITEMS;
  const maxObjectKeys = options.maxObjectKeys ?? DEFAULT_MAX_OBJECT_KEYS;
  const maxTextLength = options.maxTextLength ?? DEFAULT_MAX_TEXT_LENGTH;

  if (typeof value === "string") {
    return truncateStoredText(value, maxTextLength);
  }
  if (
    value == null ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return value;
  }
  if (depth >= DEFAULT_MAX_OBJECT_DEPTH) {
    return Array.isArray(value) ? [ELLIPSIS] : { [ELLIPSIS]: true };
  }
  if (Array.isArray(value)) {
    return value.slice(Math.max(0, value.length - maxArrayItems)).map((entry) =>
      compactTranscriptValue(entry, {
        depth: depth + 1,
        maxArrayItems,
        maxObjectKeys,
        maxTextLength,
      }),
    );
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const compacted = Object.fromEntries(
      entries.slice(0, maxObjectKeys).map(([key, entry]) => [
        key,
        compactTranscriptValue(entry, {
          depth: depth + 1,
          maxArrayItems,
          maxObjectKeys,
          maxTextLength,
        }),
      ]),
    );
    if (entries.length > maxObjectKeys) {
      compacted[ELLIPSIS] = `${entries.length - maxObjectKeys} more`;
    }
    return compacted;
  }
  return String(value);
}

export function pruneBlocks(blocks: AgentTuiBlock[], maxBlocks = DEFAULT_MAX_BLOCKS_PER_SESSION) {
  if (blocks.length <= maxBlocks) {
    return;
  }
  const preserveLifecycleHead = blocks[0]?.kind === "lifecycle";
  const removable = blocks.length - maxBlocks;
  if (preserveLifecycleHead) {
    blocks.splice(1, removable);
    return;
  }
  blocks.splice(0, removable);
}
