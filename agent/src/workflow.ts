import { createLogger } from "@io/lib";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import z from "zod";

import type { AskForApproval, SandboxMode, SandboxPolicy } from "./codex-schema.js";
import type {
  RenderContext,
  ValidationResult,
  Workflow,
  WorkflowEntrypoint,
} from "./types.js";

import { toId } from "./util.js";

const log = createLogger({ pkg: "agent" });

const IO_CONFIG_FILE = "io.json";
const IO_PROMPT_FILE = "io.md";
const WORKFLOW_FILE = "WORKFLOW.md";
const IO_RUNTIME_KEYS = ["agent", "codex", "hooks", "polling", "tracker", "workspace"] as const;

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
    polling: z
      .object({
        intervalMs: z.coerce.number().int().positive().default(30_000),
      })
      .default({ intervalMs: 30_000 }),
    tracker: z.object({
      activeStates: stateListSchema.default(["Todo"]),
      apiKey: z.string().optional(),
      endpoint: z.string().url().default("https://api.linear.app/graphql"),
      kind: z.literal("linear").default("linear"),
      projectSlug: z.string().optional(),
      terminalStates: stateListSchema.default([
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

type IoConfig = z.infer<typeof ioConfigSchema>;
type WorkflowFrontMatter = z.infer<typeof workflowFrontMatterSchema>;
type WorkflowConfigFields = Pick<
  Workflow,
  "agent" | "codex" | "hooks" | "polling" | "tracker" | "workspace"
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function hasIoRuntimeConfig(value: Record<string, unknown>) {
  return IO_RUNTIME_KEYS.some((key) => key in value);
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

function normalizeIoConfig(config: IoConfig, baseDir: string): WorkflowConfigFields {
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
    hooks: {
      afterCreate: config.hooks.afterCreate,
      afterRun: config.hooks.afterRun,
      beforeRemove: config.hooks.beforeRemove,
      beforeRun: config.hooks.beforeRun,
      timeoutMs: config.hooks.timeoutMs,
    },
    polling: {
      intervalMs: config.polling.intervalMs,
    },
    tracker: {
      activeStates: normalizeStates(config.tracker.activeStates),
      apiKey: expandEnv(config.tracker.apiKey) ?? expandEnv("$LINEAR_API_KEY"),
      endpoint: config.tracker.endpoint,
      kind: config.tracker.kind,
      projectSlug: expandEnv(config.tracker.projectSlug) ?? expandEnv("$LINEAR_PROJECT_SLUG"),
      terminalStates: normalizeStates(config.tracker.terminalStates),
    },
    workspace: {
      origin: config.workspace.origin ? expandPathValue(config.workspace.origin, baseDir) : undefined,
      root: expandPathValue(config.workspace.root, baseDir),
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
    hooks: {
      afterCreate: frontMatter.hooks.after_create,
      afterRun: frontMatter.hooks.after_run,
      beforeRemove: frontMatter.hooks.before_remove,
      beforeRun: frontMatter.hooks.before_run,
      timeoutMs: frontMatter.hooks.timeout_ms,
    },
    polling: {
      intervalMs: frontMatter.polling.interval_ms,
    },
    tracker: {
      activeStates: normalizeStates(frontMatter.tracker.active_states),
      apiKey: expandEnv(frontMatter.tracker.api_key) ?? expandEnv("$LINEAR_API_KEY"),
      endpoint: frontMatter.tracker.endpoint,
      kind: frontMatter.tracker.kind,
      projectSlug:
        expandEnv(frontMatter.tracker.project_slug) ?? expandEnv("$LINEAR_PROJECT_SLUG"),
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

function resolveEntrypoint(path: string | undefined, baseDir: string): ValidationResult<WorkflowEntrypoint> {
  if (path) {
    const absolutePath = isAbsolute(path) ? path : resolve(baseDir, path);
    const filename = basename(absolutePath);
    if (filename === IO_CONFIG_FILE) {
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
          configPath: resolve(dirname(absolutePath), IO_CONFIG_FILE),
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
      `Unsupported entrypoint path: ${path}. Expected ${IO_CONFIG_FILE}, ${IO_PROMPT_FILE}, or ${WORKFLOW_FILE}`,
    );
  }

  const ioConfigPath = resolve(baseDir, IO_CONFIG_FILE);
  const ioPromptPath = resolve(baseDir, IO_PROMPT_FILE);
  const workflowPath = resolve(baseDir, WORKFLOW_FILE);
  const hasIoConfig = existsSync(ioConfigPath);
  const hasIoPrompt = existsSync(ioPromptPath);

  if (hasIoConfig) {
    return {
      ok: true,
      value: {
        configPath: ioConfigPath,
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
      `Incomplete IO entrypoints. Expected both ${IO_CONFIG_FILE} and ${IO_PROMPT_FILE}, or fall back to ${WORKFLOW_FILE} during migration.`,
    );
  }
  return invalidResult(
    `No agent entrypoint found. Add ${IO_CONFIG_FILE} and ${IO_PROMPT_FILE}, or keep ${WORKFLOW_FILE} during migration.`,
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
  if (!existsSync(entrypoint.configPath)) {
    return invalidResult(`Missing config entrypoint: ${entrypoint.configPath}`, entrypoint.configPath);
  }

  try {
    const rawConfig = JSON.parse(await Bun.file(entrypoint.configPath).text()) as unknown;
    if (!isRecord(rawConfig)) {
      return invalidResult("io.json must decode to an object", entrypoint.configPath);
    }
    if (!hasIoRuntimeConfig(rawConfig)) {
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
        `io.json does not contain agent runtime config: ${entrypoint.configPath}`,
        entrypoint.configPath,
      );
    }
    const result = ioConfigSchema.safeParse(rawConfig);
    if (!result.success) {
      return { errors: mapIssues(result.error.issues), ok: false };
    }
    const promptTemplate = await loadPromptTemplate(entrypoint.promptPath);
    if (!promptTemplate.ok) {
      return promptTemplate;
    }
    return {
      ok: true,
      value: buildWorkflow(
        normalizeIoConfig(result.data, dirname(entrypoint.configPath)),
        promptTemplate.value,
        entrypoint,
      ),
    };
  } catch (error) {
    log.error("workflow.parse_failed", error instanceof Error ? error : new Error(String(error)));
    return invalidResult(
      error instanceof Error ? error.message : String(error),
      entrypoint.configPath,
    );
  }
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
