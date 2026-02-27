export type LogLevel = "info" | "error";
export type LogSeverity = "debug" | "info" | "warn" | "error";
export type LogFormat = "pretty" | "json";

import { z } from "zod/v4";
import { env } from "./env.js";

export interface LogRuntime {
  name: "bun" | "node" | "browser";
  version?: string;
}

export interface LogSource {
  column?: number;
  file: string;
  function?: string;
  line: number;
}

export interface LogError {
  message: string;
  name: string;
  stack?: string;
}

export interface LogRecord {
  actor_id?: string;
  command_id?: string;
  commit?: string;
  data?: Record<string, unknown>;
  env?: string;
  error?: LogError;
  event: string;
  level: LogLevel;
  pkg: string;
  request_id?: string;
  runtime?: LogRuntime;
  seq?: number;
  source?: LogSource;
  tags?: string[];
  ts: string;
  version?: string;
}

export interface LoggerOptions {
  actor_id?: string;
  commit?: string;
  data: Record<string, unknown>;
  env?: string;
  event_prefix?: string;
  level: LogSeverity;
  pkg: string;
  redact: string[];
  sample: number;
  tags: string[];
  transports: LogTransport[];
  version?: string;
}

export type LogInput =
  | string
  | number
  | boolean
  | bigint
  | null
  | undefined
  | Error
  | Record<string, unknown>
  | unknown[];

export interface Logger {
  child(fields: Record<string, unknown>): Logger;
  debug(eventOrData?: LogInput, ...args: LogInput[]): void;
  error(eventOrError?: LogInput, ...args: LogInput[]): void;
  info(eventOrData?: LogInput, ...args: LogInput[]): void;
  options: LoggerOptions;
  warn(eventOrData?: LogInput, ...args: LogInput[]): void;
}

export type LogTransport = (record: LogRecord) => void | Promise<void>;

function isError(value: unknown): value is Error {
  return value instanceof Error;
}

const envLogRedact = env("LOG_REDACT_KEYS", z.array(z.string()).optional());

const envLogLevel = env("LOG_LEVEL", z.enum(["debug", "info", "error"]).optional());

const envNodeEnv = env("NODE_ENV", z.enum(["development", "production", "test"]).optional());

function getDefaultLevel() {
  return envLogLevel.value ?? (envNodeEnv.value === "production" ? "info" : "debug");
}

const envLogFormat = env("LOG_FORMAT", z.enum(["pretty", "json"]).optional());

function getDefaultFormat() {
  return envLogFormat.value ?? "json";
}

const logSampleDebug = env("LOG_SAMPLE_DEBUG", z.number().optional());

function getDefaultSample() {
  return logSampleDebug.value ?? 1;
}

const envLogSource = env("LOG_SOURCE", z.coerce.boolean().optional());

const redactDefault = ["password", "token", "authorization", "cookie", "secret"];

function getDefaultRedact(keys: string[] = []) {
  return Array.from(new Set([...(envLogRedact.value ?? []), ...redactDefault, ...keys]));
}

function getDefaultTransports() {
  if (envNodeEnv.value === "test") {
    return [];
  }
  return [createConsoleTransport(getDefaultFormat())];
}

function getOptions(options: Partial<LoggerOptions> = {}): LoggerOptions {
  return {
    actor_id: options.actor_id,
    commit: options.commit,
    data: options.data ?? {},
    env: options.env ?? envNodeEnv.value,
    event_prefix: options.event_prefix,
    level: options.level ?? getDefaultLevel(),
    pkg: options.pkg ?? "unknown",
    redact: getDefaultRedact(options.redact),
    sample: options.sample ?? getDefaultSample(),
    tags: options.tags ?? [],
    transports: options.transports ?? getDefaultTransports(),
    version: options.version,
  };
}

const LEVEL_ORDER: Record<LogSeverity, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function isBun(): boolean {
  return globalThis.process !== undefined && !!globalThis.process.versions?.bun;
}

function isNode(): boolean {
  return globalThis.process !== undefined && !!globalThis.process.versions?.node && !isBun();
}

function detectRuntime(): {
  name: "bun" | "node" | "browser";
  version?: string;
} {
  if (isBun()) {
    return { name: "bun", version: globalThis.process.versions.bun };
  }
  if (isNode()) {
    return { name: "node", version: globalThis.process.versions.node };
  }
  return { name: "browser" };
}

function redactDeep<T>(value: T, keys: string[]): T {
  const keySet = new Set(keys.map((k) => k.toLowerCase()));
  const redact = (v: unknown): unknown => {
    if (v == null) {
      return v;
    }
    if (Array.isArray(v)) {
      return v.map((x) => redact(x));
    }
    if (typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) {
        out[k] = keySet.has(k.toLowerCase()) ? "[REDACTED]" : redact(val);
      }
      return out;
    }
    return v;
  };
  return redact(value) as T;
}

function normalizeError(err: Error): LogError {
  return {
    name: err.name || "Error",
    message: err.message || "unknown error",
    stack: typeof err.stack === "string" ? err.stack : undefined,
  };
}

function normalizeSource(raw: LogSource): LogSource {
  if (!isNode() && !isBun()) {
    return raw;
  }
  const cwd = globalThis.process?.cwd?.();
  if (!cwd) {
    return raw;
  }
  const file = raw.file.startsWith(cwd) ? raw.file.slice(cwd.length).replace(/^\/+/, "") : raw.file;
  return { ...raw, file };
}

function captureSource(): LogSource | undefined {
  if (!envLogSource.value) {
    return undefined;
  }
  const stack = new Error().stack;
  if (!stack) {
    return undefined;
  }
  const lines = stack.split("\n").slice(2);
  for (const line of lines) {
    if (line.includes("/util/src/log.ts")) {
      continue;
    }
    const match =
      /\s+at\s+(?<fn>.+?)\s+\((?<file>.*?):(?<line>\d+):(?<col>\d+)\)/.exec(line) ??
      /\s+at\s+(?<file>.*?):(?<line>\d+):(?<col>\d+)/.exec(line);
    if (!match?.groups?.file || !match.groups.line || !match.groups.col) {
      continue;
    }
    const file = match.groups.file;
    const lineNum = Number(match.groups.line);
    const colNum = Number(match.groups.col);
    if (!Number.isFinite(lineNum) || !Number.isFinite(colNum)) {
      continue;
    }
    return normalizeSource({
      file,
      line: lineNum,
      column: colNum,
      function: match.groups.fn,
    });
  }
  return undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

const reservedKeys = new Set([
  "event",
  "event_prefix",
  "tags",
  "data",
  "error",
  "source",
  "pkg",
  "commit",
  "env",
  "version",
  "request_id",
  "command_id",
  "actor_id",
]);

type NormalizedInput = {
  data: Record<string, unknown>;
  event: string;
  eventPrefix?: string;
  extra: Partial<LogRecord>;
  tags: string[];
};

function normalizeInput(
  eventOrError: LogInput | undefined,
  args: LogInput[],
  severity: LogSeverity,
): NormalizedInput {
  let event: string | undefined;
  let eventPrefix: string | undefined;
  const data: Record<string, unknown> = {};
  const tags: string[] = [];
  const extra: Partial<LogRecord> = {};
  const argList: LogInput[] = [];
  if (eventOrError !== undefined) {
    argList.push(eventOrError);
  }
  argList.push(...args);

  for (const arg of argList) {
    if (arg instanceof Error) {
      if (!extra.error) {
        extra.error = normalizeError(arg);
      } else {
        const errors = (data.errors as unknown[]) ?? [];
        errors.push(normalizeError(arg));
        data.errors = errors;
      }
      continue;
    }
    if (typeof arg === "string" && event === undefined) {
      event = arg;
      continue;
    }
    if (isPlainObject(arg)) {
      const hasReserved = Object.keys(arg).some((key) => reservedKeys.has(key));
      if (hasReserved) {
        const {
          event: eventOverride,
          event_prefix: eventPrefixOverride,
          tags: tagOverride,
          data: dataOverride,
          error: errorOverride,
          source,
          pkg,
          commit,
          env,
          version,
          request_id,
          command_id,
          actor_id,
          ...rest
        } = arg as Record<string, unknown>;
        if (typeof eventOverride === "string" && !event) {
          event = eventOverride;
        }
        if (typeof eventPrefixOverride === "string") {
          eventPrefix = eventPrefixOverride;
        }
        if (Array.isArray(tagOverride)) {
          tags.push(...tagOverride.filter((tag) => typeof tag === "string"));
        }
        if (isPlainObject(dataOverride)) {
          Object.assign(data, dataOverride);
        }
        if (errorOverride instanceof Error) {
          extra.error = normalizeError(errorOverride);
        } else if (isPlainObject(errorOverride)) {
          const name = typeof errorOverride.name === "string" ? errorOverride.name : undefined;
          const message =
            typeof errorOverride.message === "string" ? errorOverride.message : "unknown error";
          const stack = typeof errorOverride.stack === "string" ? errorOverride.stack : undefined;
          extra.error = { name: name ?? "Error", message, stack };
        }
        if (source && isPlainObject(source)) {
          extra.source = source as unknown as LogSource;
        }
        if (typeof pkg === "string") {
          extra.pkg = pkg;
        }
        if (typeof commit === "string") {
          extra.commit = commit;
        }
        if (typeof env === "string") {
          extra.env = env;
        }
        if (typeof version === "string") {
          extra.version = version;
        }
        if (typeof request_id === "string") {
          extra.request_id = request_id;
        }
        if (typeof command_id === "string") {
          extra.command_id = command_id;
        }
        if (typeof actor_id === "string") {
          extra.actor_id = actor_id;
        }
        Object.assign(data, rest);
        continue;
      }
      Object.assign(data, arg);
      continue;
    }
    if (arg !== undefined) {
      const list = (data.args as unknown[]) ?? [];
      list.push(arg);
      data.args = list;
    }
  }

  if (!event) {
    event = severity === "error" ? "error" : "log";
  }

  return { data, event, eventPrefix, extra, tags };
}

export function createConsoleTransport(format: "pretty" | "json"): LogTransport {
  return (record: LogRecord) => {
    const logger: any = record.level === "error" ? console.error : console.log;
    // stable key order
    const out: Record<string, unknown> = {
      ts: record.ts,
      level: record.level,
      event: record.event,
      pkg: record.pkg,
    };
    if (record.tags?.length) {
      out.tags = record.tags;
    }
    if (record.data && Object.keys(record.data).length) {
      out.data = record.data;
    }
    if (record.error) {
      out.error = record.error;
    }
    if (record.source) {
      out.source = record.source;
    }
    if (record.runtime) {
      out.runtime = record.runtime;
    }
    if (record.env) {
      out.env = record.env;
    }
    if (record.version) {
      out.version = record.version;
    }
    if (record.commit) {
      out.commit = record.commit;
    }
    if (record.request_id) {
      out.request_id = record.request_id;
    }
    if (record.command_id) {
      out.command_id = record.command_id;
    }
    if (record.actor_id) {
      out.actor_id = record.actor_id;
    }
    if (record.seq !== undefined) {
      out.seq = record.seq;
    }
    if (format === "pretty") {
      logger(record.pkg.padEnd(15, " "), out.event, JSON.stringify(out.data));
    } else {
      logger(JSON.stringify(out));
    }
  };
}

class StructuredLogger implements Logger {
  readonly options: LoggerOptions;
  #seq = 0;

  constructor(options = getOptions()) {
    this.options = options;
  }

  child(fields: Record<string, unknown>): Logger {
    const { data, tags, extra, eventPrefix } = normalizeInput(fields, [], "info");
    const currentPrefix = this.options.event_prefix;
    const nextPrefix =
      eventPrefix && currentPrefix
        ? `${currentPrefix}.${eventPrefix}`
        : (eventPrefix ?? currentPrefix);
    return new StructuredLogger({
      ...this.options,
      actor_id: extra.actor_id ?? this.options.actor_id,
      commit: extra.commit ?? this.options.commit,
      data: { ...this.options.data, ...data },
      env: extra.env ?? this.options.env,
      event_prefix: nextPrefix,
      pkg: extra.pkg ?? this.options.pkg,
      tags: [...this.options.tags, ...tags],
    });
  }

  debug(eventOrData?: LogInput, ...args: LogInput[]): void {
    this.emit("debug", eventOrData, args);
  }

  info(eventOrData?: LogInput, ...args: LogInput[]): void {
    this.emit("info", eventOrData, args);
  }

  warn(eventOrData?: LogInput, ...args: LogInput[]): void {
    this.emit("warn", eventOrData, args);
  }

  error(eventOrError?: LogInput, ...args: LogInput[]): void {
    this.emit("error", eventOrError, args);
  }

  private shouldLog(severity: LogSeverity): boolean {
    if (LEVEL_ORDER[severity] < LEVEL_ORDER[this.options.level]) {
      return false;
    }
    if (severity === "debug" && this.options.sample < 1) {
      const r = Math.random();
      if (r >= this.options.sample) {
        return false;
      }
    }
    return true;
  }

  private emit(severity: LogSeverity, eventOrError?: LogInput, args: LogInput[] = []) {
    if (!this.shouldLog(severity)) {
      return;
    }

    const ts = new Date().toISOString();
    const runtime = detectRuntime();
    const { data, event, eventPrefix, extra, tags } = normalizeInput(eventOrError, args, severity);
    const redactKeys = this.options.redact;
    const mergedData = { ...this.options.data, ...data };
    const redactedData =
      mergedData && Object.keys(mergedData).length > 0
        ? redactDeep(mergedData, redactKeys)
        : undefined;

    const prefix = eventPrefix ?? this.options.event_prefix;
    const prefixedEvent = prefix ? `${prefix}.${event}` : event;

    const record: LogRecord = {
      ts,
      level: severity === "error" ? "error" : "info",
      event: prefixedEvent,
      pkg: extra.pkg ?? this.options.pkg,
      tags: [...this.options.tags, ...tags, ...(severity === "debug" ? ["debug"] : [])],
      data: redactedData,
      error: extra.error,
      source: extra.source ?? captureSource(),
      runtime,
      env: extra.env ?? this.options.env,
      version: extra.version ?? this.options.version,
      commit: extra.commit ?? this.options.commit,
      request_id: extra.request_id,
      command_id: extra.command_id,
      actor_id: extra.actor_id ?? this.options.actor_id,
      seq: ++this.#seq,
    };

    if (severity === "warn") {
      record.tags = [...(record.tags ?? []), "warn"];
    }

    if (isError(eventOrError) && !record.error) {
      record.error = normalizeError(eventOrError);
    }

    for (const transport of this.options.transports) {
      transport(record);
    }
  }
}

export function createLogger(options: Partial<LoggerOptions> = {}): Logger {
  return new StructuredLogger(getOptions(options));
}
