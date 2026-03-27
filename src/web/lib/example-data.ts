import { core } from "@io/core/graph/modules";
import { workflow } from "@io/core/graph/modules/workflow";
import { type GraphClient } from "@io/graph-client";

const exampleGraph = { ...core, ...workflow } as const;

function resolvedEnumValue(value: { key: string; id?: string }): string {
  return value.id ?? value.key;
}

function date(value: string): Date {
  return new Date(value);
}

function resolveEntityId<TEntity extends { id: string }>(
  entity: TEntity | undefined,
  create: () => string,
): string {
  return entity?.id ?? create();
}

export type ExampleGraphIds = {
  readonly agentSession: string;
  readonly docsTag: string;
  readonly graphExplorer: string;
  readonly graphTag: string;
  readonly repositoryBranch: string;
  readonly repositoryCommit: string;
  readonly runtimeSync: string;
  readonly secretRotation: string;
  readonly branch: string;
  readonly commit: string;
  readonly project: string;
  readonly repository: string;
};

export function seedExampleGraph(graph: GraphClient<typeof exampleGraph>): ExampleGraphIds {
  const graphTag = resolveEntityId(
    graph.tag.list().find((tag) => tag.key === "graph"),
    () =>
      graph.tag.create({
        color: "#0ea5e9",
        key: "graph",
        name: "Graph",
      }),
  );
  const docsTag = resolveEntityId(
    graph.tag.list().find((tag) => tag.key === "docs"),
    () =>
      graph.tag.create({
        color: "#f59e0b",
        key: "docs",
        name: "Docs",
      }),
  );

  const graphExplorer = resolveEntityId(
    graph.document.list().find((document) => document.slug === "graph-explorer"),
    () =>
      graph.document.create({
        description: "Shared explorer surface for the canonical product graph.",
        name: "Graph Explorer",
        isArchived: false,
        slug: "graph-explorer",
        tags: [graphTag, docsTag],
      }),
  );
  const runtimeSync = resolveEntityId(
    graph.document.list().find((document) => document.name === "Runtime Sync"),
    () =>
      graph.document.create({
        description: "Total snapshots bootstrap clients before ordered incremental updates.",
        name: "Runtime Sync",
        isArchived: false,
        slug: "runtime-sync",
        tags: [graphTag],
      }),
  );
  const secretRotation = resolveEntityId(
    graph.document.list().find((document) => document.name === "Secret Rotation"),
    () =>
      graph.document.create({
        description: "Rotate env-var secrets through authority-only commands.",
        name: "Secret Rotation",
        isArchived: false,
        slug: "secret-rotation",
        tags: [docsTag],
      }),
  );
  const docsTreeKey = "example-docs";
  const graphExplorerPlacement = resolveEntityId(
    graph.documentPlacement
      .list()
      .find(
        (placement) => placement.treeKey === docsTreeKey && placement.document === graphExplorer,
      ),
    () =>
      graph.documentPlacement.create({
        name: "Graph Explorer",
        document: graphExplorer,
        order: 1,
        slug: "graph-explorer",
        treeKey: docsTreeKey,
      }),
  );
  resolveEntityId(
    graph.documentPlacement
      .list()
      .find((placement) => placement.treeKey === docsTreeKey && placement.document === runtimeSync),
    () =>
      graph.documentPlacement.create({
        name: "Runtime Sync",
        document: runtimeSync,
        order: 2,
        parentPlacement: graphExplorerPlacement,
        slug: "runtime-sync",
        treeKey: docsTreeKey,
      }),
  );
  resolveEntityId(
    graph.documentPlacement
      .list()
      .find(
        (placement) => placement.treeKey === docsTreeKey && placement.document === secretRotation,
      ),
    () =>
      graph.documentPlacement.create({
        name: "Secret Rotation",
        document: secretRotation,
        order: 3,
        parentPlacement: graphExplorerPlacement,
        slug: "secret-rotation",
        treeKey: docsTreeKey,
      }),
  );
  resolveEntityId(
    graph.documentBlock
      .list()
      .find((block) => block.document === graphExplorer && block.order === 0),
    () =>
      graph.documentBlock.create({
        content: "Shared explorer surface for the canonical product graph.",
        document: graphExplorer,
        kind: resolvedEnumValue(workflow.documentBlockKind.values.markdown),
        name: "Overview",
        order: 0,
      }),
  );
  resolveEntityId(
    graph.documentBlock.list().find((block) => block.document === runtimeSync && block.order === 0),
    () =>
      graph.documentBlock.create({
        content: "Total snapshots bootstrap clients before ordered incremental updates.",
        document: runtimeSync,
        kind: resolvedEnumValue(workflow.documentBlockKind.values.markdown),
        name: "Overview",
        order: 0,
      }),
  );
  resolveEntityId(
    graph.documentBlock
      .list()
      .find((block) => block.document === secretRotation && block.order === 0),
    () =>
      graph.documentBlock.create({
        content: "Rotate env-var secrets through authority-only commands.",
        document: secretRotation,
        kind: resolvedEnumValue(workflow.documentBlockKind.values.markdown),
        name: "Overview",
        order: 0,
      }),
  );
  const project = resolveEntityId(
    graph.project.list().find((project) => project.projectKey === "project:io"),
    () =>
      graph.project.create({
        name: "IO",
        projectKey: "project:io",
        inferred: true,
        createdAt: date("2026-01-01T00:00:00.000Z"),
        updatedAt: date("2026-01-06T00:00:00.000Z"),
      }),
  );
  const repository = resolveEntityId(
    graph.repository.list().find((repository) => repository.repositoryKey === "repo:io"),
    () =>
      graph.repository.create({
        name: "io",
        project: project,
        repositoryKey: "repo:io",
        repoRoot: "/tmp/io",
        defaultBaseBranch: "main",
        createdAt: date("2026-01-01T00:00:00.000Z"),
        updatedAt: date("2026-01-06T00:00:00.000Z"),
      }),
  );
  const workflowGoal = resolveEntityId(
    graph.document.list().find((document) => document.slug === "workflow-shell-goal"),
    () =>
      graph.document.create({
        description: "Hydrate the first graph-backed workflow shell from the synced review scope.",
        name: "Workflow Shell Goal",
        isArchived: false,
        slug: "workflow-shell-goal",
        tags: [graphTag, docsTag],
      }),
  );
  const branch = resolveEntityId(
    graph.branch.list().find((branch) => branch.branchKey === "branch:workflow-shell"),
    () =>
      graph.branch.create({
        name: "Workflow shell",
        project: project,
        branchKey: "branch:workflow-shell",
        state: workflow.branchState.values.active.id,
        queueRank: 1,
        goalDocument: workflowGoal,
        createdAt: date("2026-01-02T00:00:00.000Z"),
        updatedAt: date("2026-01-06T00:00:00.000Z"),
      }),
  );
  const commit = resolveEntityId(
    graph.commit.list().find((commit) => commit.commitKey === "commit:hydrate-workflow-shell"),
    () =>
      graph.commit.create({
        name: "Hydrate workflow shell",
        branch: branch,
        commitKey: "commit:hydrate-workflow-shell",
        state: workflow.commitState.values.active.id,
        order: 1,
        createdAt: date("2026-01-03T00:00:00.000Z"),
        updatedAt: date("2026-01-06T00:00:00.000Z"),
      }),
  );
  const repositoryBranch = resolveEntityId(
    graph.repositoryBranch.list().find((branch) => branch.branchName === "workflow/shell"),
    () =>
      graph.repositoryBranch.create({
        name: "workflow/shell",
        project: project,
        repository: repository,
        branch,
        managed: true,
        branchName: "workflow/shell",
        baseBranchName: "main",
        latestReconciledAt: date("2026-01-06T12:00:00.000Z"),
        createdAt: date("2026-01-02T00:00:00.000Z"),
        updatedAt: date("2026-01-06T12:00:00.000Z"),
      }),
  );
  const repositoryCommit = resolveEntityId(
    graph.repositoryCommit.list().find((commit) => commit.name === "Hydrate workflow shell"),
    () =>
      graph.repositoryCommit.create({
        name: "Hydrate workflow shell",
        repository: repository,
        repositoryBranch,
        commit,
        state: workflow.repositoryCommitState.values.attached.id,
        worktree: {
          path: "/tmp/io-worktree-shell",
          branchName: "workflow/shell",
          leaseState: workflow.repositoryCommitLeaseState.values.attached.id,
        },
        createdAt: date("2026-01-03T00:00:00.000Z"),
        updatedAt: date("2026-01-06T12:00:00.000Z"),
      }),
  );
  const agentSession = resolveEntityId(
    graph.agentSession
      .list()
      .find((session) => session.sessionKey === "session:hydrate-workflow-shell"),
    () =>
      graph.agentSession.create({
        name: "Hydrate workflow shell",
        project: project,
        repository: repository,
        subjectKind: workflow.agentSessionSubjectKind.values.commit.id,
        branch: branch,
        commit: commit,
        sessionKey: "session:hydrate-workflow-shell",
        kind: workflow.agentSessionKind.values.execution.id,
        workerId: "worker-example",
        runtimeState: workflow.agentSessionRuntimeState.values.running.id,
        startedAt: date("2026-01-06T09:30:00.000Z"),
        createdAt: date("2026-01-06T09:30:00.000Z"),
        updatedAt: date("2026-01-06T09:30:00.000Z"),
      }),
  );

  return {
    agentSession,
    docsTag,
    graphExplorer,
    graphTag,
    repositoryBranch,
    repositoryCommit,
    runtimeSync,
    secretRotation,
    branch,
    commit,
    project,
    repository,
  };
}
