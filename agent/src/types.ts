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
  parentIssueId?: string;
  parentIssueIdentifier?: string;
  parentIssueState?: string;
  priority: number | null;
  projectSlug?: string;
  state: string;
  teamId?: string;
  title: string;
  updatedAt: string;
}

export type ManagedCommentCommandName = "backlog" | "focus" | "help" | "status";
export type ManagedCommentResult = "blocked" | "noop" | "partial" | "updated";

export interface ManagedCommentPayload {
  docs: string[];
  dryRun: boolean;
  note?: string;
}

export interface ManagedCommentCommand {
  body: string;
  bodyHash: string;
  commentId: string;
  command: ManagedCommentCommandName;
  createdAt: string;
  issue: AgentIssue;
  payload: ManagedCommentPayload;
  updatedAt: string;
}

export interface ManagedCommentParseError {
  body: string;
  bodyHash: string;
  commentId: string;
  createdAt: string;
  error: string;
  issue: AgentIssue;
  updatedAt: string;
}

export type ManagedCommentTrigger = ManagedCommentCommand | ManagedCommentParseError;

export interface ManagedCommentChildMutation {
  blockedBy: string[];
  description: string;
  docs: string[];
  labels: string[];
  priority: number | null;
  reference: string;
  state?: string;
  title: string;
}

export interface ManagedCommentReply {
  command: string;
  issueIdentifier: string;
  lines: string[];
  result: ManagedCommentResult;
}

export interface ManagedCommentMutation {
  comment: ManagedCommentTrigger;
  children: ManagedCommentChildMutation[];
  parentDescription?: string;
  reply: ManagedCommentReply;
}

export interface ManagedCommentMutationResult {
  createdChildIssueIdentifiers: string[];
  dependencyCount: number;
  replyCommentId?: string;
  result: ManagedCommentResult;
  updatedChildIssueIdentifiers: string[];
  updatedParentDescription: boolean;
  warnings: string[];
}

export interface HandledManagedComment {
  bodyHash: string;
  commentId: string;
  handledAt: string;
}

export interface ManagedCommentState {
  comments: HandledManagedComment[];
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

export interface WorkflowModule {
  allowedSharedPaths: string[];
  docs: string[];
  id: string;
  path: string;
}

export interface WorkflowContextProfile {
  include: string[];
  includeEntrypoint: boolean;
}

export type ResolvedContextDocSource =
  | "builtin"
  | "entrypoint"
  | "registered"
  | "repo-path"
  | "synthesized";

export interface ResolvedContextDoc {
  content: string;
  id: string;
  label: string;
  order: number;
  overridden: boolean;
  path?: string;
  source: ResolvedContextDocSource;
}

export interface ResolvedContextBundle {
  docs: ResolvedContextDoc[];
}

export interface Workflow {
  agent: AgentConfig;
  codex: CodexConfig;
  context: {
    docs: Record<string, string>;
    overrides: Record<string, string>;
    profiles: Record<string, WorkflowContextProfile>;
  };
  entrypoint: WorkflowEntrypoint;
  hooks: HookConfig;
  issues: IssueRoutingConfig;
  modules: Record<string, WorkflowModule>;
  polling: PollingConfig;
  entrypointContent: string;
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
  issueRuntimePath?: string;
  originPath: string;
  outputPath?: string;
  path: string;
  runtimePath?: string;
  sourceRepoPath?: string;
  streamIssueId?: string;
  streamIssueIdentifier?: string;
  streamRuntimePath?: string;
  workerId: string;
}

export interface StreamRuntimeState {
  activeIssueId?: string;
  activeIssueIdentifier?: string;
  branchName: string;
  createdAt: string;
  latestLandedCommitSha?: string;
  parentIssueId: string;
  parentIssueIdentifier: string;
  status: "active" | "completed";
  updatedAt: string;
  worktreeRoot: string;
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
  resolvedContext?: ResolvedContextBundle;
  warnings?: string[];
  workspace: PreparedWorkspace;
}

export interface IssueTracker {
  fetchCandidateIssues: () => Promise<AgentIssue[]>;
  fetchIssueStatesByIds: (issueIds: string[]) => Promise<Map<string, string>>;
  setIssueState: (issueId: string, stateName: string) => Promise<void>;
  fetchManagedCommentTriggers?: () => Promise<ManagedCommentTrigger[]>;
  applyManagedCommentMutation?: (
    mutation: ManagedCommentMutation,
  ) => Promise<ManagedCommentMutationResult>;
  updateIssueDescription?: (issueId: string, description: string) => Promise<void>;
}
