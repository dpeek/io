import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createLogger } from "@io/app/lib";
import { IO_TS_FILE, loadIoConfig, type NormalizedIoConfig } from "@io/app/lib/config";
import z from "zod";

import {
  DEFAULT_BACKLOG_BUILTIN_DOC_IDS,
  DEFAULT_EXECUTE_BUILTIN_DOC_IDS,
  DEFAULT_REVIEW_BUILTIN_DOC_IDS,
} from "./builtins.js";
import type {
  AgentRole,
  IssueRoutingCondition,
  IssueRoutingConfig,
  RenderContext,
  ValidationResult,
  Workflow,
  WorkflowEntrypoint,
} from "./types.js";
import { toId } from "./util.js";

const log = createLogger({ pkg: "agent" });

const IO_PROMPT_FILE = "io.md";

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

const agentRoleSchema: z.ZodType<AgentRole> = z.enum(["backlog", "execute", "review"]);

const issueRoutingConditionSchema = z
  .object({
    hasChildren: z.boolean().optional(),
    hasParent: z.boolean().optional(),
    labelsAll: stateListSchema.optional(),
    labelsAny: stateListSchema.optional(),
    projectSlugIn: stateListSchema.optional(),
    stateIn: stateListSchema.optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: "Routing rules must define at least one condition",
  });

const issueRoutingRuleSchema = z.object({
  agent: agentRoleSchema,
  if: issueRoutingConditionSchema,
  profile: z.string().min(1),
});

const contextProfileSchema = z.object({
  include: z.array(z.string().min(1)).default([]),
  includeEntrypoint: z.boolean().default(true),
});

const workflowModuleSchema = z.object({
  allowedSharedPaths: z.array(z.string().min(1)).default([]),
  docs: z.array(z.string().min(1)).default([]),
  path: z.string().min(1),
});

const workflowTuiGraphSchema = z
  .object({
    kind: z.literal("http").default("http"),
    url: z.string().url().optional(),
  })
  .default({
    kind: "http",
  });

const workflowTuiInitialScopeSchema = z
  .object({
    branch: z.string().min(1).optional(),
    project: z.string().min(1).optional(),
  })
  .default({});

const ioExtensionsSchema = z
  .object({
    context: z
      .object({
        docs: z.record(z.string().min(1), z.string().min(1)).default({}),
        entrypoint: z.string().min(1).optional(),
        overrides: z.record(z.string().min(1), z.string().min(1)).default({}),
        profiles: z.record(z.string().min(1), contextProfileSchema).default({}),
      })
      .default({ docs: {}, overrides: {}, profiles: {} }),
    issues: z
      .object({
        defaultAgent: agentRoleSchema.default("execute"),
        defaultProfile: z.string().min(1).optional(),
        routing: z.array(issueRoutingRuleSchema).default([]),
      })
      .default({
        defaultAgent: "execute",
        routing: [],
      }),
    modules: z.record(z.string().min(1), workflowModuleSchema).default({}),
    tui: z
      .object({
        graph: workflowTuiGraphSchema,
        initialScope: workflowTuiInitialScopeSchema,
      })
      .default({
        graph: {
          kind: "http",
        },
        initialScope: {},
      }),
  })
  .passthrough();

type IoExtensions = z.infer<typeof ioExtensionsSchema>;
type IoIssueRoutingConfig = IoExtensions["issues"];
type IoModuleConfig = IoExtensions["modules"];
type IoTuiConfig = IoExtensions["tui"];
type WorkflowConfigFields = Pick<
  Workflow,
  | "agent"
  | "codex"
  | "context"
  | "hooks"
  | "issues"
  | "modules"
  | "polling"
  | "tracker"
  | "tui"
  | "workspace"
>;

function expandEnv(value?: string) {
  if (!value) {
    return value;
  }
  if (!value.startsWith("$")) {
    return value;
  }
  return process.env[value.slice(1)]?.trim() || undefined;
}

function expandPathValue(value: string, baseDir: string) {
  const envExpanded = expandEnv(value) ?? value;
  const tildeExpanded = envExpanded.startsWith("~/")
    ? resolve(homedir(), envExpanded.slice(2))
    : envExpanded === "~"
      ? homedir()
      : envExpanded;
  return isAbsolute(tildeExpanded) ? tildeExpanded : resolve(baseDir, tildeExpanded);
}

function buildWorkflow(
  config: WorkflowConfigFields,
  entrypointContent: string,
  entrypoint: WorkflowEntrypoint,
): Workflow {
  return {
    ...config,
    entrypoint,
    entrypointContent,
  };
}

function normalizeStates(value: string[] | string) {
  const list = Array.isArray(value) ? value : value.split(",");
  return list.map((entry) => entry.trim()).filter(Boolean);
}

function normalizeIssueRoutingValues(value?: string[] | string) {
  if (value == null) {
    return undefined;
  }
  return normalizeStates(value).map((entry) => entry.toLowerCase());
}

function normalizeIssueRoutingCondition(
  condition: IoIssueRoutingConfig["routing"][number]["if"],
): IssueRoutingCondition {
  return {
    hasChildren: condition.hasChildren,
    hasParent: condition.hasParent,
    labelsAll: normalizeIssueRoutingValues(condition.labelsAll),
    labelsAny: normalizeIssueRoutingValues(condition.labelsAny),
    projectSlugIn: normalizeIssueRoutingValues(condition.projectSlugIn),
    stateIn: normalizeIssueRoutingValues(condition.stateIn),
  };
}

function normalizeIssueRouting(config: IoIssueRoutingConfig): IssueRoutingConfig {
  return {
    defaultAgent: config.defaultAgent,
    defaultProfile: config.defaultProfile?.trim() || config.defaultAgent,
    routing: config.routing.map((rule) => ({
      agent: rule.agent,
      if: normalizeIssueRoutingCondition(rule.if),
      profile: rule.profile.trim(),
    })),
  };
}

function normalizeModules(config: IoModuleConfig, baseDir: string) {
  return Object.fromEntries(
    Object.entries(config).map(([id, module]) => {
      const normalizedId = id.trim().toLowerCase();
      return [
        normalizedId,
        {
          allowedSharedPaths: module.allowedSharedPaths.map((path) =>
            expandPathValue(path, baseDir),
          ),
          docs: module.docs.map((reference) => reference.trim()).filter(Boolean),
          id: normalizedId,
          path: expandPathValue(module.path, baseDir),
        },
      ];
    }),
  );
}

function normalizeTuiConfig(config: IoTuiConfig) {
  return {
    graph: {
      kind: config.graph.kind,
      url: config.graph.url?.trim() || undefined,
    },
    initialScope: {
      branch: config.initialScope.branch?.trim() || undefined,
      project: config.initialScope.project?.trim() || undefined,
    },
  } satisfies Pick<WorkflowConfigFields, "tui">["tui"];
}

function normalizeIoExtensions(config: IoExtensions, baseDir: string) {
  const defaultProfiles = {
    backlog: {
      include: [...DEFAULT_BACKLOG_BUILTIN_DOC_IDS],
      includeEntrypoint: true,
    },
    execute: {
      include: [...DEFAULT_EXECUTE_BUILTIN_DOC_IDS],
      includeEntrypoint: true,
    },
    review: {
      include: [...DEFAULT_REVIEW_BUILTIN_DOC_IDS],
      includeEntrypoint: true,
    },
  };
  return {
    context: {
      docs: Object.fromEntries(
        Object.entries(config.context.docs).map(([id, path]) => [
          id.trim(),
          expandPathValue(path, baseDir),
        ]),
      ),
      overrides: Object.fromEntries(
        Object.entries(config.context.overrides).map(([id, path]) => [
          id,
          expandPathValue(path, baseDir),
        ]),
      ),
      profiles: {
        ...defaultProfiles,
        ...Object.fromEntries(
          Object.entries(config.context.profiles).map(([name, profile]) => [
            name.trim(),
            {
              include: profile.include.map((reference) => reference.trim()).filter(Boolean),
              includeEntrypoint: profile.includeEntrypoint,
            },
          ]),
        ),
      },
    },
    issues: normalizeIssueRouting(config.issues),
    modules: normalizeModules(config.modules, baseDir),
    tui: normalizeTuiConfig(config.tui),
  } satisfies Pick<WorkflowConfigFields, "context" | "issues" | "modules" | "tui">;
}

function normalizeLoadedIoConfig(
  config: NormalizedIoConfig,
  extensions: Pick<WorkflowConfigFields, "context" | "issues" | "modules" | "tui">,
): WorkflowConfigFields {
  return {
    agent: {
      maxConcurrentAgents: config.agent.maxConcurrentAgents,
      maxRetryBackoffMs: config.agent.maxRetryBackoffMs,
      maxTurns: config.agent.maxTurns,
    },
    codex: {
      approvalPolicy: config.codex.approvalPolicy,
      command: config.codex.command,
      readTimeoutMs: config.codex.readTimeoutMs,
      stallTimeoutMs: config.codex.stallTimeoutMs,
      threadSandbox: config.codex.threadSandbox,
      turnSandboxPolicy: config.codex.turnSandboxPolicy,
      turnTimeoutMs: config.codex.turnTimeoutMs,
    },
    context: extensions.context,
    hooks: {
      afterCreate: config.hooks.afterCreate,
      afterRun: config.hooks.afterRun,
      beforeRemove: config.hooks.beforeRemove,
      beforeRun: config.hooks.beforeRun,
      timeoutMs: config.hooks.timeoutMs,
    },
    issues: extensions.issues,
    modules: extensions.modules,
    polling: {
      intervalMs: config.polling.intervalMs,
    },
    tracker: {
      activeStates: [...config.tracker.activeStates],
      apiKey: config.tracker.apiKey,
      endpoint: config.tracker.endpoint,
      kind: config.tracker.kind,
      projectSlug: config.tracker.projectSlug,
      terminalStates: [...config.tracker.terminalStates],
    },
    tui: extensions.tui,
    workspace: {
      origin: config.workspace.origin,
      root: config.workspace.root,
    },
  };
}

function mapIssues(issues: z.ZodIssue[]) {
  return issues.map((issue) => ({
    message: issue.message,
    path: issue.path.join(".") || "$",
  }));
}

function invalidResult(message: string, path = "$"): ValidationResult<never> {
  return {
    errors: [{ message, path }],
    ok: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

async function loadRawIoConfig(path: string) {
  if (basename(path) !== IO_TS_FILE) {
    throw new Error(`Unsupported agent config path: ${path}. Expected ${IO_TS_FILE}.`);
  }
  const moduleUrl = new URL(pathToFileURL(path).href);
  moduleUrl.searchParams.set("t", `${Date.now()}-${Math.random()}`);
  const module = await import(moduleUrl.href);
  if (!("default" in module)) {
    throw new Error(`${IO_TS_FILE} must export a default config object`);
  }
  return module.default;
}

async function loadIoExtensions(
  configPath: string,
): Promise<ValidationResult<Pick<WorkflowConfigFields, "context" | "issues" | "modules" | "tui">>> {
  try {
    const rawConfig = await loadRawIoConfig(configPath);
    if (!isRecord(rawConfig)) {
      return invalidResult(`${basename(configPath)} must decode to an object`, configPath);
    }
    const result = ioExtensionsSchema.safeParse(rawConfig);
    if (!result.success) {
      return { errors: mapIssues(result.error.issues), ok: false };
    }
    return {
      ok: true,
      value: normalizeIoExtensions(result.data, dirname(configPath)),
    };
  } catch (error) {
    log.error("workflow.parse_failed", error instanceof Error ? error : new Error(String(error)));
    return invalidResult(error instanceof Error ? error.message : String(error), configPath);
  }
}

function resolveEntrypoint(
  path: string | undefined,
  baseDir: string,
): ValidationResult<WorkflowEntrypoint> {
  if (path) {
    const absolutePath = isAbsolute(path) ? path : resolve(baseDir, path);
    const filename = basename(absolutePath);
    if (filename === IO_TS_FILE) {
      return {
        ok: true,
        value: {
          configPath: absolutePath,
          kind: "io",
          promptPath: resolve(dirname(absolutePath), IO_PROMPT_FILE),
        },
      };
    }
    if (filename === IO_PROMPT_FILE) {
      return {
        ok: true,
        value: {
          configPath: resolve(dirname(absolutePath), IO_TS_FILE),
          kind: "io",
          promptPath: absolutePath,
        },
      };
    }
    return invalidResult(
      `Unsupported entrypoint path: ${path}. Expected ${IO_TS_FILE} or ${IO_PROMPT_FILE}.`,
    );
  }

  const ioTsPath = resolve(baseDir, IO_TS_FILE);
  const ioPromptPath = resolve(baseDir, IO_PROMPT_FILE);
  const hasIoTs = existsSync(ioTsPath);
  const hasIoPrompt = existsSync(ioPromptPath);

  if (hasIoTs) {
    return {
      ok: true,
      value: {
        configPath: ioTsPath,
        kind: "io",
        promptPath: ioPromptPath,
      },
    };
  }
  if (hasIoPrompt) {
    return invalidResult(
      `Incomplete IO entrypoints. Expected ${IO_TS_FILE} with ${IO_PROMPT_FILE}.`,
    );
  }
  return invalidResult(`No agent entrypoint found. Add ${IO_TS_FILE} and ${IO_PROMPT_FILE}.`);
}

async function loadEntrypointContent(path: string) {
  if (!existsSync(path)) {
    return invalidResult(`Missing prompt entrypoint: ${path}`, path);
  }
  const entrypointContent = (await Bun.file(path).text()).trim();
  if (!entrypointContent) {
    return invalidResult(`Prompt entrypoint must not be empty: ${path}`, path);
  }
  return { ok: true, value: entrypointContent } satisfies ValidationResult<string>;
}

async function loadIoWorkflow(entrypoint: WorkflowEntrypoint): Promise<ValidationResult<Workflow>> {
  const loaded = await loadIoConfig({
    baseDir: dirname(entrypoint.configPath),
    configPath: entrypoint.configPath,
  });
  if (!loaded.ok) {
    return loaded;
  }
  const extensions = await loadIoExtensions(loaded.value.sourcePath);
  if (!extensions.ok) {
    return extensions;
  }
  if (!loaded.value.hasRuntimeConfig) {
    return invalidResult(
      `${basename(entrypoint.configPath)} does not contain agent runtime config: ${entrypoint.configPath}`,
      entrypoint.configPath,
    );
  }
  const entrypointContent = await loadEntrypointContent(entrypoint.promptPath);
  if (!entrypointContent.ok) {
    return entrypointContent;
  }
  return {
    ok: true,
    value: buildWorkflow(
      normalizeLoadedIoConfig(loaded.value.config, extensions.value),
      entrypointContent.value,
      {
        ...entrypoint,
        configPath: loaded.value.sourcePath,
      },
    ),
  };
}

export async function loadWorkflowFile(
  path?: string,
  baseDir = process.cwd(),
): Promise<ValidationResult<Workflow>> {
  const entrypoint = resolveEntrypoint(path, baseDir);
  if (!entrypoint.ok) {
    return entrypoint;
  }
  if (!existsSync(entrypoint.value.configPath)) {
    return invalidResult(
      `Missing config entrypoint: ${entrypoint.value.configPath}`,
      entrypoint.value.configPath,
    );
  }
  return loadIoWorkflow(entrypoint.value);
}

function lookupValue(context: Record<string, unknown>, path: string) {
  return path.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object" || !(part in current)) {
      throw new Error(`Unknown prompt template variable: ${path}`);
    }
    return (current as Record<string, unknown>)[part];
  }, context);
}

export function renderPrompt(template: string, context: RenderContext) {
  return template.replaceAll(/\{\{\s*([^}]+?)\s*\}\}/g, (_, rawPath) => {
    const value = lookupValue(context as unknown as Record<string, unknown>, rawPath.trim());
    if (value == null) {
      return "";
    }
    if (typeof value === "object") {
      return JSON.stringify(value);
    }
    return String(value);
  });
}

export function toWorkspaceKey(identifier: string) {
  return toId(identifier.replaceAll(/[^\w-]+/g, "-"));
}
