import { defineEnum, defineType } from "@io/core/graph/def";

import { existingEntityReferenceField } from "../../../runtime/reference-policy.js";
import { core } from "../../core.js";
import { booleanTypeModule } from "../../core/boolean/index.js";
import { dateTypeModule } from "../../core/date/index.js";
import { defineDefaultEnumTypeModule } from "../../core/enum-module.js";
import { numberTypeModule } from "../../core/number/index.js";
import { stringTypeModule } from "../../core/string/index.js";

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
    defaultOperator?: "equals" | "prefix";
  },
) {
  return stringTypeModule.field({
    cardinality: "one?",
    validate: ({ value }) => validateOptionalString(label, value),
    meta: {
      label,
      ...(input?.description ? { description: input.description } : {}),
    },
    filter: {
      operators: ["equals", "prefix"] as const,
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

export const workflowProjectKeyPattern = buildWorkflowKeyPattern("project");
export const workflowRepositoryKeyPattern = buildWorkflowKeyPattern("repo");
export const workflowBranchKeyPattern = buildWorkflowKeyPattern("branch");
export const workflowCommitKeyPattern = buildWorkflowKeyPattern("commit");

export const workflowProject = defineType({
  values: { key: "ops:workflowProject", name: "Workflow Project" },
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

export const workflowRepository = defineType({
  values: { key: "ops:workflowRepository", name: "Workflow Repository" },
  fields: {
    ...titleNodeFields("Repository title"),
    project: existingEntityReferenceField(workflowProject, {
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

export const workflowBranchState = defineEnum({
  values: { key: "ops:workflowBranchState", name: "Workflow Branch State" },
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

export const workflowBranchStateTypeModule = defineDefaultEnumTypeModule(workflowBranchState);

export const workflowBranch = defineType({
  values: { key: "ops:workflowBranch", name: "Workflow Branch" },
  fields: {
    ...titleNodeFields("Branch title"),
    project: existingEntityReferenceField(workflowProject, {
      cardinality: "one",
      label: "Project",
    }),
    branchKey: workflowKeyField("Branch key", "branch"),
    state: {
      ...workflowBranchStateTypeModule.field({
        cardinality: "one",
        onCreate: ({ incoming }) =>
          incoming ?? resolvedEnumValue(workflowBranchState.values.backlog),
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
    goalSummary: requiredStringField("Goal summary", {
      multiline: true,
      operators: ["contains", "equals"] as const,
      defaultOperator: "contains",
    }),
    goalDocumentPath: optionalStringField("Goal document path", {
      defaultOperator: "prefix",
    }),
    activeCommit: existingEntityReferenceField("ops:workflowCommit", {
      cardinality: "one?",
      label: "Active commit",
    }),
  },
});

export const workflowCommitState = defineEnum({
  values: { key: "ops:workflowCommitState", name: "Workflow Commit State" },
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

export const workflowCommitStateTypeModule = defineDefaultEnumTypeModule(workflowCommitState);

export const workflowCommit = defineType({
  values: { key: "ops:workflowCommit", name: "Workflow Commit" },
  fields: {
    ...titleNodeFields("Commit title"),
    branch: existingEntityReferenceField(workflowBranch, {
      cardinality: "one",
      label: "Branch",
    }),
    commitKey: workflowKeyField("Commit key", "commit"),
    state: {
      ...workflowCommitStateTypeModule.field({
        cardinality: "one",
        onCreate: ({ incoming }) =>
          incoming ?? resolvedEnumValue(workflowCommitState.values.planned),
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
    parentCommit: existingEntityReferenceField("ops:workflowCommit", {
      cardinality: "one?",
      excludeSubject: true,
      label: "Parent commit",
    }),
  },
});

export const repositoryCommitState = defineEnum({
  values: { key: "ops:repositoryCommitState", name: "Repository Commit State" },
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
    key: "ops:repositoryCommitLeaseState",
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
  values: { key: "ops:repositoryBranch", name: "Repository Branch" },
  fields: {
    ...titleNodeFields("Repository branch title"),
    project: existingEntityReferenceField(workflowProject, {
      cardinality: "one",
      label: "Project",
    }),
    repository: existingEntityReferenceField(workflowRepository, {
      cardinality: "one",
      label: "Repository",
    }),
    workflowBranch: existingEntityReferenceField(workflowBranch, {
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
  values: { key: "ops:repositoryCommit", name: "Repository Commit" },
  fields: {
    ...titleNodeFields("Repository commit title"),
    repository: existingEntityReferenceField(workflowRepository, {
      cardinality: "one",
      label: "Repository",
    }),
    repositoryBranch: existingEntityReferenceField(repositoryBranch, {
      cardinality: "one?",
      label: "Repository branch",
    }),
    workflowCommit: existingEntityReferenceField(workflowCommit, {
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
