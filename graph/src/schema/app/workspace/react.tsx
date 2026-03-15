import {
  GraphValidationError,
  type GraphMutationValidationResult,
  type PredicateRef,
} from "../../../index.js";
import { useEffect, useState } from "react";

import type { MutationCallbacks } from "../../../react/mutation-validation.js";
import { performValidatedMutation } from "../../../react/mutation-validation.js";
import { usePersistedMutationCallbacks } from "../../../react/persisted-mutation.js";

export type WorkspaceSection = "issues" | "projects" | "labels";

type AnyPredicate = PredicateRef<any, any>;

type WorkspaceRecord = {
  readonly description?: string;
  readonly issues: readonly string[];
  readonly labels: readonly string[];
  readonly name: string;
  readonly projects: readonly string[];
  readonly statuses: readonly string[];
};

type WorkspaceIssueRecord = {
  readonly blockedBy: readonly string[];
  readonly description?: string;
  readonly dueDate?: Date;
  readonly identifier: string;
  readonly labels: readonly string[];
  readonly name: string;
  readonly parent?: string;
  readonly priority?: number;
  readonly project?: string;
  readonly status: string;
};

type WorkspaceProjectRecord = {
  readonly color?: string;
  readonly description?: string;
  readonly key: string;
  readonly name: string;
  readonly targetDate?: Date;
};

type WorkspaceLabelRecord = {
  readonly color?: string;
  readonly description?: string;
  readonly key: string;
  readonly name: string;
};

type WorkflowStatusRecord = {
  readonly name: string;
};

type WorkspaceIssueRef = {
  readonly fields: {
    readonly blockedBy: AnyPredicate;
    readonly description: AnyPredicate;
    readonly dueDate: AnyPredicate;
    readonly identifier: AnyPredicate;
    readonly labels: AnyPredicate;
    readonly name: AnyPredicate;
    readonly parent: AnyPredicate;
    readonly priority: AnyPredicate;
    readonly project: AnyPredicate;
    readonly status: AnyPredicate;
  };
};

type WorkspaceProjectRef = {
  readonly fields: {
    readonly color: AnyPredicate;
    readonly description: AnyPredicate;
    readonly key: AnyPredicate;
    readonly name: AnyPredicate;
    readonly targetDate: AnyPredicate;
  };
};

type WorkspaceLabelRef = {
  readonly fields: {
    readonly color: AnyPredicate;
    readonly description: AnyPredicate;
    readonly key: AnyPredicate;
    readonly name: AnyPredicate;
  };
};

type WorkspaceGraph = {
  readonly workflowStatus: {
    get(id: string): WorkflowStatusRecord;
  };
  readonly workspace: {
    list(): readonly WorkspaceRecord[];
  };
  readonly workspaceIssue: {
    get(id: string): WorkspaceIssueRecord;
    ref(id: string): WorkspaceIssueRef;
  };
  readonly workspaceLabel: {
    get(id: string): WorkspaceLabelRecord;
    ref(id: string): WorkspaceLabelRef;
  };
  readonly workspaceProject: {
    get(id: string): WorkspaceProjectRecord;
    ref(id: string): WorkspaceProjectRef;
  };
};

type WorkspaceSync = {
  flush(): Promise<unknown>;
  getPendingTransactions(): readonly unknown[];
  subscribe(listener: () => void): () => void;
};

export type WorkspaceManagementRuntime = {
  readonly graph: WorkspaceGraph;
  readonly sync: WorkspaceSync;
};

export type ReferenceOption = {
  readonly id: string;
  readonly label: string;
  readonly supporting?: string;
};

export type IssueSummary = {
  readonly dueDate?: Date;
  readonly id: string;
  readonly identifier: string;
  readonly labelCount: number;
  readonly labels: readonly string[];
  readonly name: string;
  readonly projectId?: string;
  readonly projectName?: string;
  readonly statusId: string;
  readonly statusName: string;
};

export type ProjectSummary = {
  readonly color?: string;
  readonly id: string;
  readonly issueCount: number;
  readonly key: string;
  readonly name: string;
  readonly targetDate?: Date;
};

export type LabelSummary = {
  readonly color?: string;
  readonly id: string;
  readonly issueCount: number;
  readonly key: string;
  readonly name: string;
};

export type StatusSummary = {
  readonly id: string;
  readonly issueCount: number;
  readonly name: string;
};

export type WorkspaceManagementModel = {
  readonly error: string;
  readonly issues: readonly IssueSummary[];
  readonly labels: readonly LabelSummary[];
  readonly onMutationError: (error: unknown) => void;
  readonly onMutationSuccess: () => void;
  readonly openIssue: (issueId: string) => void;
  readonly projectOptions: readonly ReferenceOption[];
  readonly projects: readonly ProjectSummary[];
  readonly section: WorkspaceSection;
  readonly selectedIssueId: string;
  readonly selectedLabelId: string;
  readonly selectedProjectId: string;
  readonly setSection: (section: WorkspaceSection) => void;
  readonly setSelectedIssueId: (issueId: string) => void;
  readonly setSelectedLabelId: (labelId: string) => void;
  readonly setSelectedProjectId: (projectId: string) => void;
  readonly statusOptions: readonly ReferenceOption[];
  readonly statuses: readonly StatusSummary[];
  readonly workspace: ReturnType<typeof getPrimaryWorkspace>;
};

export function formatWorkspaceMutationError(error: unknown): string {
  if (error instanceof GraphValidationError) {
    return error.result.issues[0]?.message ?? error.message;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

export function countIssuesByStatus(
  issues: readonly IssueSummary[],
  statusId: string,
): number {
  return issues.filter((issue) => issue.statusId === statusId).length;
}

export function useWorkspaceSync(runtime: WorkspaceManagementRuntime): void {
  const [, setVersion] = useState(0);

  useEffect(() => {
    return runtime.sync.subscribe(() => {
      setVersion((current) => current + 1);
    });
  }, [runtime]);
}

function validatePredicateClear(predicate: AnyPredicate): GraphMutationValidationResult | false {
  if (typeof (predicate as { validateClear?: unknown }).validateClear !== "function") return false;
  return (predicate as { validateClear(): GraphMutationValidationResult }).validateClear();
}

function clearPredicateValue(predicate: AnyPredicate): boolean {
  if (typeof (predicate as { clear?: unknown }).clear !== "function") return false;
  (predicate as { clear(): void }).clear();
  return true;
}

export function validatePredicateValue(
  predicate: AnyPredicate,
  value: unknown,
): GraphMutationValidationResult | false {
  if (typeof (predicate as { validateSet?: unknown }).validateSet !== "function") return false;
  return (
    predicate as { validateSet(nextValue: unknown): GraphMutationValidationResult }
  ).validateSet(value);
}

export function setPredicateValue(predicate: AnyPredicate, value: unknown): boolean {
  if (typeof (predicate as { set?: unknown }).set !== "function") return false;
  (predicate as { set(nextValue: unknown): void }).set(value);
  return true;
}

export function clearOptionalReference(
  predicate: AnyPredicate,
  callbacks: MutationCallbacks,
): boolean {
  if (predicate.field.cardinality !== "one?") return false;
  return performValidatedMutation(
    callbacks,
    () => validatePredicateClear(predicate),
    () => clearPredicateValue(predicate),
  );
}

function getPrimaryWorkspace(graph: WorkspaceManagementRuntime["graph"]) {
  return graph.workspace
    .list()
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))[0];
}

function createIssueSummaries(graph: WorkspaceManagementRuntime["graph"], issueIds: readonly string[]) {
  return issueIds.map((id) => {
    const issue = graph.workspaceIssue.get(id);
    const status = graph.workflowStatus.get(issue.status);
    const project = issue.project ? graph.workspaceProject.get(issue.project) : undefined;

    return {
      dueDate: issue.dueDate,
      id,
      identifier: issue.identifier,
      labelCount: issue.labels.length,
      labels: issue.labels,
      name: issue.name,
      projectId: issue.project,
      projectName: project?.name,
      statusId: issue.status,
      statusName: status.name,
    } satisfies IssueSummary;
  });
}

function createProjectSummaries(
  graph: WorkspaceManagementRuntime["graph"],
  projectIds: readonly string[],
  issues: readonly IssueSummary[],
) {
  return projectIds.map((id) => {
    const project = graph.workspaceProject.get(id);
    return {
      color: project.color,
      id,
      issueCount: issues.filter((issue) => issue.projectId === id).length,
      key: project.key,
      name: project.name,
      targetDate: project.targetDate,
    } satisfies ProjectSummary;
  });
}

function createLabelSummaries(
  graph: WorkspaceManagementRuntime["graph"],
  labelIds: readonly string[],
  issues: readonly IssueSummary[],
) {
  return labelIds.map((id) => {
    const label = graph.workspaceLabel.get(id);
    return {
      color: label.color,
      id,
      issueCount: issues.filter((issue) => issue.labels.includes(id)).length,
      key: label.key,
      name: label.name,
    } satisfies LabelSummary;
  });
}

export function findIssueName(
  issues: readonly IssueSummary[],
  issueId: string | undefined,
): string | undefined {
  return issues.find((issue) => issue.id === issueId)?.name;
}

export function useWorkspaceManagementModel(
  runtime: WorkspaceManagementRuntime,
): WorkspaceManagementModel {
  useWorkspaceSync(runtime);

  const workspace = getPrimaryWorkspace(runtime.graph);
  const [section, setSection] = useState<WorkspaceSection>("issues");
  const [selectedIssueId, setSelectedIssueId] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedLabelId, setSelectedLabelId] = useState("");
  const [error, setError] = useState("");
  const mutationCallbacks = usePersistedMutationCallbacks(
    {
      onMutationError: (nextError) => {
        setError(formatWorkspaceMutationError(nextError));
      },
      onMutationSuccess: () => {
        setError("");
      },
    },
    runtime,
  );
  const onMutationError = mutationCallbacks.onMutationError ?? (() => {});
  const onMutationSuccess = mutationCallbacks.onMutationSuccess ?? (() => {});

  const issueIds = workspace?.issues ?? [];
  const projectIds = workspace?.projects ?? [];
  const labelIds = workspace?.labels ?? [];
  const statusIds = workspace?.statuses ?? [];

  const issues = createIssueSummaries(runtime.graph, issueIds);
  const projects = createProjectSummaries(runtime.graph, projectIds, issues);
  const labels = createLabelSummaries(runtime.graph, labelIds, issues);
  const statuses = statusIds.map((statusId) => {
    const status = runtime.graph.workflowStatus.get(statusId);
    return {
      id: statusId,
      issueCount: countIssuesByStatus(issues, statusId),
      name: status.name,
    } satisfies StatusSummary;
  });
  const statusOptions = statuses.map((status) => ({
    id: status.id,
    label: status.name,
    supporting: `${status.issueCount} issues in this lane`,
  }));
  const projectOptions = projects.map((project) => ({
    id: project.id,
    label: project.name,
    supporting: `${project.issueCount} linked issues`,
  }));

  useEffect(() => {
    if (issues.length === 0) {
      setSelectedIssueId("");
      return;
    }
    if (!issues.some((issue) => issue.id === selectedIssueId)) {
      setSelectedIssueId(issues[0]!.id);
    }
  }, [issues, selectedIssueId]);

  useEffect(() => {
    if (projects.length === 0) {
      setSelectedProjectId("");
      return;
    }
    if (!projects.some((project) => project.id === selectedProjectId)) {
      setSelectedProjectId(projects[0]!.id);
    }
  }, [projects, selectedProjectId]);

  useEffect(() => {
    if (labels.length === 0) {
      setSelectedLabelId("");
      return;
    }
    if (!labels.some((label) => label.id === selectedLabelId)) {
      setSelectedLabelId(labels[0]!.id);
    }
  }, [labels, selectedLabelId]);

  function openIssue(issueId: string): void {
    setSection("issues");
    setSelectedIssueId(issueId);
  }

  return {
    error,
    issues,
    labels,
    onMutationError,
    onMutationSuccess,
    openIssue,
    projectOptions,
    projects,
    section,
    selectedIssueId,
    selectedLabelId,
    selectedProjectId,
    setSection,
    setSelectedIssueId,
    setSelectedLabelId,
    setSelectedProjectId,
    statusOptions,
    statuses,
    workspace,
  };
}
