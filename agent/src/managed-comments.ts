import { createHash } from "node:crypto";

import { parse as parseYaml } from "yaml";

import type {
  ManagedCommentCommand,
  ManagedCommentCommandName,
  ManagedCommentParseError,
  ManagedCommentPayload,
  ManagedCommentResult,
  ManagedCommentTrigger,
} from "./types.js";

const MANAGED_COMMENT_RESULT_MARKER = "<!-- io-managed:comment-result -->";
const SUPPORTED_COMMANDS = new Set<ManagedCommentCommandName>([
  "backlog",
  "focus",
  "help",
  "status",
]);
const SUPPORTED_PAYLOAD_KEYS = new Set<keyof ManagedCommentPayload | "note">([
  "docs",
  "dryRun",
  "note",
]);

type ManagedCommentSource = {
  body: string;
  commentId: string;
  createdAt: string;
  issue: ManagedCommentTrigger["issue"];
  updatedAt: string;
};

function firstNonEmptyLine(body: string) {
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hashManagedCommentBody(body: string) {
  return createHash("sha256").update(body).digest("hex");
}

export function isManagedCommentCommand(
  trigger: ManagedCommentTrigger,
): trigger is ManagedCommentCommand {
  return "command" in trigger;
}

export function parseManagedComment(
  source: ManagedCommentSource,
): ManagedCommentTrigger | undefined {
  const firstLine = firstNonEmptyLine(source.body);
  if (!firstLine?.startsWith("@io ")) {
    return undefined;
  }

  const bodyHash = hashManagedCommentBody(source.body);
  const commandToken = firstLine.slice("@io ".length).trim();
  if (!/^[a-z]+$/.test(commandToken)) {
    return toParseError(source, bodyHash, "The first line must be `@io <command>`.");
  }
  if (!SUPPORTED_COMMANDS.has(commandToken as ManagedCommentCommandName)) {
    return toParseError(source, bodyHash, `Unknown command: ${commandToken}.`);
  }

  const lines = source.body.split(/\r?\n/);
  const firstIndex = lines.findIndex((line) => line.trim().length > 0);
  const yamlText = lines
    .slice(firstIndex + 1)
    .join("\n")
    .trim();
  const payload = parseManagedCommentPayload(yamlText);
  if ("error" in payload) {
    return toParseError(source, bodyHash, payload.error);
  }

  return {
    body: source.body,
    bodyHash,
    command: commandToken as ManagedCommentCommandName,
    commentId: source.commentId,
    createdAt: source.createdAt,
    issue: source.issue,
    payload,
    updatedAt: source.updatedAt,
  };
}

function parseManagedCommentPayload(yamlText: string): ManagedCommentPayload | { error: string } {
  if (!yamlText) {
    return { docs: [], dryRun: false };
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(yamlText);
  } catch {
    return { error: "The YAML body is invalid." };
  }

  if (!isRecord(parsed)) {
    return { error: "The YAML body must be one mapping." };
  }

  const unknownKeys = Object.keys(parsed).filter(
    (key) => !SUPPORTED_PAYLOAD_KEYS.has(key as keyof ManagedCommentPayload | "note"),
  );
  if (unknownKeys.length) {
    return { error: `Unknown top-level keys: ${unknownKeys.join(", ")}.` };
  }

  const docsValue = parsed.docs;
  if (
    docsValue !== undefined &&
    (!Array.isArray(docsValue) || docsValue.some((doc) => typeof doc !== "string"))
  ) {
    return { error: "`docs` must be a list of strings." };
  }

  const dryRunValue = parsed.dryRun;
  if (dryRunValue !== undefined && typeof dryRunValue !== "boolean") {
    return { error: "`dryRun` must be a boolean." };
  }

  const noteValue = parsed.note;
  if (noteValue !== undefined && typeof noteValue !== "string") {
    return { error: "`note` must be a string." };
  }

  return {
    docs: [...(docsValue ?? [])],
    dryRun: dryRunValue ?? false,
    note: noteValue,
  };
}

function toParseError(
  source: ManagedCommentSource,
  bodyHash: string,
  error: string,
): ManagedCommentParseError {
  return {
    body: source.body,
    bodyHash,
    commentId: source.commentId,
    createdAt: source.createdAt,
    error,
    issue: source.issue,
    updatedAt: source.updatedAt,
  };
}

export function renderManagedCommentReply(options: {
  command: string;
  issueIdentifier: string;
  lines: string[];
  result: ManagedCommentResult;
}) {
  const body = [
    MANAGED_COMMENT_RESULT_MARKER,
    `Command: ${options.command}`,
    `Result: ${options.result}`,
    `Target: ${options.issueIdentifier}`,
    "",
    ...options.lines.map((line) => `- ${line}`),
  ];
  return body.join("\n").trimEnd();
}
