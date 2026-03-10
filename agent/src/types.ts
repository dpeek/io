import type { AskForApproval, SandboxMode, SandboxPolicy } from "./codex-schema.js";

export type TrackerKind = "linear";
export type AgentRole = "backlog" | "execute";

export interface AgentIssue {
  blockedBy: string[];
  createdAt: string;
  description: string;
  hasChildren: boolean;
  hasParent: boolean;
  id: string;
  identifier: string;
  labels: string[];
  priority: number | null;
  projectSlug?: string;
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

export interface WorkflowEntrypoint {
  configPath: string;
  kind: "io" | "workflow";
  promptPath: string;
}

export interface IssueRoutingCondition {
  hasChildren?: boolean;
  hasParent?: boolean;
  labelsAll?: string[];
  labelsAny?: string[];
  projectSlugIn?: string[];
  stateIn?: string[];
}

export interface IssueRoutingRule {
  agent: AgentRole;
  if: IssueRoutingCondition;
  profile: string;
}

export interface IssueRoutingConfig {
  defaultAgent: AgentRole;
  defaultProfile: string;
  routing: IssueRoutingRule[];
}

export interface IssueRoutingSelection {
  agent: AgentRole;
  profile: string;
}

export interface Workflow {
  agent: AgentConfig;
  codex: CodexConfig;
  context: {
    overrides: Record<string, string>;
  };
  entrypoint: WorkflowEntrypoint;
  hooks: HookConfig;
  issues: IssueRoutingConfig;
  polling: PollingConfig;
  promptTemplate: string;
  tracker: TrackerConfig;
  workspace: {
    origin?: string;
    root: string;
  };
}

export interface WorkerContext {
  count: number;
  id: string;
  index: number;
}

export interface RenderContext {
  attempt?: number;
  issue: AgentIssue;
  selection?: IssueRoutingSelection;
  worker?: WorkerContext;
  workspace?: PreparedWorkspace;
}

export interface ValidationError {
  message: string;
  path: string;
}

export type ValidationResult<T> = { ok: true; value: T } | { errors: ValidationError[]; ok: false };

export interface PreparedWorkspace {
  branchName: string;
  controlPath: string;
  createdNow: boolean;
  originPath: string;
  outputPath?: string;
  path: string;
  runtimePath?: string;
  sourceRepoPath?: string;
  workerId: string;
}

export interface IssueRunResult {
  issue: AgentIssue;
  logPaths?: {
    eventLog: string;
    mainOutput: string;
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
