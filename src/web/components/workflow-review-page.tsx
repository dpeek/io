"use client";

import { Badge } from "@io/web/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@io/web/card";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import type {
  CommitQueueScopeCommitRow,
  CommitQueueScopeResult,
  ProjectBranchScopeRepositoryObservation,
  ProjectBranchScopeResult,
} from "../../graph/modules/ops/workflow/query.js";
import {
  createWorkflowReviewStartupContract,
  resolveCanonicalWorkflowRouteSearch,
  resolveWorkflowReviewStartupState,
  type WorkflowReviewStartupState,
  type WorkflowRouteSearch,
} from "../lib/workflow-review-contract.js";
import { createWorkflowReviewLiveSync } from "../lib/workflow-review-live-sync.js";
import { startWorkflowReviewRefreshLoop } from "../lib/workflow-review-refresh.js";
import {
  requestWorkflowRead,
  WorkflowReadClientError,
  type CommitQueueScopeWorkflowReadResponse,
  type ProjectBranchScopeWorkflowReadResponse,
} from "../lib/workflow-transport.js";
import { useGraphRuntime } from "./graph-runtime-bootstrap.js";

export type WorkflowReviewReadState =
  | { readonly status: "loading" }
  | {
      readonly branchBoard: ProjectBranchScopeWorkflowReadResponse["result"];
      readonly commitQueue?: CommitQueueScopeWorkflowReadResponse["result"];
      readonly status: "ready";
    }
  | {
      readonly code?: string;
      readonly message: string;
      readonly status: "error";
    };

function buildWorkflowHref(search: WorkflowRouteSearch): string {
  const params = new URLSearchParams();
  if (search.project) {
    params.set("project", search.project);
  }
  if (search.branch) {
    params.set("branch", search.branch);
  }
  const query = params.toString();
  return query.length > 0 ? `/workflow?${query}` : "/workflow";
}

function formatTimestamp(value: string | undefined): string {
  return value ?? "Not recorded";
}

function formatRepositoryObservation(
  observation: ProjectBranchScopeRepositoryObservation | undefined,
): string {
  if (!observation) {
    return "Not materialized in the attached repository.";
  }
  return `${observation.repositoryBranch.branchName} [${observation.freshness}]`;
}

function formatLatestSession(commitQueue: CommitQueueScopeResult | undefined): string {
  const latestSession = commitQueue?.branch.latestSession;
  if (!latestSession) {
    return "No retained session recorded.";
  }
  return `${latestSession.kind} / ${latestSession.runtimeState} / ${latestSession.sessionKey}`;
}

function formatRepositoryCommitSummary(row: CommitQueueScopeCommitRow): string {
  if (!row.repositoryCommit) {
    return "No repository commit attached.";
  }

  const fields = [`state ${row.repositoryCommit.state}`];
  if (row.repositoryCommit.sha) {
    fields.push(`sha ${row.repositoryCommit.sha}`);
  }
  if (row.repositoryCommit.worktree.branchName) {
    fields.push(`branch ${row.repositoryCommit.worktree.branchName}`);
  }
  if (row.repositoryCommit.worktree.path) {
    fields.push(`worktree ${row.repositoryCommit.worktree.path}`);
  }
  fields.push(`lease ${row.repositoryCommit.worktree.leaseState}`);
  return fields.join(" | ");
}

function resolveSelectedCommitRow(commitQueue: CommitQueueScopeResult | undefined) {
  if (!commitQueue || commitQueue.rows.length === 0) {
    return undefined;
  }

  const activeCommitId =
    commitQueue.branch.activeCommit?.workflowCommit.id ??
    commitQueue.branch.workflowBranch.activeCommitId;

  return (
    commitQueue.rows.find((row) => row.workflowCommit.id === activeCommitId) ?? commitQueue.rows[0]
  );
}

function RecoveryHint() {
  return (
    <p className="text-muted-foreground text-sm">
      Recover with the whole graph at{" "}
      <a className="underline underline-offset-2" href="/sync?scope=graph">
        /sync
      </a>{" "}
      if the scoped workflow review data looks incomplete.
    </p>
  );
}

function PageHeader({
  branchCount,
  commitCount,
  projectId,
  selectedBranchId,
}: {
  readonly branchCount?: number;
  readonly commitCount?: number;
  readonly projectId?: string;
  readonly selectedBranchId?: string;
}) {
  return (
    <Card className="border-border/70 bg-card/95 border shadow-sm">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>Workflow review</CardTitle>
            <CardDescription>
              `/workflow` now resolves the shipped `ops/workflow` review scope into a workflow
              branch board, branch detail, and commit queue layout.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline">workflow-review scope</Badge>
            <Badge variant="outline">branch board</Badge>
            <Badge variant="outline">commit queue</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm md:grid-cols-3">
        <div className="grid gap-1">
          <span className="text-muted-foreground text-xs font-medium tracking-[0.16em] uppercase">
            Resolved project
          </span>
          <code>{projectId ?? "pending selection"}</code>
        </div>
        <div className="grid gap-1">
          <span className="text-muted-foreground text-xs font-medium tracking-[0.16em] uppercase">
            Selected branch
          </span>
          <code>{selectedBranchId ?? "pending selection"}</code>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{branchCount ?? 0} branches</Badge>
          <Badge variant="secondary">{commitCount ?? 0} commits</Badge>
        </div>
      </CardContent>
    </Card>
  );
}

function PanelShell({
  children,
  description,
  title,
}: {
  readonly children: ReactNode;
  readonly description: string;
  readonly title: string;
}) {
  return (
    <Card className="border-border/70 bg-card/95 flex min-h-[24rem] flex-col border shadow-sm">
      <CardHeader className="gap-2">
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="min-h-0 flex-1">{children}</CardContent>
    </Card>
  );
}

function EmptyPanelBody({ detail, title }: { readonly detail: string; readonly title: string }) {
  return (
    <div className="border-border/70 flex h-full min-h-0 flex-col justify-center rounded-lg border border-dashed px-4 py-6 text-center">
      <p className="font-medium">{title}</p>
      <p className="text-muted-foreground mt-2 text-sm">{detail}</p>
    </div>
  );
}

function ProjectChooserPanel({
  startupState,
}: {
  readonly startupState: Extract<WorkflowReviewStartupState, { readonly kind: "missing-data" }>;
}) {
  if (startupState.visibleProjects.length === 0) {
    return (
      <EmptyPanelBody
        detail="No visible WorkflowProject records are currently available in the scoped review runtime."
        title="No projects in scope"
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <p className="text-muted-foreground text-sm">
        Select a project before branch-board composition starts.
      </p>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto">
        {startupState.visibleProjects.map((project) => (
          <a
            className="border-border/70 hover:border-foreground/30 hover:bg-muted/40 rounded-lg border px-3 py-3 text-sm transition-colors"
            href={buildWorkflowHref({ project: project.id })}
            key={project.id}
          >
            <div className="font-medium">{project.title}</div>
            <div className="text-muted-foreground mt-1 font-mono text-xs">{project.id}</div>
          </a>
        ))}
      </div>
    </div>
  );
}

function BranchBoardPanel({
  activeBranchId,
  branchBoard,
  projectId,
  startupState,
}: {
  readonly activeBranchId?: string;
  readonly branchBoard?: ProjectBranchScopeResult;
  readonly projectId?: string;
  readonly startupState: WorkflowReviewStartupState;
}) {
  if (!branchBoard) {
    if (
      startupState.kind === "missing-data" &&
      startupState.reason === "project-selection-required"
    ) {
      return <ProjectChooserPanel startupState={startupState} />;
    }

    return (
      <EmptyPanelBody
        detail={
          startupState.kind !== "ready" ? startupState.message : "Resolve a workflow project first."
        }
        title="Branch board unavailable"
      />
    );
  }

  if (branchBoard.rows.length === 0) {
    return (
      <EmptyPanelBody
        detail="The selected project does not currently expose any workflow branches."
        title="No branches in scope"
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">{branchBoard.rows.length} managed</Badge>
        <Badge variant="secondary">
          {branchBoard.unmanagedRepositoryBranches.length} repository-only
        </Badge>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto pr-1">
        {branchBoard.rows.map((row) => {
          const selected = row.workflowBranch.id === activeBranchId;
          return (
            <a
              aria-current={selected ? "page" : undefined}
              className={`rounded-lg border px-3 py-3 text-sm transition-colors ${
                selected
                  ? "border-foreground/40 bg-muted/60"
                  : "border-border/70 hover:border-foreground/30 hover:bg-muted/30"
              }`}
              href={buildWorkflowHref({
                ...(projectId ? { project: projectId } : {}),
                branch: row.workflowBranch.id,
              })}
              key={row.workflowBranch.id}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium">{row.workflowBranch.title}</div>
                  <div className="text-muted-foreground mt-1 text-xs">
                    {row.workflowBranch.branchKey}
                  </div>
                </div>
                <Badge variant={selected ? "default" : "outline"}>{row.workflowBranch.state}</Badge>
              </div>
              <div className="text-muted-foreground mt-3 space-y-1 text-xs">
                <div>Queue rank: {row.workflowBranch.queueRank ?? "unranked"}</div>
                <div>Repository: {formatRepositoryObservation(row.repositoryBranch)}</div>
              </div>
            </a>
          );
        })}
      </div>
      {branchBoard.unmanagedRepositoryBranches.length > 0 ? (
        <div className="border-border/70 rounded-lg border border-dashed px-3 py-3 text-xs">
          <div className="mb-2 font-medium">Observed repository branches</div>
          <div className="text-muted-foreground space-y-1">
            {branchBoard.unmanagedRepositoryBranches.map((observation) => (
              <div key={observation.repositoryBranch.id}>
                {observation.repositoryBranch.branchName} [{observation.freshness}]
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BranchDetailPanel({
  branchBoard,
  commitQueue,
  startupState,
}: {
  readonly branchBoard?: ProjectBranchScopeResult;
  readonly commitQueue?: CommitQueueScopeResult;
  readonly startupState: WorkflowReviewStartupState;
}) {
  const selectedBranchId =
    commitQueue?.branch.workflowBranch.id ??
    (startupState.kind === "ready" ? startupState.selectedBranch?.id : undefined);
  const selectedRow = branchBoard?.rows.find((row) => row.workflowBranch.id === selectedBranchId);

  if (!selectedRow) {
    return (
      <EmptyPanelBody
        detail="Select a workflow branch to inspect its repository status, latest session, and launch context."
        title="No branch selected"
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold">{selectedRow.workflowBranch.title}</div>
          <div className="text-muted-foreground mt-1 font-mono text-xs">
            {selectedRow.workflowBranch.branchKey}
          </div>
        </div>
        <Badge>{selectedRow.workflowBranch.state}</Badge>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <DetailField
          label="Queue rank"
          value={String(selectedRow.workflowBranch.queueRank ?? "unranked")}
        />
        <DetailField
          label="Repository branch"
          value={formatRepositoryObservation(selectedRow.repositoryBranch)}
        />
        <DetailField label="Latest session" value={formatLatestSession(commitQueue)} />
        <DetailField
          label="Active commit"
          value={commitQueue?.branch.activeCommit?.workflowCommit.title ?? "None selected"}
        />
      </div>
      <DetailField
        label="Goal"
        value={selectedRow.workflowBranch.goalSummary ?? "No goal summary recorded."}
      />
      {branchBoard?.repository ? (
        <DetailField
          label="Repository"
          value={`${branchBoard.repository.title} (${branchBoard.repository.repositoryKey}) -> ${branchBoard.repository.defaultBaseBranch}`}
        />
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <DetailField
          label="Projected at"
          value={formatTimestamp(branchBoard?.freshness.projectedAt)}
        />
        <DetailField
          label="Repository freshness"
          value={branchBoard?.freshness.repositoryFreshness ?? "missing"}
        />
        <DetailField
          label="Repository reconciled"
          value={formatTimestamp(branchBoard?.freshness.repositoryReconciledAt)}
        />
        <DetailField
          label="Projection cursor"
          value={branchBoard?.freshness.projectionCursor ?? "Not exposed"}
        />
      </div>
    </div>
  );
}

function DetailField({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="border-border/70 grid gap-1 rounded-lg border px-3 py-3">
      <span className="text-muted-foreground text-[11px] font-medium tracking-[0.16em] uppercase">
        {label}
      </span>
      <span className="break-words">{value}</span>
    </div>
  );
}

function CommitQueuePanel({ commitQueue }: { readonly commitQueue?: CommitQueueScopeResult }) {
  const selectedCommit = resolveSelectedCommitRow(commitQueue);

  if (!commitQueue) {
    return (
      <EmptyPanelBody
        detail="Select a workflow branch to load its commit queue."
        title="Commit queue unavailable"
      />
    );
  }

  if (commitQueue.rows.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">0 logical commits</Badge>
          <Badge variant="outline">{commitQueue.branch.workflowBranch.state}</Badge>
        </div>
        <EmptyPanelBody
          detail="The selected branch does not currently have any logical commits queued for execution."
          title="No commits queued"
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-medium">{commitQueue.branch.workflowBranch.title}</div>
          <div className="text-muted-foreground mt-1 text-xs">
            Active commit: {commitQueue.branch.activeCommit?.workflowCommit.title ?? "None"}
          </div>
        </div>
        <Badge variant="secondary">{commitQueue.rows.length} commits</Badge>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto pr-1">
        {commitQueue.rows.map((row) => {
          const selected = row.workflowCommit.id === selectedCommit?.workflowCommit.id;
          const active = row.workflowCommit.id === commitQueue.branch.workflowBranch.activeCommitId;
          return (
            <div
              className={`rounded-lg border px-3 py-3 ${
                selected ? "border-foreground/40 bg-muted/60" : "border-border/70"
              }`}
              key={row.workflowCommit.id}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium">
                    {row.workflowCommit.order}. {row.workflowCommit.title}
                  </div>
                  <div className="text-muted-foreground mt-1 text-xs">
                    {row.workflowCommit.commitKey}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {active ? <Badge variant="default">active</Badge> : null}
                  <Badge variant="outline">{row.workflowCommit.state}</Badge>
                </div>
              </div>
              <div className="text-muted-foreground mt-3 space-y-1 text-xs">
                <div>{formatRepositoryCommitSummary(row)}</div>
              </div>
            </div>
          );
        })}
      </div>
      {selectedCommit ? (
        <div className="border-border/70 grid gap-3 rounded-lg border border-dashed px-3 py-3">
          <div className="font-medium">Selected commit detail</div>
          <DetailField label="Commit" value={selectedCommit.workflowCommit.title} />
          <DetailField label="State" value={selectedCommit.workflowCommit.state} />
          <DetailField
            label="Repository commit"
            value={formatRepositoryCommitSummary(selectedCommit)}
          />
        </div>
      ) : null}
    </div>
  );
}

export function WorkflowReviewSurface({
  readState,
  search,
  startupState,
}: {
  readonly readState: WorkflowReviewReadState;
  readonly search: WorkflowRouteSearch;
  readonly startupState: WorkflowReviewStartupState;
}) {
  const selectedBranchId =
    readState.status === "ready"
      ? (readState.commitQueue?.branch.workflowBranch.id ??
        (startupState.kind === "ready" ? startupState.selectedBranch?.id : undefined))
      : startupState.kind === "ready"
        ? startupState.selectedBranch?.id
        : undefined;
  const projectId = startupState.kind === "missing-data" ? search.project : startupState.project.id;
  const showLoadingPanels = startupState.kind === "ready" && readState.status === "loading";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-workflow-page="">
      <h1 className="text-3xl font-semibold tracking-tight">Workflow</h1>
      <PageHeader
        branchCount={readState.status === "ready" ? readState.branchBoard.rows.length : undefined}
        commitCount={readState.status === "ready" ? readState.commitQueue?.rows.length : undefined}
        projectId={projectId}
        selectedBranchId={selectedBranchId}
      />

      {readState.status === "error" ? (
        <Card className="border-destructive/20 bg-card/95 border shadow-sm">
          <CardHeader>
            <CardTitle>Workflow review read failed</CardTitle>
            <CardDescription>{readState.message}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {readState.code ? <code>{readState.code}</code> : null}
            <RecoveryHint />
          </CardContent>
        </Card>
      ) : null}

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1fr)_minmax(0,1.1fr)]">
        <PanelShell
          description="Select a workflow branch from the resolved project scope."
          title="Branch board"
        >
          <BranchBoardPanel
            activeBranchId={selectedBranchId}
            branchBoard={readState.status === "ready" ? readState.branchBoard : undefined}
            projectId={projectId}
            startupState={startupState}
          />
        </PanelShell>

        <PanelShell
          description="Inspect the selected branch, repository observation, and latest session."
          title="Branch detail"
        >
          {showLoadingPanels ? (
            <EmptyPanelBody
              detail="Read `ProjectBranchScope` first, then resolve the selected branch detail from the scoped results."
              title="Loading branch detail"
            />
          ) : (
            <BranchDetailPanel
              branchBoard={readState.status === "ready" ? readState.branchBoard : undefined}
              commitQueue={readState.status === "ready" ? readState.commitQueue : undefined}
              startupState={startupState}
            />
          )}
        </PanelShell>

        <PanelShell
          description="Review the selected branch commit queue without widening back to the whole graph."
          title="Commit queue"
        >
          {showLoadingPanels ? (
            <EmptyPanelBody
              detail="The route is waiting for the selected branch commit queue to finish loading."
              title="Loading commit queue"
            />
          ) : (
            <CommitQueuePanel
              commitQueue={readState.status === "ready" ? readState.commitQueue : undefined}
            />
          )}
        </PanelShell>
      </div>

      {startupState.kind !== "ready" || readState.status !== "ready" ? <RecoveryHint /> : null}
    </div>
  );
}

export function WorkflowReviewPage({
  onSearchChange,
  search,
}: {
  readonly onSearchChange?: (search: WorkflowRouteSearch) => void | Promise<void>;
  readonly search: WorkflowRouteSearch;
}) {
  const runtime = useGraphRuntime();
  const contract = useMemo(() => createWorkflowReviewStartupContract(search), [search]);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const visibleProjects = useMemo(
    () =>
      runtime.graph.workflowProject
        .list()
        .map((project) => ({
          id: project.id,
          title: project.name,
        }))
        .sort(
          (left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id),
        ),
    [refreshVersion, runtime],
  );
  const visibleBranches = useMemo(
    () =>
      runtime.graph.workflowBranch.list().map((branch) => ({
        id: branch.id,
        projectId: branch.project,
        queueRank: branch.queueRank,
        title: branch.name,
        updatedAt: branch.updatedAt?.toISOString(),
      })),
    [refreshVersion, runtime],
  );
  const startupState = useMemo(
    () => resolveWorkflowReviewStartupState(visibleProjects, visibleBranches, contract),
    [contract, visibleBranches, visibleProjects],
  );
  const [readState, setReadState] = useState<WorkflowReviewReadState>({ status: "loading" });
  const canonicalSearch = useMemo(
    () => resolveCanonicalWorkflowRouteSearch(search, startupState),
    [search, startupState],
  );

  useEffect(() => {
    if (!onSearchChange || !canonicalSearch) {
      return;
    }
    void onSearchChange(canonicalSearch);
  }, [canonicalSearch, onSearchChange]);

  useEffect(() => {
    let cancelled = false;
    let stopLoop: (() => Promise<void>) | undefined;

    void startWorkflowReviewRefreshLoop({
      liveSync: createWorkflowReviewLiveSync(runtime.sync),
      onRefresh: () => {
        setRefreshVersion((current) => current + 1);
      },
    })
      .then((loop) => {
        if (cancelled) {
          void loop.stop();
          return;
        }
        stopLoop = loop.stop.bind(loop);
      })
      .catch(() => {
        // Keep the workflow review route readable even when live refresh setup fails.
      });

    return () => {
      cancelled = true;
      if (stopLoop) {
        void stopLoop();
      }
    };
  }, [runtime]);

  useEffect(() => {
    if (startupState.kind !== "ready") {
      setReadState({ status: "loading" });
      return;
    }

    const controller = new AbortController();
    setReadState({ status: "loading" });

    void (async () => {
      try {
        const branchBoard = await requestWorkflowRead(
          {
            kind: "project-branch-scope",
            query: {
              filter: {
                showUnmanagedRepositoryBranches: true,
              },
              projectId: startupState.project.id,
            },
          },
          {
            signal: controller.signal,
          },
        );

        const selectedBranchId =
          startupState.selectedBranch?.id ?? branchBoard.result.rows[0]?.workflowBranch.id;

        if (!selectedBranchId) {
          setReadState({
            branchBoard: branchBoard.result,
            status: "ready",
          });
          return;
        }

        const commitQueue = await requestWorkflowRead(
          {
            kind: "commit-queue-scope",
            query: {
              branchId: selectedBranchId,
            },
          },
          {
            signal: controller.signal,
          },
        );

        setReadState({
          branchBoard: branchBoard.result,
          commitQueue: commitQueue.result,
          status: "ready",
        });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        const message =
          error instanceof WorkflowReadClientError || error instanceof Error
            ? error.message
            : String(error);
        setReadState({
          ...(error instanceof WorkflowReadClientError && error.code ? { code: error.code } : {}),
          message,
          status: "error",
        });
      }
    })();

    return () => {
      controller.abort();
    };
  }, [refreshVersion, startupState]);

  return (
    <WorkflowReviewSurface readState={readState} search={search} startupState={startupState} />
  );
}
