import { createLogger } from "@io/lib";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import z from "zod";
import { toId } from "./util.js";

import type { AskForApproval, SandboxMode, SandboxPolicy } from "./codex-schema.js";
import type { RenderContext, ValidationResult, Workflow } from "./types.js";

const log = createLogger({ pkg: "agent" });

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

const workflowSchema = z
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
      root: z.string().default("$SYMPHONY_WORKSPACE_ROOT"),
    }),
  })
  .passthrough();

type WorkflowFrontMatter = z.infer<typeof workflowSchema>;

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

function expandPathValue(value: string) {
  const envExpanded = expandEnv(value) ?? value;
  const tildeExpanded = envExpanded.startsWith("~/")
    ? resolve(homedir(), envExpanded.slice(2))
    : envExpanded === "~"
      ? homedir()
      : envExpanded;
  return isAbsolute(tildeExpanded) ? tildeExpanded : resolve(process.cwd(), tildeExpanded);
}

function buildWorkflow(frontMatter: WorkflowFrontMatter, promptTemplate: string): Workflow {
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
    promptTemplate,
    tracker: {
      activeStates: normalizeStates(frontMatter.tracker.active_states),
      apiKey: expandEnv(frontMatter.tracker.api_key) ?? expandEnv("$LINEAR_API_KEY"),
      endpoint: frontMatter.tracker.endpoint,
      kind: frontMatter.tracker.kind,
      projectSlug: expandEnv(frontMatter.tracker.project_slug),
      terminalStates: normalizeStates(frontMatter.tracker.terminal_states),
    },
    workspace: {
      root: expandPathValue(frontMatter.workspace.root),
    },
  };
}

function normalizeStates(value: string[] | string) {
  const list = Array.isArray(value) ? value : value.split(",");
  return list.map((entry) => entry.trim()).filter(Boolean);
}

function mapIssues(issues: z.ZodIssue[]) {
  return issues.map((issue) => ({
    message: issue.message,
    path: issue.path.join(".") || "$",
  }));
}

export function parseWorkflow(document: string): ValidationResult<Workflow> {
  try {
    const { configText, promptTemplate } = splitFrontMatter(document);
    const rawConfig = configText ? parseYaml(configText) : {};
    if (rawConfig != null && typeof rawConfig !== "object") {
      return {
        errors: [{ message: "Workflow front matter must decode to an object", path: "$" }],
        ok: false,
      };
    }
    const result = workflowSchema.safeParse(rawConfig ?? {});
    if (!result.success) {
      return { errors: mapIssues(result.error.issues), ok: false };
    }
    if (!promptTemplate) {
      return {
        errors: [{ message: "Workflow prompt body must not be empty", path: "promptTemplate" }],
        ok: false,
      };
    }
    return { ok: true, value: buildWorkflow(result.data, promptTemplate) };
  } catch (error) {
    log.error("workflow.parse_failed", error instanceof Error ? error : new Error(String(error)));
    return {
      errors: [{ message: error instanceof Error ? error.message : String(error), path: "$" }],
      ok: false,
    };
  }
}

export async function loadWorkflowFile(path: string): Promise<ValidationResult<Workflow>> {
  const document = await Bun.file(path).text();
  return parseWorkflow(document);
}

function lookupValue(context: Record<string, unknown>, path: string) {
  return path.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object" || !(part in current)) {
      throw new Error(`Unknown workflow template variable: ${path}`);
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
