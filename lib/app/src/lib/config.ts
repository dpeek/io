import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import z from "zod";

export const IO_JSON_FILE = "io.json";
export const IO_TS_FILE = "io.ts";

const IO_RUNTIME_KEYS = ["agent", "codex", "hooks", "polling", "tracker", "workspace"] as const;
const ENV_KINDS = ["path", "secret", "string"] as const;

export type AskForApproval =
  | "untrusted"
  | "on-failure"
  | "on-request"
  | "never"
  | { reject: { mcp_elicitations: boolean; rules: boolean; sandbox_approval: boolean } };

export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export type SandboxPolicy =
  | { type: "dangerFullAccess" }
  | {
      access:
        | { type: "fullAccess" }
        | { includePlatformDefaults: boolean; readableRoots: string[]; type: "restricted" };
      networkAccess: boolean;
      type: "readOnly";
    }
  | { networkAccess: "restricted" | "enabled" | "disabled"; type: "externalSandbox" }
  | {
      excludeSlashTmp: boolean;
      excludeTmpdirEnvVar: boolean;
      networkAccess: boolean;
      readOnlyAccess:
        | { type: "fullAccess" }
        | { includePlatformDefaults: boolean; readableRoots: string[]; type: "restricted" };
      type: "workspaceWrite";
      writableRoots: string[];
    };

export type EnvKind = (typeof ENV_KINDS)[number];

export interface EnvReference<TKind extends EnvKind = EnvKind> {
  $env: string;
  kind: TKind;
}

type StringInput = string | EnvReference;
type StateListInput = string | string[];

export interface IoAgentConfigInput {
  maxConcurrentAgents?: number;
  maxRetryBackoffMs?: number;
  maxTurns?: number;
}

export interface IoCodexConfigInput {
  approvalPolicy?: AskForApproval;
  command?: string;
  readTimeoutMs?: number;
  stallTimeoutMs?: number;
  threadSandbox?: SandboxMode;
  turnSandboxPolicy?: SandboxPolicy;
  turnTimeoutMs?: number;
}

export interface IoHookConfigInput {
  afterCreate?: string;
  afterRun?: string;
  beforeRemove?: string;
  beforeRun?: string;
  timeoutMs?: number;
}

export interface IoInstallConfigInput {
  brews?: string[];
}

export interface IoPollingConfigInput {
  intervalMs?: number;
}

export type IoAgentRole = "backlog" | "execute" | "review";

export interface IoContextProfileInput {
  include?: string[];
  includeEntrypoint?: boolean;
}

export interface IoContextConfigInput {
  docs?: Record<string, string>;
  entrypoint?: string;
  overrides?: Record<string, string>;
  profiles?: Record<string, IoContextProfileInput>;
}

export interface IoIssueRoutingConditionInput {
  hasChildren?: boolean;
  hasParent?: boolean;
  labelsAll?: StateListInput;
  labelsAny?: StateListInput;
  projectSlugIn?: StateListInput;
  stateIn?: StateListInput;
}

export interface IoIssueRoutingRuleInput {
  agent: IoAgentRole;
  if: IoIssueRoutingConditionInput;
  profile: string;
}

export interface IoIssuesConfigInput {
  defaultAgent?: IoAgentRole;
  defaultProfile?: string;
  routing?: IoIssueRoutingRuleInput[];
}

export interface IoModuleConfigInput {
  allowedSharedPaths?: string[];
  docs?: string[];
  path: string;
}

export interface IoTrackerConfigInput {
  activeStates?: StateListInput;
  apiKey?: StringInput;
  endpoint?: string;
  kind?: "linear";
  projectSlug?: StringInput;
  terminalStates?: StateListInput;
}

export interface IoWorkspaceConfigInput {
  origin?: StringInput;
  root?: StringInput;
}

export interface IoConfigInput extends Record<string, unknown> {
  agent?: IoAgentConfigInput;
  brews?: string[];
  codex?: IoCodexConfigInput;
  context?: IoContextConfigInput;
  hooks?: IoHookConfigInput;
  install?: IoInstallConfigInput;
  issues?: IoIssuesConfigInput;
  modules?: Record<string, IoModuleConfigInput>;
  plugins?: Record<string, Record<string, unknown>>;
  polling?: IoPollingConfigInput;
  providers?: Record<string, Record<string, unknown>>;
  tracker?: IoTrackerConfigInput;
  workspace?: IoWorkspaceConfigInput;
}

export interface NormalizedIoConfig {
  agent: {
    maxConcurrentAgents: number;
    maxRetryBackoffMs: number;
    maxTurns: number;
  };
  codex: {
    approvalPolicy: AskForApproval;
    command: string;
    readTimeoutMs: number;
    stallTimeoutMs: number;
    threadSandbox: SandboxMode;
    turnSandboxPolicy?: SandboxPolicy;
    turnTimeoutMs: number;
  };
  hooks: {
    afterCreate?: string;
    afterRun?: string;
    beforeRemove?: string;
    beforeRun?: string;
    timeoutMs: number;
  };
  install: {
    brews: string[];
  };
  plugins: Record<string, Record<string, unknown>>;
  polling: {
    intervalMs: number;
  };
  providers: Record<string, Record<string, unknown>>;
  tracker: {
    activeStates: string[];
    apiKey?: string;
    endpoint: string;
    kind: "linear";
    projectSlug?: string;
    terminalStates: string[];
  };
  workspace: {
    origin?: string;
    root: string;
  };
}

export interface LoadedIoConfig {
  config: NormalizedIoConfig;
  hasRuntimeConfig: boolean;
  sourceKind: "json" | "ts";
  sourcePath: string;
}

export interface ConfigValidationError {
  message: string;
  path: string;
}

export type ConfigValidationResult<T> =
  | { ok: true; value: T }
  | { errors: ConfigValidationError[]; ok: false };

export type ConfigFieldKind =
  | "boolean"
  | "number"
  | "path"
  | "secret"
  | "string"
  | { enum: readonly string[] };

export interface ConfigFieldDescriptor {
  description?: string;
  kind: ConfigFieldKind;
  required?: boolean;
  title?: string;
}

export interface ConfigDescriptor<T extends Record<string, unknown> = Record<string, unknown>> {
  fields: { [K in keyof T]-?: ConfigFieldDescriptor };
  kind: string;
  title?: string;
}

export interface PluginDescriptor<
  T extends Record<string, unknown> = Record<string, unknown>,
> extends ConfigDescriptor<T> {
  scope: "plugin";
}

export interface ProviderDescriptor<
  T extends Record<string, unknown> = Record<string, unknown>,
> extends ConfigDescriptor<T> {
  scope: "provider";
}

export interface ConfigDescriptorMetadata {
  fields: Array<{
    description?: string;
    key: string;
    kind: "boolean" | "enum" | "number" | "path" | "secret" | "string";
    options?: readonly string[];
    required: boolean;
    title?: string;
  }>;
  kind: string;
  scope: "plugin" | "provider";
  title?: string;
}

const envReferenceSchema = z
  .object({
    $env: z.string().min(1),
    kind: z.enum(ENV_KINDS),
  })
  .strict();

const stringOrEnvSchema = z.union([z.string(), envReferenceSchema]);

const stateListSchema = z.union([
  z.array(z.string().min(1)),
  z
    .string()
    .min(1)
    .transform((value) =>
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
]);

const approvalPolicySchema: z.ZodType<AskForApproval> = z.union([
  z.enum(["untrusted", "on-failure", "on-request", "never"]),
  z.object({
    reject: z.object({
      mcp_elicitations: z.boolean(),
      rules: z.boolean(),
      sandbox_approval: z.boolean(),
    }),
  }),
]);

const sandboxModeSchema: z.ZodType<SandboxMode> = z.enum([
  "read-only",
  "workspace-write",
  "danger-full-access",
]);

const sandboxPolicySchema: z.ZodType<SandboxPolicy> = z.union([
  z.object({ type: z.literal("dangerFullAccess") }),
  z.object({
    access: z.union([
      z.object({ type: z.literal("fullAccess") }),
      z.object({
        includePlatformDefaults: z.boolean(),
        readableRoots: z.array(z.string().min(1)),
        type: z.literal("restricted"),
      }),
    ]),
    networkAccess: z.boolean(),
    type: z.literal("readOnly"),
  }),
  z.object({
    networkAccess: z.enum(["restricted", "enabled", "disabled"]),
    type: z.literal("externalSandbox"),
  }),
  z.object({
    excludeSlashTmp: z.boolean(),
    excludeTmpdirEnvVar: z.boolean(),
    networkAccess: z.boolean(),
    readOnlyAccess: z.union([
      z.object({ type: z.literal("fullAccess") }),
      z.object({
        includePlatformDefaults: z.boolean(),
        readableRoots: z.array(z.string().min(1)),
        type: z.literal("restricted"),
      }),
    ]),
    type: z.literal("workspaceWrite"),
    writableRoots: z.array(z.string().min(1)),
  }),
]);

const genericConfigValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    envReferenceSchema,
    z.array(genericConfigValueSchema),
    z.record(z.string(), genericConfigValueSchema),
  ]),
);

const genericConfigSchema = z.record(z.string(), genericConfigValueSchema);

const ioConfigSchema = z
  .object({
    agent: z
      .object({
        maxConcurrentAgents: z.coerce.number().int().positive().default(1),
        maxRetryBackoffMs: z.coerce.number().int().positive().default(300_000),
        maxTurns: z.coerce.number().int().positive().default(1),
      })
      .default({
        maxConcurrentAgents: 1,
        maxRetryBackoffMs: 300_000,
        maxTurns: 1,
      }),
    codex: z
      .object({
        approvalPolicy: approvalPolicySchema.default("never"),
        command: z.string().min(1).default("codex app-server"),
        readTimeoutMs: z.coerce.number().int().positive().default(5_000),
        stallTimeoutMs: z.coerce.number().int().default(300_000),
        threadSandbox: sandboxModeSchema.default("workspace-write"),
        turnSandboxPolicy: sandboxPolicySchema.optional(),
        turnTimeoutMs: z.coerce.number().int().positive().default(3_600_000),
      })
      .default({
        approvalPolicy: "never",
        command: "codex app-server",
        readTimeoutMs: 5_000,
        stallTimeoutMs: 300_000,
        threadSandbox: "workspace-write",
        turnTimeoutMs: 3_600_000,
      }),
    hooks: z
      .object({
        afterCreate: z.string().min(1).optional(),
        afterRun: z.string().min(1).optional(),
        beforeRemove: z.string().min(1).optional(),
        beforeRun: z.string().min(1).optional(),
        timeoutMs: z.coerce.number().int().positive().default(60_000),
      })
      .default({ timeoutMs: 60_000 }),
    install: z
      .object({
        brews: z.array(z.string().min(1)).default([]),
      })
      .default({ brews: [] }),
    plugins: z.record(z.string(), genericConfigSchema).default({}),
    polling: z
      .object({
        intervalMs: z.coerce.number().int().positive().default(30_000),
      })
      .default({ intervalMs: 30_000 }),
    providers: z.record(z.string(), genericConfigSchema).default({}),
    tracker: z
      .object({
        activeStates: stateListSchema.default(["Todo"]),
        apiKey: stringOrEnvSchema.optional(),
        endpoint: z.string().url().default("https://api.linear.app/graphql"),
        kind: z.literal("linear").default("linear"),
        projectSlug: stringOrEnvSchema.optional(),
        terminalStates: stateListSchema.default([
          "Closed",
          "Cancelled",
          "Canceled",
          "Duplicate",
          "Done",
        ]),
      })
      .default({
        activeStates: ["Todo"],
        endpoint: "https://api.linear.app/graphql",
        kind: "linear",
        terminalStates: ["Closed", "Cancelled", "Canceled", "Duplicate", "Done"],
      }),
    workspace: z
      .object({
        origin: stringOrEnvSchema.optional(),
        root: stringOrEnvSchema.default("$AGENT_WORKSPACE_ROOT"),
      })
      .default({
        root: "$AGENT_WORKSPACE_ROOT",
      }),
  })
  .passthrough();

function mapIssues(issues: z.ZodIssue[]): ConfigValidationError[] {
  return issues.map((issue) => ({
    message: issue.message,
    path: issue.path.join(".") || "$",
  }));
}

function invalidResult(message: string, path = "$"): ConfigValidationResult<never> {
  return {
    errors: [{ message, path }],
    ok: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isEnvReference(value: unknown): value is EnvReference {
  return isRecord(value) && typeof value.$env === "string" && typeof value.kind === "string";
}

function expandLegacyEnv(value?: string) {
  if (!value || !value.startsWith("$")) {
    return value;
  }
  return process.env[value.slice(1)]?.trim() || undefined;
}

function stringifyEnvReference(value: EnvReference) {
  return `$${value.$env}`;
}

function resolveStringInput(value?: StringInput) {
  if (!value) {
    return value;
  }
  if (typeof value === "string") {
    return value.startsWith("$") ? expandLegacyEnv(value) : value;
  }
  return process.env[value.$env]?.trim() || undefined;
}

function expandPathValue(value: string, baseDir: string) {
  const tildeExpanded = value.startsWith("~/")
    ? resolve(homedir(), value.slice(2))
    : value === "~"
      ? homedir()
      : value;
  return isAbsolute(tildeExpanded) ? tildeExpanded : resolve(baseDir, tildeExpanded);
}

function resolvePathInput(value: StringInput, baseDir: string) {
  const resolved =
    typeof value === "string"
      ? (expandLegacyEnv(value) ?? value)
      : process.env[value.$env]?.trim() || stringifyEnvReference(value);
  return expandPathValue(resolved, baseDir);
}

function resolveGenericValue(value: unknown, baseDir: string): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => resolveGenericValue(entry, baseDir));
  }
  if (isEnvReference(value)) {
    if (value.kind === "path") {
      return expandPathValue(
        process.env[value.$env]?.trim() || stringifyEnvReference(value),
        baseDir,
      );
    }
    return process.env[value.$env]?.trim() || undefined;
  }
  if (typeof value === "string") {
    return value.startsWith("$") ? (expandLegacyEnv(value) ?? value) : value;
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, resolveGenericValue(entry, baseDir)]),
  );
}

function resolveSectionConfigs(
  sections: Record<string, Record<string, unknown>>,
  baseDir: string,
): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(sections).map(([key, value]) => [
      key,
      resolveGenericValue(value, baseDir) as Record<string, unknown>,
    ]),
  );
}

function normalizeLegacyInput(config: Record<string, unknown>) {
  const install = isRecord(config.install) ? { ...config.install } : undefined;
  if (!install && Array.isArray(config.brews)) {
    return {
      ...config,
      install: {
        brews: config.brews,
      },
    };
  }
  if (install && !("brews" in install) && Array.isArray(config.brews)) {
    install.brews = config.brews;
    return {
      ...config,
      install,
    };
  }
  return config;
}

async function importIoModule(path: string) {
  const moduleUrl = new URL(pathToFileURL(path).href);
  moduleUrl.searchParams.set("t", `${Date.now()}-${Math.random()}`);
  return import(moduleUrl.href);
}

export const env = {
  path(key: string): EnvReference<"path"> {
    return { $env: key, kind: "path" };
  },
  secret(key: string): EnvReference<"secret"> {
    return { $env: key, kind: "secret" };
  },
  string(key: string): EnvReference<"string"> {
    return { $env: key, kind: "string" };
  },
} as const;

export function defineIoConfig<T extends IoConfigInput>(config: T) {
  return config;
}

export function definePluginConfig<T extends Record<string, unknown>>(config: T) {
  return config;
}

export function defineProviderConfig<T extends Record<string, unknown>>(config: T) {
  return config;
}

export function definePluginDescriptor<T extends Record<string, unknown>>(
  descriptor: Omit<PluginDescriptor<T>, "scope">,
): PluginDescriptor<T> {
  return {
    ...descriptor,
    scope: "plugin",
  };
}

export function defineProviderDescriptor<T extends Record<string, unknown>>(
  descriptor: Omit<ProviderDescriptor<T>, "scope">,
): ProviderDescriptor<T> {
  return {
    ...descriptor,
    scope: "provider",
  };
}

export function linearTracker(config: Omit<IoTrackerConfigInput, "kind">): IoTrackerConfigInput {
  return {
    ...config,
    kind: "linear",
  };
}

export function projectConfigDescriptorMetadata(
  descriptor: PluginDescriptor | ProviderDescriptor,
): ConfigDescriptorMetadata {
  return {
    fields: Object.entries(descriptor.fields).map(([key, field]) => {
      if (typeof field.kind === "string") {
        return {
          key,
          kind: field.kind,
          required: field.required ?? true,
          ...(field.description ? { description: field.description } : {}),
          ...(field.title ? { title: field.title } : {}),
        };
      }
      return {
        key,
        kind: "enum",
        options: field.kind.enum,
        required: field.required ?? true,
        ...(field.description ? { description: field.description } : {}),
        ...(field.title ? { title: field.title } : {}),
      };
    }),
    kind: descriptor.kind,
    scope: descriptor.scope,
    ...(descriptor.title ? { title: descriptor.title } : {}),
  };
}

export function hasIoRuntimeConfig(value: Record<string, unknown>) {
  return IO_RUNTIME_KEYS.some((key) => key in value);
}

export function normalizeIoConfig(
  config: Record<string, unknown>,
  baseDir: string,
): ConfigValidationResult<NormalizedIoConfig> {
  const result = ioConfigSchema.safeParse(normalizeLegacyInput(config));
  if (!result.success) {
    return { errors: mapIssues(result.error.issues), ok: false };
  }
  const parsed = result.data;
  return {
    ok: true,
    value: {
      agent: {
        maxConcurrentAgents: parsed.agent.maxConcurrentAgents,
        maxRetryBackoffMs: parsed.agent.maxRetryBackoffMs,
        maxTurns: parsed.agent.maxTurns,
      },
      codex: {
        approvalPolicy: parsed.codex.approvalPolicy,
        command: parsed.codex.command,
        readTimeoutMs: parsed.codex.readTimeoutMs,
        stallTimeoutMs: parsed.codex.stallTimeoutMs,
        threadSandbox: parsed.codex.threadSandbox,
        turnSandboxPolicy: parsed.codex.turnSandboxPolicy,
        turnTimeoutMs: parsed.codex.turnTimeoutMs,
      },
      hooks: {
        afterCreate: parsed.hooks.afterCreate,
        afterRun: parsed.hooks.afterRun,
        beforeRemove: parsed.hooks.beforeRemove,
        beforeRun: parsed.hooks.beforeRun,
        timeoutMs: parsed.hooks.timeoutMs,
      },
      install: {
        brews: parsed.install.brews,
      },
      plugins: resolveSectionConfigs(parsed.plugins, baseDir),
      polling: {
        intervalMs: parsed.polling.intervalMs,
      },
      providers: resolveSectionConfigs(parsed.providers, baseDir),
      tracker: {
        activeStates: [...parsed.tracker.activeStates],
        apiKey: resolveStringInput(parsed.tracker.apiKey) ?? process.env.LINEAR_API_KEY?.trim(),
        endpoint: parsed.tracker.endpoint,
        kind: parsed.tracker.kind,
        projectSlug:
          resolveStringInput(parsed.tracker.projectSlug) ?? process.env.LINEAR_PROJECT_SLUG?.trim(),
        terminalStates: [...parsed.tracker.terminalStates],
      },
      workspace: {
        origin: parsed.workspace.origin
          ? resolvePathInput(parsed.workspace.origin, baseDir)
          : undefined,
        root: resolvePathInput(parsed.workspace.root, baseDir),
      },
    },
  };
}

export async function loadIoConfig({
  baseDir = process.cwd(),
  configPath,
}: {
  baseDir?: string;
  configPath?: string;
} = {}): Promise<ConfigValidationResult<LoadedIoConfig>> {
  const absolutePath = configPath
    ? isAbsolute(configPath)
      ? configPath
      : resolve(baseDir, configPath)
    : existsSync(resolve(baseDir, IO_TS_FILE))
      ? resolve(baseDir, IO_TS_FILE)
      : resolve(baseDir, IO_JSON_FILE);

  const sourceKind =
    absolutePath.endsWith(`/${IO_TS_FILE}`) || absolutePath.endsWith(`\\${IO_TS_FILE}`)
      ? "ts"
      : absolutePath.endsWith(`/${IO_JSON_FILE}`) || absolutePath.endsWith(`\\${IO_JSON_FILE}`)
        ? "json"
        : null;

  if (!sourceKind) {
    return invalidResult(
      `Unsupported io config path: ${absolutePath}. Expected ${IO_TS_FILE} or ${IO_JSON_FILE}.`,
      absolutePath,
    );
  }
  if (!existsSync(absolutePath)) {
    return invalidResult(`Missing io config entrypoint: ${absolutePath}`, absolutePath);
  }

  try {
    const raw =
      sourceKind === "ts"
        ? importIoModule(absolutePath).then((module) => {
            if (!("default" in module)) {
              throw new Error(`${IO_TS_FILE} must export a default config object`);
            }
            return module.default;
          })
        : Bun.file(absolutePath).json();

    const value = await raw;
    if (!isRecord(value)) {
      return invalidResult(
        `${sourceKind === "ts" ? IO_TS_FILE : IO_JSON_FILE} must decode to an object`,
        absolutePath,
      );
    }
    const normalized = normalizeIoConfig(value, dirname(absolutePath));
    if (!normalized.ok) {
      return normalized;
    }
    return {
      ok: true,
      value: {
        config: normalized.value,
        hasRuntimeConfig: hasIoRuntimeConfig(value),
        sourceKind,
        sourcePath: absolutePath,
      },
    };
  } catch (error) {
    return invalidResult(error instanceof Error ? error.message : String(error), absolutePath);
  }
}
