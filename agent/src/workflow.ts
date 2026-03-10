import { createLogger } from "@io/lib";
import {
  IO_JSON_FILE,
  IO_TS_FILE,
  loadIoConfig,
  type AskForApproval,
  type NormalizedIoConfig,
  type SandboxMode,
  type SandboxPolicy,
} from "@io/lib/config";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";
import z from "zod";

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
const WORKFLOW_FILE = "WORKFLOW.md";
const DEFAULT_ISSUE_ROUTING: IssueRoutingConfig = {
  defaultAgent: "execute",
  defaultProfile: "execute",
  routing: [],
};

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

const agentRoleSchema: z.ZodType<AgentRole> = z.enum(["backlog", "execute"]);

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

const ioExtensionsSchema = z
  .object({
    context: z
      .object({
        overrides: z.record(z.string().min(1), z.string().min(1)).default({}),
      })
      .default({ overrides: {} }),
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
  })
  .passthrough();
const workflowFrontMatterSchema = z
  .object({
    agent: z
      .object({
        max_concurrent_agents: z.coerce.number().int().positive().default(1),
        max_retry_backoff_ms: z.coerce.number().int().positive().default(300_000),
        max_turns: z.coerce.number().int().positive().default(1),
      })
      .default({
        max_concurrent_agents: 1,
        max_retry_backoff_ms: 300_000,
        max_turns: 1,
      }),
    codex: z
      .object({
        approval_policy: approvalPolicySchema.default("never"),
        command: z.string().min(1).default("codex app-server"),
        read_timeout_ms: z.coerce.number().int().positive().default(5_000),
        stall_timeout_ms: z.coerce.number().int().default(300_000),
        thread_sandbox: sandboxModeSchema.default("workspace-write"),
        turn_sandbox_policy: sandboxPolicySchema.optional(),
        turn_timeout_ms: z.coerce.number().int().positive().default(3_600_000),
      })
      .default({
        approval_policy: "never",
        command: "codex app-server",
        read_timeout_ms: 5_000,
        stall_timeout_ms: 300_000,
        thread_sandbox: "workspace-write",
        turn_timeout_ms: 3_600_000,
      }),
    hooks: z
      .object({
        after_create: z.string().min(1).optional(),
        after_run: z.string().min(1).optional(),
        before_remove: z.string().min(1).optional(),
        before_run: z.string().min(1).optional(),
        timeout_ms: z.coerce.number().int().positive().default(60_000),
      })
      .default({ timeout_ms: 60_000 }),
    polling: z
      .object({
        interval_ms: z.coerce.number().int().positive().default(30_000),
      })
      .default({ interval_ms: 30_000 }),
    tracker: z.object({
      active_states: stateListSchema.default(["Todo"]),
      api_key: z.string().optional(),
      endpoint: z.string().url().default("https://api.linear.app/graphql"),
      kind: z.literal("linear").default("linear"),
      project_slug: z.string().optional(),
      terminal_states: stateListSchema.default([
        "Closed",
        "Cancelled",
        "Canceled",
        "Duplicate",
        "Done",
      ]),
    }),
    workspace: z.object({
      origin: z.string().optional(),
      root: z.string().default("$AGENT_WORKSPACE_ROOT"),
    }),
  })
  .passthrough();

type IoExtensions = z.infer<typeof ioExtensionsSchema>;
type IoIssueRoutingConfig = IoExtensions["issues"];
type WorkflowFrontMatter = z.infer<typeof workflowFrontMatterSchema>;
type WorkflowConfigFields = Pick<
  Workflow,
  "agent" | "codex" | "context" | "hooks" | "issues" | "polling" | "tracker" | "workspace"
>;

function splitFrontMatter(document: string) {
  if (!document.startsWith("---\n")) {
    return { configText: "", promptTemplate: document.trim() };
  }
  const end = document.indexOf("\n---", 4);
  if (end === -1) {
    throw new Error("Invalid workflow front matter: missing closing ---");
  }
  const configText = document.slice(4, end).trim();
  const promptTemplate = document.slice(end + 4).trim();
  return { configText, promptTemplate };
}

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
  promptTemplate: string,
  entrypoint: WorkflowEntrypoint,
): Workflow {
  return {
    ...config,
    entrypoint,
    promptTemplate,
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

function normalizeIoExtensions(config: IoExtensions, baseDir: string) {
  return {
    context: {
      overrides: Object.fromEntries(
        Object.entries(config.context.overrides).map(([id, path]) => [
          id,
          expandPathValue(path, baseDir),
        ]),
      ),
    },
    issues: normalizeIssueRouting(config.issues),
  } satisfies Pick<WorkflowConfigFields, "context" | "issues">;
}

function normalizeLoadedIoConfig(
  config: NormalizedIoConfig,
  extensions: Pick<WorkflowConfigFields, "context" | "issues">,
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
    workspace: {
      origin: config.workspace.origin,
      root: config.workspace.root,
    },
  };
}

function normalizeWorkflowFrontMatter(
  frontMatter: WorkflowFrontMatter,
  baseDir: string,
): WorkflowConfigFields {
  return {
    agent: {
      maxConcurrentAgents: frontMatter.agent.max_concurrent_agents,
      maxRetryBackoffMs: frontMatter.agent.max_retry_backoff_ms,
      maxTurns: frontMatter.agent.max_turns,
    },
    codex: {
      approvalPolicy: frontMatter.codex.approval_policy,
      command: frontMatter.codex.command,
      readTimeoutMs: frontMatter.codex.read_timeout_ms,
      stallTimeoutMs: frontMatter.codex.stall_timeout_ms,
      threadSandbox: frontMatter.codex.thread_sandbox,
      turnSandboxPolicy: frontMatter.codex.turn_sandbox_policy,
      turnTimeoutMs: frontMatter.codex.turn_timeout_ms,
    },
    context: {
      overrides: {},
    },
    hooks: {
      afterCreate: frontMatter.hooks.after_create,
      afterRun: frontMatter.hooks.after_run,
      beforeRemove: frontMatter.hooks.before_remove,
      beforeRun: frontMatter.hooks.before_run,
      timeoutMs: frontMatter.hooks.timeout_ms,
    },
    issues: DEFAULT_ISSUE_ROUTING,
    polling: {
      intervalMs: frontMatter.polling.interval_ms,
    },
    tracker: {
      activeStates: normalizeStates(frontMatter.tracker.active_states),
      apiKey: expandEnv(frontMatter.tracker.api_key) ?? expandEnv("$LINEAR_API_KEY"),
      endpoint: frontMatter.tracker.endpoint,
      kind: frontMatter.tracker.kind,
      projectSlug: expandEnv(frontMatter.tracker.project_slug) ?? expandEnv("$LINEAR_PROJECT_SLUG"),
      terminalStates: normalizeStates(frontMatter.tracker.terminal_states),
    },
    workspace: {
      origin: frontMatter.workspace.origin
        ? expandPathValue(frontMatter.workspace.origin, baseDir)
        : undefined,
      root: expandPathValue(frontMatter.workspace.root, baseDir),
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
  if (basename(path) === IO_TS_FILE) {
    const moduleUrl = new URL(pathToFileURL(path).href);
    moduleUrl.searchParams.set("t", `${Date.now()}-${Math.random()}`);
    const module = await import(moduleUrl.href);
    if (!("default" in module)) {
      throw new Error(`${IO_TS_FILE} must export a default config object`);
    }
    return module.default;
  }
  return Bun.file(path).json();
}

async function loadIoExtensions(
  configPath: string,
): Promise<ValidationResult<Pick<WorkflowConfigFields, "context" | "issues">>> {
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

function parseWorkflowDocument(
  document: string,
  entrypoint: WorkflowEntrypoint,
): ValidationResult<Workflow> {
  try {
    const { configText, promptTemplate } = splitFrontMatter(document);
    const rawConfig = configText ? parseYaml(configText) : {};
    if (rawConfig != null && typeof rawConfig !== "object") {
      return invalidResult("Workflow front matter must decode to an object");
    }
    const result = workflowFrontMatterSchema.safeParse(rawConfig ?? {});
    if (!result.success) {
      return { errors: mapIssues(result.error.issues), ok: false };
    }
    if (!promptTemplate) {
      return invalidResult("Workflow prompt body must not be empty", "promptTemplate");
    }
    return {
      ok: true,
      value: buildWorkflow(
        normalizeWorkflowFrontMatter(result.data, dirname(entrypoint.configPath)),
        promptTemplate,
        entrypoint,
      ),
    };
  } catch (error) {
    log.error("workflow.parse_failed", error instanceof Error ? error : new Error(String(error)));
    return invalidResult(error instanceof Error ? error.message : String(error));
  }
}

function resolvePreferredIoConfigPath(baseDir: string) {
  const ioTsPath = resolve(baseDir, IO_TS_FILE);
  if (existsSync(ioTsPath)) {
    return ioTsPath;
  }
  return resolve(baseDir, IO_JSON_FILE);
}

function resolveEntrypoint(path: string | undefined, baseDir: string): ValidationResult<WorkflowEntrypoint> {
  if (path) {
    const absolutePath = isAbsolute(path) ? path : resolve(baseDir, path);
    const filename = basename(absolutePath);
    if (filename === IO_TS_FILE || filename === IO_JSON_FILE) {
      return {
        ok: true,
        value: {
          configPath: absolutePath,
          kind: "io",
          promptPath: existsSync(resolve(dirname(absolutePath), IO_PROMPT_FILE))
            ? resolve(dirname(absolutePath), IO_PROMPT_FILE)
            : resolve(dirname(absolutePath), WORKFLOW_FILE),
        },
      };
    }
    if (filename === IO_PROMPT_FILE) {
      return {
        ok: true,
        value: {
          configPath: resolvePreferredIoConfigPath(dirname(absolutePath)),
          kind: "io",
          promptPath: absolutePath,
        },
      };
    }
    if (filename === WORKFLOW_FILE) {
      return {
        ok: true,
        value: {
          configPath: absolutePath,
          kind: "workflow",
          promptPath: absolutePath,
        },
      };
    }
    return invalidResult(
      `Unsupported entrypoint path: ${path}. Expected ${IO_TS_FILE}, ${IO_JSON_FILE}, ${IO_PROMPT_FILE}, or ${WORKFLOW_FILE}`,
    );
  }

  const ioTsPath = resolve(baseDir, IO_TS_FILE);
  const ioJsonPath = resolve(baseDir, IO_JSON_FILE);
  const ioPromptPath = resolve(baseDir, IO_PROMPT_FILE);
  const workflowPath = resolve(baseDir, WORKFLOW_FILE);
  const hasIoTs = existsSync(ioTsPath);
  const hasIoJson = existsSync(ioJsonPath);
  const hasIoPrompt = existsSync(ioPromptPath);

  if (hasIoTs || hasIoJson) {
    return {
      ok: true,
      value: {
        configPath: hasIoTs ? ioTsPath : ioJsonPath,
        kind: "io",
        promptPath: hasIoPrompt ? ioPromptPath : workflowPath,
      },
    };
  }
  if (existsSync(workflowPath)) {
    return {
      ok: true,
      value: {
        configPath: workflowPath,
        kind: "workflow",
        promptPath: workflowPath,
      },
    };
  }
  if (hasIoPrompt) {
    return invalidResult(
      `Incomplete IO entrypoints. Expected ${IO_TS_FILE} or ${IO_JSON_FILE} with ${IO_PROMPT_FILE}, or fall back to ${WORKFLOW_FILE} during migration.`,
    );
  }
  return invalidResult(
    `No agent entrypoint found. Add ${IO_TS_FILE} and ${IO_PROMPT_FILE}, use ${IO_JSON_FILE} as compatibility input, or keep ${WORKFLOW_FILE} during migration.`,
  );
}

async function loadPromptTemplate(path: string) {
  if (!existsSync(path)) {
    return invalidResult(`Missing prompt entrypoint: ${path}`, path);
  }
  const document = await Bun.file(path).text();
  const promptTemplate =
    basename(path) === WORKFLOW_FILE ? splitFrontMatter(document).promptTemplate : document.trim();
  if (!promptTemplate) {
    return invalidResult(`Prompt entrypoint must not be empty: ${path}`, path);
  }
  return { ok: true, value: promptTemplate } satisfies ValidationResult<string>;
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
    const workflowPath = resolve(dirname(entrypoint.configPath), WORKFLOW_FILE);
    if (existsSync(workflowPath)) {
      const document = await Bun.file(workflowPath).text();
      return parseWorkflowDocument(document, {
        configPath: workflowPath,
        kind: "workflow",
        promptPath: workflowPath,
      });
    }
    return invalidResult(
      `${basename(entrypoint.configPath)} does not contain agent runtime config: ${entrypoint.configPath}`,
      entrypoint.configPath,
    );
  }
  const promptTemplate = await loadPromptTemplate(entrypoint.promptPath);
  if (!promptTemplate.ok) {
    return promptTemplate;
  }
  return {
    ok: true,
    value: buildWorkflow(
      normalizeLoadedIoConfig(loaded.value.config, extensions.value),
      promptTemplate.value,
      {
        ...entrypoint,
        configPath: loaded.value.sourcePath,
      },
    ),
  };
}

export function parseWorkflow(document: string): ValidationResult<Workflow> {
  const workflowPath = resolve(process.cwd(), WORKFLOW_FILE);
  return parseWorkflowDocument(document, {
    configPath: workflowPath,
    kind: "workflow",
    promptPath: workflowPath,
  });
}

export async function loadWorkflowFile(
  path?: string,
  baseDir = process.cwd(),
): Promise<ValidationResult<Workflow>> {
  const entrypoint = resolveEntrypoint(path, baseDir);
  if (!entrypoint.ok) {
    return entrypoint;
  }
  if (entrypoint.value.kind === "io") {
    return loadIoWorkflow(entrypoint.value);
  }
  if (!existsSync(entrypoint.value.configPath)) {
    return invalidResult(
      `Missing compatibility entrypoint: ${entrypoint.value.configPath}`,
      entrypoint.value.configPath,
    );
  }
  const document = await Bun.file(entrypoint.value.configPath).text();
  return parseWorkflowDocument(document, entrypoint.value);
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
