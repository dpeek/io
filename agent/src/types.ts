import type { AskForApproval, SandboxMode, SandboxPolicy } from "./codex-schema.js";

export type TrackerKind = "linear";

export interface AgentIssue {
  blockedBy: string[];
  createdAt: string;
  description: string;
  id: string;
  identifier: string;
  labels: string[];
  priority: number | null;
  state: string;
  title: string;
  updatedAt: string;
}

export interface TrackerConfig {
  activeStates: string[];
  apiKey?: string;
  endpoint: string;
  kind: TrackerKind;
  projectSlug?: string;
  terminalStates: string[];
}

export interface PollingConfig {
  intervalMs: number;
}

export interface HookConfig {
  afterCreate?: string;
  afterRun?: string;
  beforeRemove?: string;
  beforeRun?: string;
  timeoutMs: number;
}

export interface AgentConfig {
  maxConcurrentAgents: number;
  maxRetryBackoffMs: number;
  maxTurns: number;
}

export interface CodexConfig {
  approvalPolicy: AskForApproval;
  command: string;
  readTimeoutMs: number;
  stallTimeoutMs: number;
  threadSandbox: SandboxMode;
  turnSandboxPolicy?: SandboxPolicy;
  turnTimeoutMs: number;
}

export interface Workflow {
  agent: AgentConfig;
  codex: CodexConfig;
  hooks: HookConfig;
  polling: PollingConfig;
  promptTemplate: string;
  tracker: TrackerConfig;
  workspace: {
    root: string;
  };
}

export interface RenderContext {
  attempt?: number;
  issue: AgentIssue;
}

export interface ValidationError {
  message: string;
  path: string;
}

export type ValidationResult<T> = { ok: true; value: T } | { errors: ValidationError[]; ok: false };

export interface PreparedWorkspace {
  branchName: string;
  createdNow: boolean;
  path: string;
  workspaceKey: string;
}

export interface IssueRunResult {
  issue: AgentIssue;
  logPaths?: {
    eventLog: string;
    stderrLog: string;
    stdoutLog: string;
  };
  prompt: string;
  sessionId?: string;
  stderr: string[];
  stdout: string[];
  success: boolean;
  threadId?: string;
  turnId?: string;
  workspace: PreparedWorkspace;
}
