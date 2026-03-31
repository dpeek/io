import { defineEnum, defineType } from "@io/graph-module";
import { existingEntityReferenceField } from "@io/graph-module";
import { defineDefaultEnumTypeModule } from "@io/graph-module";
import {
  booleanTypeModule,
  core,
  dateTypeModule,
  jsonTypeModule,
  numberTypeModule,
  stringTypeModule,
} from "@io/graph-module-core";

import { document } from "./document.js";

function resolvedEnumValue(value: { key: string; id?: string }): string {
  return value.id ?? value.key;
}

function validateRequiredString(label: string, value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? undefined
    : {
        code: "string.blank",
        message: `${label} must not be blank.`,
      };
}

function validateOptionalString(label: string, value: unknown) {
  return value === undefined ? undefined : validateRequiredString(label, value);
}

function validateOptionalSha(label: string, value: unknown) {
  const required = validateOptionalString(label, value);
  if (required || value === undefined) return required;
  const sha = value as string;
  return /^[0-9a-f]{7,64}$/i.test(sha)
    ? undefined
    : {
        code: "workflow.sha.invalid",
        message: `${label} must be a hexadecimal git object id.`,
      };
}

function validateNonNegativeInteger(label: string, value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? undefined
    : {
        code: "workflow.integer.invalid",
        message: `${label} must be a non-negative integer.`,
      };
}

function buildWorkflowKeyPattern(prefix: string): RegExp {
  return new RegExp(`^${prefix}:[a-z0-9]+(?:-[a-z0-9]+)*$`);
}

function buildWorkflowKeyInvalidMessage(label: string, prefix: string): string {
  return `${label} must start with "${prefix}:" and use only lowercase letters, numbers, and hyphen-separated segments.`;
}

function validateWorkflowKey(label: string, prefix: string, value: unknown) {
  const required = validateRequiredString(label, value);
  if (required) return required;
  const workflowKey = value as string;
  return buildWorkflowKeyPattern(prefix).test(workflowKey)
    ? undefined
    : {
        code: "workflow.key.invalid",
        message: buildWorkflowKeyInvalidMessage(label, prefix),
      };
}

function requiredStringField(
  label: string,
  input?: {
    description?: string;
    multiline?: boolean;
    defaultOperator?: "contains" | "equals" | "prefix";
    operators?: readonly ["contains", "equals"] | readonly ["equals", "prefix"];
  },
) {
  return stringTypeModule.field({
    cardinality: "one",
    validate: ({ value }) => validateRequiredString(label, value),
    meta: {
      label,
      ...(input?.description ? { description: input.description } : {}),
      ...(input?.multiline
        ? {
            editor: {
              kind: "textarea",
              multiline: true,
            },
          }
        : {}),
    },
    filter: {
      operators: input?.operators ?? (["equals", "prefix"] as const),
      defaultOperator: input?.defaultOperator ?? "equals",
    },
  });
}

function optionalStringField(
  label: string,
  input?: {
    description?: string;
    multiline?: boolean;
    defaultOperator?: "contains" | "equals" | "prefix";
    operators?: readonly ["contains", "equals"] | readonly ["equals", "prefix"];
  },
) {
  return stringTypeModule.field({
    cardinality: "one?",
    validate: ({ value }) => validateOptionalString(label, value),
    meta: {
      label,
      ...(input?.description ? { description: input.description } : {}),
      ...(input?.multiline
        ? {
            editor: {
              kind: "textarea",
              multiline: true,
            },
          }
        : {}),
    },
    filter: {
      operators: input?.operators ?? (["equals", "prefix"] as const),
      defaultOperator: input?.defaultOperator ?? "equals",
    },
  });
}

function workflowKeyField(label: string, prefix: string, description?: string) {
  return stringTypeModule.field({
    cardinality: "one",
    validate: ({ value }) => validateWorkflowKey(label, prefix, value),
    meta: {
      label,
      ...(description ? { description } : {}),
    },
    filter: {
      operators: ["equals", "prefix"] as const,
      defaultOperator: "equals",
    },
  });
}

function titleNodeFields(label: string) {
  return {
    ...core.node.fields,
    name: {
      ...core.node.fields.name,
      meta: {
        ...core.node.fields.name.meta,
        label,
      },
    },
  };
}

export const projectKeyPattern = buildWorkflowKeyPattern("project");
export const repositoryKeyPattern = buildWorkflowKeyPattern("repo");
export const branchKeyPattern = buildWorkflowKeyPattern("branch");
export const commitKeyPattern = buildWorkflowKeyPattern("commit");
export const agentSessionKeyPattern = buildWorkflowKeyPattern("session");
export const contextBundleKeyPattern = buildWorkflowKeyPattern("bundle");

export const project = defineType({
  values: { key: "workflow:project", name: "Project" },
  fields: {
    ...titleNodeFields("Project title"),
    projectKey: workflowKeyField(
      "Project key",
      "project",
      "Stable operator-facing project key. Branch 6 still models one logical project per graph.",
    ),
    inferred: {
      ...booleanTypeModule.field({
        cardinality: "one",
        onCreate: ({ incoming }) => incoming ?? true,
        meta: {
          label: "Inferred",
        },
      }),
      createOptional: true as const,
    },
  },
});

export const repository = defineType({
  values: { key: "workflow:repository", name: "Repository" },
  fields: {
    ...titleNodeFields("Repository title"),
    project: existingEntityReferenceField(project, {
      cardinality: "one",
      label: "Project",
    }),
    repositoryKey: workflowKeyField(
      "Repository key",
      "repo",
      "Stable repository key. Branch 6 v1 still supports one attached repository per project.",
    ),
    repoRoot: requiredStringField("Repository root", {
      defaultOperator: "prefix",
    }),
    defaultBaseBranch: requiredStringField("Default base branch"),
    mainRemoteName: optionalStringField("Main remote name"),
  },
});

export const branchState = defineEnum({
  values: { key: "workflow:branchState", name: "Branch State" },
  options: {
    backlog: {
      name: "Backlog",
    },
    ready: {
      name: "Ready",
    },
    active: {
      name: "Active",
    },
    blocked: {
      name: "Blocked",
    },
    done: {
      name: "Done",
    },
    archived: {
      name: "Archived",
    },
  },
});

export const branchStateTypeModule = defineDefaultEnumTypeModule(branchState);

export const branch = defineType({
  values: { key: "workflow:branch", name: "Branch" },
  fields: {
    ...titleNodeFields("Branch title"),
    project: existingEntityReferenceField(project, {
      cardinality: "one",
      label: "Project",
    }),
    branchKey: workflowKeyField("Branch key", "branch"),
    state: {
      ...branchStateTypeModule.field({
        cardinality: "one",
        onCreate: ({ incoming }) => incoming ?? resolvedEnumValue(branchState.values.backlog),
        meta: {
          label: "State",
          display: {
            kind: "badge",
          },
        },
        filter: {
          operators: ["is", "oneOf"] as const,
          defaultOperator: "is",
        },
      }),
      createOptional: true as const,
    },
    queueRank: numberTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Queue rank",
      },
    }),
    goalDocument: existingEntityReferenceField(document, {
      cardinality: "one?",
      label: "Goal document",
    }),
    contextDocument: existingEntityReferenceField(document, {
      cardinality: "one?",
      label: "Context document",
    }),
    activeCommit: existingEntityReferenceField("workflow:commit", {
      cardinality: "one?",
      label: "Active commit",
    }),
  },
});

export const commitState = defineEnum({
  values: { key: "workflow:commitState", name: "Commit State" },
  options: {
    planned: {
      name: "Planned",
    },
    ready: {
      name: "Ready",
    },
    active: {
      name: "Active",
    },
    blocked: {
      name: "Blocked",
    },
    committed: {
      name: "Committed",
    },
    dropped: {
      name: "Dropped",
    },
  },
});

export const commitStateTypeModule = defineDefaultEnumTypeModule(commitState);

export const commit = defineType({
  values: { key: "workflow:commit", name: "Commit" },
  fields: {
    ...titleNodeFields("Commit title"),
    branch: existingEntityReferenceField(branch, {
      cardinality: "one",
      label: "Branch",
    }),
    commitKey: workflowKeyField("Commit key", "commit"),
    state: {
      ...commitStateTypeModule.field({
        cardinality: "one",
        onCreate: ({ incoming }) => incoming ?? resolvedEnumValue(commitState.values.planned),
        meta: {
          label: "State",
          display: {
            kind: "badge",
          },
        },
        filter: {
          operators: ["is", "oneOf"] as const,
          defaultOperator: "is",
        },
      }),
      createOptional: true as const,
    },
    order: numberTypeModule.field({
      cardinality: "one",
      validate: ({ value }) => validateNonNegativeInteger("Commit order", value),
      meta: {
        label: "Order",
      },
    }),
    parentCommit: existingEntityReferenceField("workflow:commit", {
      cardinality: "one?",
      excludeSubject: true,
      label: "Parent commit",
    }),
    contextDocument: existingEntityReferenceField(document, {
      cardinality: "one?",
      label: "Context document",
    }),
  },
});

export const repositoryCommitState = defineEnum({
  values: { key: "workflow:repositoryCommitState", name: "Repository Commit State" },
  options: {
    planned: {
      name: "Planned",
    },
    reserved: {
      name: "Reserved",
    },
    attached: {
      name: "Attached",
    },
    committed: {
      name: "Committed",
    },
    observed: {
      name: "Observed",
    },
  },
});

export const repositoryCommitStateTypeModule = defineDefaultEnumTypeModule(repositoryCommitState);

export const repositoryCommitLeaseState = defineEnum({
  values: {
    key: "workflow:repositoryCommitLeaseState",
    name: "Repository Commit Lease State",
  },
  options: {
    unassigned: {
      name: "Unassigned",
    },
    reserved: {
      name: "Reserved",
    },
    attached: {
      name: "Attached",
    },
    released: {
      name: "Released",
    },
  },
});

export const repositoryCommitLeaseStateTypeModule = defineDefaultEnumTypeModule(
  repositoryCommitLeaseState,
);

export const repositoryBranch = defineType({
  values: { key: "workflow:repositoryBranch", name: "Repository Branch" },
  fields: {
    ...titleNodeFields("Repository branch title"),
    project: existingEntityReferenceField(project, {
      cardinality: "one",
      label: "Project",
    }),
    repository: existingEntityReferenceField(repository, {
      cardinality: "one",
      label: "Repository",
    }),
    branch: existingEntityReferenceField(branch, {
      cardinality: "one?",
      label: "Workflow branch",
    }),
    managed: {
      ...booleanTypeModule.field({
        cardinality: "one",
        onCreate: ({ incoming }) => incoming ?? false,
        meta: {
          label: "Managed",
        },
      }),
      createOptional: true as const,
    },
    branchName: requiredStringField("Branch name"),
    baseBranchName: requiredStringField("Base branch name"),
    upstreamName: optionalStringField("Upstream name"),
    headSha: stringTypeModule.field({
      cardinality: "one?",
      validate: ({ value }) => validateOptionalSha("Head SHA", value),
      meta: {
        label: "Head SHA",
      },
      filter: {
        operators: ["equals", "prefix"] as const,
        defaultOperator: "prefix",
      },
    }),
    worktreePath: optionalStringField("Worktree path", {
      defaultOperator: "prefix",
    }),
    latestReconciledAt: dateTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Latest reconciled at",
      },
    }),
  },
});

export const repositoryCommit = defineType({
  values: { key: "workflow:repositoryCommit", name: "Repository Commit" },
  fields: {
    ...titleNodeFields("Repository commit title"),
    repository: existingEntityReferenceField(repository, {
      cardinality: "one",
      label: "Repository",
    }),
    repositoryBranch: existingEntityReferenceField(repositoryBranch, {
      cardinality: "one?",
      label: "Repository branch",
    }),
    commit: existingEntityReferenceField(commit, {
      cardinality: "one?",
      label: "Workflow commit",
    }),
    state: {
      ...repositoryCommitStateTypeModule.field({
        cardinality: "one",
        onCreate: ({ incoming }) =>
          incoming ?? resolvedEnumValue(repositoryCommitState.values.planned),
        meta: {
          label: "State",
          display: {
            kind: "badge",
          },
        },
        filter: {
          operators: ["is", "oneOf"] as const,
          defaultOperator: "is",
        },
      }),
      createOptional: true as const,
    },
    worktree: {
      path: optionalStringField("Worktree path", {
        defaultOperator: "prefix",
      }),
      branchName: optionalStringField("Worktree branch name"),
      leaseState: {
        ...repositoryCommitLeaseStateTypeModule.field({
          cardinality: "one",
          onCreate: ({ incoming }) =>
            incoming ?? resolvedEnumValue(repositoryCommitLeaseState.values.unassigned),
          meta: {
            label: "Worktree lease state",
            display: {
              kind: "badge",
            },
          },
          filter: {
            operators: ["is", "oneOf"] as const,
            defaultOperator: "is",
          },
        }),
        createOptional: true as const,
      },
    },
    sha: stringTypeModule.field({
      cardinality: "one?",
      validate: ({ value }) => validateOptionalSha("Commit SHA", value),
      meta: {
        label: "Commit SHA",
      },
      filter: {
        operators: ["equals", "prefix"] as const,
        defaultOperator: "prefix",
      },
    }),
    committedAt: dateTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Committed at",
      },
    }),
  },
});

export const agentSessionSubjectKind = defineEnum({
  values: {
    key: "workflow:agentSessionSubjectKind",
    name: "Agent Session Subject Kind",
  },
  options: {
    branch: {
      name: "Branch",
    },
    commit: {
      name: "Commit",
    },
  },
});

export const agentSessionSubjectKindTypeModule =
  defineDefaultEnumTypeModule(agentSessionSubjectKind);

export const agentSessionKind = defineEnum({
  values: { key: "workflow:agentSessionKind", name: "Agent Session Kind" },
  options: {
    planning: {
      name: "Planning",
    },
    execution: {
      name: "Execution",
    },
    review: {
      name: "Review",
    },
  },
});

export const agentSessionKindTypeModule = defineDefaultEnumTypeModule(agentSessionKind);

export const agentSessionRuntimeState = defineEnum({
  values: {
    key: "workflow:agentSessionRuntimeState",
    name: "Agent Session Runtime State",
  },
  options: {
    running: {
      name: "Running",
    },
    "awaiting-user-input": {
      name: "Awaiting User Input",
    },
    blocked: {
      name: "Blocked",
    },
    completed: {
      name: "Completed",
    },
    failed: {
      name: "Failed",
    },
    cancelled: {
      name: "Cancelled",
    },
  },
});

export const agentSessionRuntimeStateTypeModule =
  defineDefaultEnumTypeModule(agentSessionRuntimeState);

export const agentSession = defineType({
  values: { key: "workflow:agentSession", name: "Agent Session" },
  fields: {
    ...titleNodeFields("Session title"),
    project: existingEntityReferenceField(project, {
      cardinality: "one",
      label: "Project",
    }),
    repository: existingEntityReferenceField(repository, {
      cardinality: "one?",
      label: "Repository",
    }),
    subjectKind: agentSessionSubjectKindTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Subject kind",
        display: {
          kind: "badge",
        },
      },
      filter: {
        operators: ["is", "oneOf"] as const,
        defaultOperator: "is",
      },
    }),
    branch: existingEntityReferenceField(branch, {
      cardinality: "one",
      label: "Branch",
    }),
    commit: existingEntityReferenceField(commit, {
      cardinality: "one?",
      label: "Commit",
    }),
    sessionKey: workflowKeyField(
      "Session key",
      "session",
      "Stable session key within one workflow project.",
    ),
    kind: agentSessionKindTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Kind",
        display: {
          kind: "badge",
        },
      },
      filter: {
        operators: ["is", "oneOf"] as const,
        defaultOperator: "is",
      },
    }),
    workerId: requiredStringField("Worker id"),
    threadId: optionalStringField("Thread id"),
    turnId: optionalStringField("Turn id"),
    runtimeState: {
      ...agentSessionRuntimeStateTypeModule.field({
        cardinality: "one",
        onCreate: ({ incoming }) =>
          incoming ?? resolvedEnumValue(agentSessionRuntimeState.values.running),
        meta: {
          label: "Runtime state",
          display: {
            kind: "badge",
          },
        },
        filter: {
          operators: ["is", "oneOf"] as const,
          defaultOperator: "is",
        },
      }),
      createOptional: true as const,
    },
    contextBundle: existingEntityReferenceField("workflow:contextBundle", {
      cardinality: "one?",
      label: "Context bundle",
    }),
    startedAt: {
      ...dateTypeModule.field({
        cardinality: "one",
        onCreate: ({ incoming, now }) => incoming ?? now,
        meta: {
          label: "Started at",
        },
      }),
      createOptional: true as const,
    },
    endedAt: dateTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Ended at",
      },
    }),
  },
});

export const agentSessionEventType = defineEnum({
  values: { key: "workflow:agentSessionEventType", name: "Agent Session Event Type" },
  options: {
    session: {
      name: "Session",
    },
    status: {
      name: "Status",
    },
    "raw-line": {
      name: "Raw line",
    },
    "codex-notification": {
      name: "Codex notification",
    },
  },
});

export const agentSessionEventTypeTypeModule = defineDefaultEnumTypeModule(agentSessionEventType);

export const agentSessionEventPhase = defineEnum({
  values: {
    key: "workflow:agentSessionEventPhase",
    name: "Agent Session Event Phase",
  },
  options: {
    scheduled: {
      name: "Scheduled",
    },
    started: {
      name: "Started",
    },
    completed: {
      name: "Completed",
    },
    failed: {
      name: "Failed",
    },
    stopped: {
      name: "Stopped",
    },
  },
});

export const agentSessionEventPhaseTypeModule = defineDefaultEnumTypeModule(agentSessionEventPhase);

export const agentSessionStatusCode = defineEnum({
  values: { key: "workflow:agentSessionStatusCode", name: "Agent Session Status Code" },
  options: {
    ready: {
      name: "Ready",
    },
    idle: {
      name: "Idle",
    },
    "workflow-diagnostic": {
      name: "Workflow diagnostic",
    },
    "issue-assigned": {
      name: "Issue assigned",
    },
    "issue-blocked": {
      name: "Issue blocked",
    },
    "issue-committed": {
      name: "Issue committed",
    },
    "branch-selected": {
      name: "Branch selected",
    },
    "commit-selected": {
      name: "Commit selected",
    },
    "branch-blocked": {
      name: "Branch blocked",
    },
    "commit-blocked": {
      name: "Commit blocked",
    },
    "commit-created": {
      name: "Commit created",
    },
    "commit-finalized": {
      name: "Commit finalized",
    },
    "thread-started": {
      name: "Thread started",
    },
    "turn-started": {
      name: "Turn started",
    },
    "turn-completed": {
      name: "Turn completed",
    },
    "turn-cancelled": {
      name: "Turn cancelled",
    },
    "turn-failed": {
      name: "Turn failed",
    },
    "waiting-on-user-input": {
      name: "Waiting on user input",
    },
    "agent-message-delta": {
      name: "Agent message delta",
    },
    "agent-message-completed": {
      name: "Agent message completed",
    },
    command: {
      name: "Command",
    },
    "command-output": {
      name: "Command output",
    },
    "command-failed": {
      name: "Command failed",
    },
    "approval-required": {
      name: "Approval required",
    },
    tool: {
      name: "Tool",
    },
    "tool-failed": {
      name: "Tool failed",
    },
    error: {
      name: "Error",
    },
  },
});

export const agentSessionStatusCodeTypeModule = defineDefaultEnumTypeModule(agentSessionStatusCode);

export const agentSessionStatusFormat = defineEnum({
  values: {
    key: "workflow:agentSessionStatusFormat",
    name: "Agent Session Status Format",
  },
  options: {
    line: {
      name: "Line",
    },
    chunk: {
      name: "Chunk",
    },
    close: {
      name: "Close",
    },
  },
});

export const agentSessionStatusFormatTypeModule =
  defineDefaultEnumTypeModule(agentSessionStatusFormat);

export const agentSessionStream = defineEnum({
  values: { key: "workflow:agentSessionStream", name: "Agent Session Branch" },
  options: {
    stdout: {
      name: "Stdout",
    },
    stderr: {
      name: "Stderr",
    },
  },
});

export const agentSessionStreamTypeModule = defineDefaultEnumTypeModule(agentSessionStream);

export const agentSessionRawLineEncoding = defineEnum({
  values: {
    key: "workflow:agentSessionRawLineEncoding",
    name: "Agent Session Raw Line Encoding",
  },
  options: {
    jsonl: {
      name: "JSONL",
    },
    text: {
      name: "Text",
    },
  },
});

export const agentSessionRawLineEncodingTypeModule = defineDefaultEnumTypeModule(
  agentSessionRawLineEncoding,
);

export const agentSessionEvent = defineType({
  values: { key: "workflow:agentSessionEvent", name: "Agent Session Event" },
  fields: {
    ...titleNodeFields("Event title"),
    session: existingEntityReferenceField(agentSession, {
      cardinality: "one",
      label: "Session",
    }),
    type: agentSessionEventTypeTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Type",
        display: {
          kind: "badge",
        },
      },
      filter: {
        operators: ["is", "oneOf"] as const,
        defaultOperator: "is",
      },
    }),
    sequence: numberTypeModule.field({
      cardinality: "one",
      validate: ({ value }) => validateNonNegativeInteger("Event sequence", value),
      meta: {
        label: "Sequence",
      },
    }),
    timestamp: {
      ...dateTypeModule.field({
        cardinality: "one",
        onCreate: ({ incoming, now }) => incoming ?? now,
        meta: {
          label: "Timestamp",
        },
      }),
      createOptional: true as const,
    },
    phase: agentSessionEventPhaseTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Phase",
        display: {
          kind: "badge",
        },
      },
      filter: {
        operators: ["is", "oneOf"] as const,
        defaultOperator: "is",
      },
    }),
    statusCode: agentSessionStatusCodeTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Status code",
        display: {
          kind: "badge",
        },
      },
      filter: {
        operators: ["is", "oneOf"] as const,
        defaultOperator: "is",
      },
    }),
    format: agentSessionStatusFormatTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Format",
        display: {
          kind: "badge",
        },
      },
      filter: {
        operators: ["is", "oneOf"] as const,
        defaultOperator: "is",
      },
    }),
    stream: agentSessionStreamTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Branch",
        display: {
          kind: "badge",
        },
      },
      filter: {
        operators: ["is", "oneOf"] as const,
        defaultOperator: "is",
      },
    }),
    encoding: agentSessionRawLineEncodingTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Encoding",
        display: {
          kind: "badge",
        },
      },
      filter: {
        operators: ["is", "oneOf"] as const,
        defaultOperator: "is",
      },
    }),
    itemId: optionalStringField("Item id"),
    text: optionalStringField("Text", {
      multiline: true,
      operators: ["contains", "equals"] as const,
      defaultOperator: "contains",
    }),
    line: optionalStringField("Line", {
      multiline: true,
      operators: ["contains", "equals"] as const,
      defaultOperator: "contains",
    }),
    data: jsonTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Data",
      },
    }),
    method: optionalStringField("Method"),
    params: jsonTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Params",
      },
    }),
  },
});

export const artifactKind = defineEnum({
  values: { key: "workflow:artifactKind", name: "Artifact Kind" },
  options: {
    "branch-plan": {
      name: "Branch plan",
    },
    "commit-plan": {
      name: "Commit plan",
    },
    patch: {
      name: "Patch",
    },
    doc: {
      name: "Document",
    },
    summary: {
      name: "Summary",
    },
    "command-log": {
      name: "Command log",
    },
    screenshot: {
      name: "Screenshot",
    },
    file: {
      name: "File",
    },
    transcript: {
      name: "Transcript",
    },
  },
});

export const artifactKindTypeModule = defineDefaultEnumTypeModule(artifactKind);

export const artifact = defineType({
  values: { key: "workflow:artifact", name: "Artifact" },
  fields: {
    ...titleNodeFields("Artifact title"),
    project: existingEntityReferenceField(project, {
      cardinality: "one",
      label: "Project",
    }),
    repository: existingEntityReferenceField(repository, {
      cardinality: "one?",
      label: "Repository",
    }),
    branch: existingEntityReferenceField(branch, {
      cardinality: "one",
      label: "Branch",
    }),
    commit: existingEntityReferenceField(commit, {
      cardinality: "one?",
      label: "Commit",
    }),
    session: existingEntityReferenceField(agentSession, {
      cardinality: "one",
      label: "Session",
    }),
    kind: artifactKindTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Kind",
        display: {
          kind: "badge",
        },
      },
      filter: {
        operators: ["is", "oneOf"] as const,
        defaultOperator: "is",
      },
    }),
    mimeType: optionalStringField("MIME type"),
    bodyText: optionalStringField("Body text", {
      multiline: true,
      operators: ["contains", "equals"] as const,
      defaultOperator: "contains",
    }),
    blobId: optionalStringField("Blob id"),
  },
});

export const decisionKind = defineEnum({
  values: { key: "workflow:decisionKind", name: "Decision Kind" },
  options: {
    plan: {
      name: "Plan",
    },
    question: {
      name: "Question",
    },
    assumption: {
      name: "Assumption",
    },
    blocker: {
      name: "Blocker",
    },
    resolution: {
      name: "Resolution",
    },
  },
});

export const decisionKindTypeModule = defineDefaultEnumTypeModule(decisionKind);

export const decision = defineType({
  values: { key: "workflow:decision", name: "Decision" },
  fields: {
    ...titleNodeFields("Decision summary"),
    project: existingEntityReferenceField(project, {
      cardinality: "one",
      label: "Project",
    }),
    repository: existingEntityReferenceField(repository, {
      cardinality: "one?",
      label: "Repository",
    }),
    branch: existingEntityReferenceField(branch, {
      cardinality: "one",
      label: "Branch",
    }),
    commit: existingEntityReferenceField(commit, {
      cardinality: "one?",
      label: "Commit",
    }),
    session: existingEntityReferenceField(agentSession, {
      cardinality: "one",
      label: "Session",
    }),
    kind: decisionKindTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Kind",
        display: {
          kind: "badge",
        },
      },
      filter: {
        operators: ["is", "oneOf"] as const,
        defaultOperator: "is",
      },
    }),
    details: optionalStringField("Details", {
      multiline: true,
      operators: ["contains", "equals"] as const,
      defaultOperator: "contains",
    }),
  },
});

export const contextBundle = defineType({
  values: { key: "workflow:contextBundle", name: "Context Bundle" },
  fields: {
    ...titleNodeFields("Context bundle title"),
    session: existingEntityReferenceField(agentSession, {
      cardinality: "one",
      label: "Session",
    }),
    subjectKind: agentSessionSubjectKindTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Subject kind",
        display: {
          kind: "badge",
        },
      },
      filter: {
        operators: ["is", "oneOf"] as const,
        defaultOperator: "is",
      },
    }),
    branch: existingEntityReferenceField(branch, {
      cardinality: "one",
      label: "Branch",
    }),
    commit: existingEntityReferenceField(commit, {
      cardinality: "one?",
      label: "Commit",
    }),
    bundleKey: workflowKeyField(
      "Bundle key",
      "bundle",
      "Immutable bundle key that is unique within one session.",
    ),
    renderedPrompt: optionalStringField("Rendered prompt", {
      multiline: true,
      operators: ["contains", "equals"] as const,
      defaultOperator: "contains",
    }),
    sourceHash: requiredStringField("Source hash"),
  },
});

export const contextBundleEntrySource = defineEnum({
  values: {
    key: "workflow:contextBundleEntrySource",
    name: "Context Bundle Entry Source",
  },
  options: {
    builtin: {
      name: "Built-in",
    },
    entrypoint: {
      name: "Entrypoint",
    },
    registered: {
      name: "Registered",
    },
    document: {
      name: "Document",
    },
    "repo-path": {
      name: "Repo path",
    },
    synthesized: {
      name: "Synthesized",
    },
    graph: {
      name: "Graph",
    },
    artifact: {
      name: "Artifact",
    },
    decision: {
      name: "Decision",
    },
  },
});

export const contextBundleEntrySourceTypeModule =
  defineDefaultEnumTypeModule(contextBundleEntrySource);

export const contextBundleEntry = defineType({
  values: { key: "workflow:contextBundleEntry", name: "Context Bundle Entry" },
  fields: {
    ...titleNodeFields("Context entry title"),
    bundle: existingEntityReferenceField(contextBundle, {
      cardinality: "one",
      label: "Bundle",
    }),
    order: numberTypeModule.field({
      cardinality: "one",
      validate: ({ value }) => validateNonNegativeInteger("Context entry order", value),
      meta: {
        label: "Order",
      },
    }),
    source: contextBundleEntrySourceTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Source",
        display: {
          kind: "badge",
        },
      },
      filter: {
        operators: ["is", "oneOf"] as const,
        defaultOperator: "is",
      },
    }),
    refId: optionalStringField("Reference id"),
    path: optionalStringField("Path", {
      defaultOperator: "prefix",
    }),
    bodyText: optionalStringField("Body text", {
      multiline: true,
      operators: ["contains", "equals"] as const,
      defaultOperator: "contains",
    }),
    blobId: optionalStringField("Blob id"),
  },
});
