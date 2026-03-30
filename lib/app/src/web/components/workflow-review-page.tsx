"use client";

import type {
  AgentSessionAppendEvent,
  CommitQueueScopeCommitRow,
  CommitQueueScopeResult,
  CommitQueueScopeSessionSummary,
  ProjectBranchScopeRepositoryObservation,
  ProjectBranchScopeResult,
} from "@io/graph-module-workflow";
import { Badge } from "@io/web/badge";
import { Button } from "@io/web/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@io/web/card";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import type {
  BrowserAgentActiveSessionLookupResult,
  BrowserAgentRuntimeProbe,
  CodexSessionLaunchFailure,
  CodexSessionLaunchPreference,
  CodexSessionLaunchResult,
  CodexSessionLaunchSuccess,
} from "@op/cli/browser-agent";
import {
  observeBrowserAgentSessionEvents,
  probeBrowserAgentRuntime,
  requestBrowserAgentActiveSessionLookup,
  requestBrowserAgentLaunch,
} from "@op/cli/browser-agent";
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
  createWorkflowSessionFeedContract,
  resolveWorkflowSessionFeedSelectionState,
  type WorkflowSessionFeedReadResult,
  type WorkflowSessionFeedSelectionState,
} from "../lib/workflow-session-feed-contract.js";
import {
  requestWorkflowRead,
  WorkflowReadClientError,
  type CommitQueueScopeWorkflowReadResponse,
  type ProjectBranchScopeWorkflowReadResponse,
} from "../lib/workflow-transport.js";
import { useWebAuthSession } from "./auth-shell.js";
import { useGraphRuntime } from "./graph-runtime-bootstrap.js";
import {
  appendWorkflowSessionLiveEvent,
  createWorkflowSessionLiveEvent,
  mergeWorkflowSessionTimelineEvents,
  partitionWorkflowSessionLiveEvents,
  reconcileWorkflowSessionLiveEvents,
  type WorkflowSessionLiveEvent,
} from "../lib/workflow-session-live.js";

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

export type WorkflowSessionFeedReadState =
  | { readonly status: "loading" }
  | {
      readonly result: Extract<
        WorkflowSessionFeedSelectionState,
        { readonly kind: "missing-data" }
      >;
      readonly status: "missing-data";
    }
  | {
      readonly result: Extract<
        WorkflowSessionFeedSelectionState,
        { readonly kind: "stale-selection" }
      >;
      readonly status: "stale-selection";
    }
  | {
      readonly result: WorkflowSessionFeedReadResult;
      readonly status: "ready";
    }
  | {
      readonly code?: string;
      readonly message: string;
      readonly status: "error";
    };

type SessionLookupState =
  | { readonly status: "idle" | "checking" }
  | {
      readonly message: string;
      readonly status: "failed";
    }
  | {
      readonly result: BrowserAgentActiveSessionLookupResult | CodexSessionLaunchFailure;
      readonly status: "ready";
    };

type SessionActionModel = {
  readonly availability: "available" | "unavailable";
  readonly description: string;
  readonly label: string;
  readonly preference?: CodexSessionLaunchPreference;
  readonly reason?: string;
};

type SessionActionRequestState = {
  readonly message: string;
  readonly result?: CodexSessionLaunchResult;
  readonly status: "failure" | "pending" | "success";
};

type SessionLiveState =
  | {
      readonly events: readonly WorkflowSessionLiveEvent[];
      readonly status: "idle";
    }
  | {
      readonly browserAgentSessionId: string;
      readonly events: readonly WorkflowSessionLiveEvent[];
      readonly message?: string;
      readonly sessionId: string;
      readonly status: "connecting" | "streaming" | "unavailable";
    };

function buildWorkflowHref(search: WorkflowRouteSearch): string {
  const params = new URLSearchParams();
  if (search.project) {
    params.set("project", search.project);
  }
  if (search.branch) {
    params.set("branch", search.branch);
  }
  if (search.commit) {
    params.set("commit", search.commit);
  }
  if (search.session) {
    params.set("session", search.session);
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

function resolveSelectedCommitRow(
  commitQueue: CommitQueueScopeResult | undefined,
  selectedCommitId?: string,
) {
  if (!commitQueue || commitQueue.rows.length === 0) {
    return undefined;
  }

  if (selectedCommitId) {
    return commitQueue.rows.find((row) => row.commit.id === selectedCommitId);
  }

  const activeCommitId =
    commitQueue.branch.activeCommit?.commit.id ?? commitQueue.branch.branch.activeCommitId;

  return commitQueue.rows.find((row) => row.commit.id === activeCommitId) ?? commitQueue.rows[0];
}

function isLaunchFailure(result: CodexSessionLaunchResult): result is CodexSessionLaunchFailure {
  return result.ok === false;
}

function isLaunchSuccess(result: CodexSessionLaunchResult): result is CodexSessionLaunchSuccess {
  return result.ok === true;
}

function formatLaunchOutcome(result: CodexSessionLaunchSuccess): string {
  return result.outcome === "attached"
    ? `Attached to ${result.session.sessionKey}.`
    : `Launched ${result.session.sessionKey}.`;
}

function formatLookupMetadata(result: BrowserAgentActiveSessionLookupResult): string | undefined {
  if (!result.ok || !result.found) {
    return undefined;
  }
  return `Reusable session ${result.session.sessionKey} is active in the local browser-agent runtime.`;
}

function formatBrowserAgentRequestError(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

function resolveLiveSessionCandidate(input: {
  readonly branchLookupState: SessionLookupState;
  readonly commitLookupState: SessionLookupState;
  readonly search: WorkflowRouteSearch;
}) {
  const lookupState = input.search.commit ? input.commitLookupState : input.branchLookupState;
  if (lookupState.status !== "ready" || !lookupState.result.ok || !lookupState.result.found) {
    return undefined;
  }

  if (input.search.session && lookupState.result.session.id !== input.search.session) {
    return undefined;
  }

  return {
    attach: lookupState.result.attach,
    sessionId: lookupState.result.session.id,
  };
}

export function createBranchSessionActionModel(input: {
  readonly authStatus: "booting" | "error" | "expired" | "ready" | "signed-out";
  readonly commitQueue?: CommitQueueScopeResult;
  readonly lookupState: SessionLookupState;
  readonly runtime: BrowserAgentRuntimeProbe;
  readonly selectedBranchState?: ProjectBranchScopeResult["rows"][number]["branch"]["state"];
}): SessionActionModel {
  const description = "Start a branch-scoped planning session from the selected workflow branch.";

  if (input.authStatus !== "ready") {
    return {
      availability: "unavailable",
      description,
      label: "Launch branch session",
      reason: "Sign in before launching or attaching to a branch session.",
    };
  }

  if (input.runtime.status !== "ready") {
    return {
      availability: "unavailable",
      description,
      label: "Launch branch session",
      reason: input.runtime.message,
    };
  }

  if (!input.selectedBranchState) {
    return {
      availability: "unavailable",
      description,
      label: "Launch branch session",
      reason: "Select a workflow branch first.",
    };
  }

  if (input.selectedBranchState === "done" || input.selectedBranchState === "archived") {
    return {
      availability: "unavailable",
      description,
      label: "Launch branch session",
      reason: "Completed and archived branches do not accept new branch sessions.",
    };
  }

  const latestSession = input.commitQueue?.branch.latestSession;
  if (latestSession?.runtimeState === "running" && latestSession.subject.kind === "commit") {
    return {
      availability: "unavailable",
      description,
      label: "Launch branch session",
      reason: "The selected branch already has a running commit-scoped session.",
    };
  }

  if (input.lookupState.status === "ready" && input.lookupState.result.ok === false) {
    return {
      availability: "unavailable",
      description,
      label: "Launch branch session",
      reason: input.lookupState.result.message,
    };
  }

  if (input.lookupState.status === "failed") {
    return {
      availability: "unavailable",
      description,
      label: "Launch branch session",
      reason: input.lookupState.message,
    };
  }

  if (
    input.lookupState.status === "ready" &&
    input.lookupState.result.ok &&
    input.lookupState.result.found
  ) {
    return {
      availability: "available",
      description: "Reuse the running branch-scoped session for the selected workflow branch.",
      label: "Attach branch session",
      preference: { mode: "attach-existing" },
    };
  }

  return {
    availability: "available",
    description:
      input.lookupState.status === "checking"
        ? "Check the local runtime for a reusable branch-scoped session before launching."
        : description,
    label: "Launch branch session",
    preference: { mode: "attach-or-launch" },
  };
}

export function createCommitSessionActionModel(input: {
  readonly authStatus: "booting" | "error" | "expired" | "ready" | "signed-out";
  readonly commitQueue?: CommitQueueScopeResult;
  readonly lookupState: SessionLookupState;
  readonly runtime: BrowserAgentRuntimeProbe;
  readonly selectedCommitId?: string;
  readonly selectedBranchState?: ProjectBranchScopeResult["rows"][number]["branch"]["state"];
}): SessionActionModel {
  const description = "Start a commit-scoped execution session from the selected workflow commit.";
  const selectedCommit = resolveSelectedCommitRow(input.commitQueue, input.selectedCommitId);

  if (input.authStatus !== "ready") {
    return {
      availability: "unavailable",
      description,
      label: "Launch commit session",
      reason: "Sign in before launching or attaching to a commit session.",
    };
  }

  if (input.runtime.status !== "ready") {
    return {
      availability: "unavailable",
      description,
      label: "Launch commit session",
      reason: input.runtime.message,
    };
  }

  if (!input.commitQueue) {
    return {
      availability: "unavailable",
      description,
      label: "Launch commit session",
      reason: "Select a workflow branch first.",
    };
  }

  if (!selectedCommit) {
    return {
      availability: "unavailable",
      description,
      label: "Launch commit session",
      reason: "Select a workflow commit first.",
    };
  }

  if (input.lookupState.status === "ready" && input.lookupState.result.ok === false) {
    return {
      availability: "unavailable",
      description,
      label: "Launch commit session",
      reason: input.lookupState.result.message,
    };
  }

  if (input.lookupState.status === "failed") {
    return {
      availability: "unavailable",
      description,
      label: "Launch commit session",
      reason: input.lookupState.message,
    };
  }

  const latestSession = input.commitQueue.branch.latestSession;
  const hasRunningSession =
    latestSession?.runtimeState === "running" &&
    latestSession.subject.kind === "commit" &&
    latestSession.subject.commitId === selectedCommit.commit.id;
  const runningBranchSession =
    latestSession?.runtimeState === "running" && latestSession.subject.kind === "branch";
  const runningOtherCommitSession =
    latestSession?.runtimeState === "running" &&
    latestSession.subject.kind === "commit" &&
    latestSession.subject.commitId !== selectedCommit.commit.id;
  const selectedBranchState = input.selectedBranchState;
  let reason: string | undefined;

  if (
    selectedBranchState === "backlog" ||
    selectedBranchState === "done" ||
    selectedBranchState === "archived"
  ) {
    reason = "The selected branch is not in a launchable state for commit execution.";
  } else if (
    input.commitQueue.branch.branch.activeCommitId &&
    input.commitQueue.branch.branch.activeCommitId !== selectedCommit.commit.id
  ) {
    reason = "Select the branch active commit to launch commit execution.";
  } else if (selectedCommit.commit.state === "planned") {
    reason = "Planned commits must be promoted before execution can launch.";
  } else if (
    selectedCommit.commit.state === "committed" ||
    selectedCommit.commit.state === "dropped"
  ) {
    reason = "Committed and dropped commits do not accept execution sessions.";
  } else if (runningBranchSession) {
    reason = "The selected branch already has a running branch-scoped session.";
  } else if (runningOtherCommitSession) {
    reason = "Another commit on the selected branch already has a running session.";
  }

  if (reason) {
    return {
      availability: "unavailable",
      description,
      label: "Launch commit session",
      reason,
    };
  }

  if (
    input.lookupState.status === "ready" &&
    input.lookupState.result.ok &&
    input.lookupState.result.found
  ) {
    return {
      availability: "available",
      description: "Reuse the running commit-scoped session for the selected workflow commit.",
      label: "Attach commit session",
      preference: { mode: "attach-existing" },
    };
  }

  return {
    availability: "available",
    description:
      input.lookupState.status === "checking"
        ? "Check the local runtime for a reusable commit-scoped session before launching."
        : hasRunningSession
          ? "Reuse the running commit-scoped session for the selected workflow commit."
          : description,
    label: hasRunningSession ? "Attach commit session" : "Launch commit session",
    preference: { mode: "attach-or-launch" },
  };
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
  runtime,
  selectedBranchId,
}: {
  readonly branchCount?: number;
  readonly commitCount?: number;
  readonly projectId?: string;
  readonly runtime: BrowserAgentRuntimeProbe;
  readonly selectedBranchId?: string;
}) {
  return (
    <Card className="border-border/70 bg-card/95 border shadow-sm">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>Workflow review</CardTitle>
            <CardDescription>
              `/workflow` now resolves the shipped `workflow` review scope into a workflow branch
              board, branch detail, and commit queue layout.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline">workflow-review scope</Badge>
            <Badge variant="outline">branch board</Badge>
            <Badge variant="outline">commit queue</Badge>
            <Badge variant={runtime.status === "ready" ? "secondary" : "outline"}>
              {runtime.status === "ready" ? "browser-agent ready" : "browser-agent unavailable"}
            </Badge>
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

function BrowserAgentStatusCard({ runtime }: { readonly runtime: BrowserAgentRuntimeProbe }) {
  if (runtime.status === "checking") {
    return (
      <Card className="border-border/70 bg-card/95 border shadow-sm">
        <CardHeader>
          <CardTitle>Checking local browser-agent runtime</CardTitle>
          <CardDescription>
            Probe the localhost browser bridge before browser launch and attach actions mount here.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (runtime.status === "ready") {
    return (
      <Card className="border-border/70 bg-card/95 border shadow-sm">
        <CardHeader>
          <CardTitle>Local browser-agent runtime ready</CardTitle>
          <CardDescription>{runtime.message}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-2">
          <DetailField label="Started at" value={runtime.startedAt} />
          <DetailField label="Launch transport" value={runtime.launchPath} />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/70 bg-card/95 border shadow-sm">
      <CardHeader>
        <CardTitle>Local browser-agent runtime unavailable</CardTitle>
        <CardDescription>{runtime.message}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <code>io browser-agent</code>
        <p className="text-muted-foreground text-sm">
          Browser launch and attach actions stay unavailable until this machine exposes the local
          runtime bridge.
        </p>
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
          const selected = row.branch.id === activeBranchId;
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
                branch: row.branch.id,
              })}
              key={row.branch.id}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium">{row.branch.title}</div>
                  <div className="text-muted-foreground mt-1 text-xs">{row.branch.branchKey}</div>
                </div>
                <Badge variant={selected ? "default" : "outline"}>{row.branch.state}</Badge>
              </div>
              <div className="text-muted-foreground mt-3 space-y-1 text-xs">
                <div>Queue rank: {row.branch.queueRank ?? "unranked"}</div>
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
  branchAction,
  branchActionState,
  branchBoard,
  branchLookupState,
  commitQueue,
  onTriggerBranchSession,
  startupState,
}: {
  readonly branchAction: SessionActionModel;
  readonly branchActionState?: SessionActionRequestState;
  readonly branchBoard?: ProjectBranchScopeResult;
  readonly branchLookupState: SessionLookupState;
  readonly commitQueue?: CommitQueueScopeResult;
  readonly onTriggerBranchSession: () => void;
  readonly startupState: WorkflowReviewStartupState;
}) {
  const selectedBranchId =
    commitQueue?.branch.branch.id ??
    (startupState.kind === "ready" ? startupState.selectedBranch?.id : undefined);
  const selectedRow = branchBoard?.rows.find((row) => row.branch.id === selectedBranchId);

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
          <div className="text-lg font-semibold">{selectedRow.branch.title}</div>
          <div className="text-muted-foreground mt-1 font-mono text-xs">
            {selectedRow.branch.branchKey}
          </div>
        </div>
        <Badge>{selectedRow.branch.state}</Badge>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <DetailField
          label="Queue rank"
          value={String(selectedRow.branch.queueRank ?? "unranked")}
        />
        <DetailField
          label="Repository branch"
          value={formatRepositoryObservation(selectedRow.repositoryBranch)}
        />
        <DetailField label="Latest session" value={formatLatestSession(commitQueue)} />
        <DetailField
          label="Active commit"
          value={commitQueue?.branch.activeCommit?.commit.title ?? "None selected"}
        />
      </div>
      <DetailField
        label="Goal"
        value={selectedRow.branch.goalSummary ?? "No goal summary recorded."}
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
      <BranchSessionActionCard
        action={branchAction}
        actionState={branchActionState}
        lookupState={branchLookupState}
        onTrigger={onTriggerBranchSession}
        pending={branchActionState?.status === "pending"}
      />
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

function formatEnumLabel(value: string): string {
  return value.replaceAll("-", " ");
}

function formatBranchLatestSessionSummary(
  session:
    | CommitQueueScopeSessionSummary
    | Extract<
        WorkflowSessionFeedReadState,
        { readonly status: "stale-selection" }
      >["result"]["availableCommitIds"],
): string {
  if (!session || Array.isArray(session) || !("kind" in session)) {
    return "No branch-scoped session summary recorded.";
  }
  return `${session.kind} / ${session.runtimeState} / ${session.sessionKey}`;
}

function formatSessionFeedSubjectLabel(
  result: Extract<WorkflowSessionFeedReadResult, { readonly status: "ready" }>,
): string {
  return result.subject.commit
    ? `${result.subject.branch.title} -> ${result.subject.commit.title}`
    : result.subject.branch.title;
}

function formatSessionFeedFinalization(
  finalization: Extract<
    WorkflowSessionFeedReadResult,
    { readonly status: "ready" }
  >["finalization"],
): { readonly detail: string; readonly label: string } {
  switch (finalization.status) {
    case "not-applicable":
      return {
        detail: "Branch-scoped sessions do not produce commit finalization state.",
        label: "not applicable",
      };
    case "pending":
      return {
        detail:
          "The session has produced retained output, but graph-backed finalization is still pending.",
        label: "pending",
      };
    case "finalized":
      return {
        detail:
          [
            finalization.linearState,
            finalization.commitSha ? `commit ${finalization.commitSha}` : undefined,
            finalization.landedAt ? `landed ${finalization.landedAt}` : undefined,
          ]
            .filter((value): value is string => Boolean(value))
            .join(" | ") || "Finalization recorded.",
        label: "finalized",
      };
    case "unknown":
      return {
        detail: "Finalization metadata is not yet materialized as graph-backed retained state.",
        label: "unknown",
      };
  }
}

function formatSessionFeedHistory(
  history: Extract<WorkflowSessionFeedReadResult, { readonly status: "ready" }>["history"],
): { readonly detail: string; readonly label: string } {
  switch (history.status) {
    case "empty":
      return {
        detail: "No retained session events were persisted for this session yet.",
        label: "empty",
      };
    case "complete":
      return {
        detail: `${history.persistedEventCount} retained events through sequence ${history.lastSequence}.`,
        label: "complete",
      };
    case "partial":
      return {
        detail: `${history.persistedEventCount} retained events with ${formatEnumLabel(history.reason)}.`,
        label: "partial",
      };
  }
}

function stringifyRecord(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

type WorkflowTimelineItem =
  | {
      readonly event: Extract<
        AgentSessionAppendEvent,
        { readonly type: "codex-notification" | "session" | "status" }
      >;
      readonly key: string;
      readonly kind: "event";
      readonly transient: boolean;
    }
  | {
      readonly encoding: Extract<
        AgentSessionAppendEvent,
        { readonly type: "raw-line" }
      >["encoding"];
      readonly endSequence: number;
      readonly key: string;
      readonly kind: "transcript";
      readonly lines: readonly string[];
      readonly startSequence: number;
      readonly stream: Extract<AgentSessionAppendEvent, { readonly type: "raw-line" }>["stream"];
      readonly timestamp: string;
      readonly transient: boolean;
    };

type WorkflowTimelineEntry = ReturnType<typeof mergeWorkflowSessionTimelineEvents>[number];

function buildWorkflowTimelineItems(
  events: readonly WorkflowTimelineEntry[],
): readonly WorkflowTimelineItem[] {
  const items: WorkflowTimelineItem[] = [];
  let transcript:
    | {
        readonly encoding: Extract<
          WorkflowTimelineItem,
          { readonly kind: "transcript" }
        >["encoding"];
        endSequence: number;
        readonly lines: string[];
        readonly startSequence: number;
        readonly stream: Extract<WorkflowTimelineItem, { readonly kind: "transcript" }>["stream"];
        readonly timestamp: string;
        readonly transient: boolean;
      }
    | undefined;

  function flushTranscript() {
    if (!transcript) {
      return;
    }
    items.push({
      encoding: transcript.encoding,
      endSequence: transcript.endSequence,
      key: `transcript:${transcript.startSequence}:${transcript.endSequence}`,
      kind: "transcript",
      lines: transcript.lines,
      startSequence: transcript.startSequence,
      stream: transcript.stream,
      timestamp: transcript.timestamp,
      transient: transcript.transient,
    });
    transcript = undefined;
  }

  for (const entry of events) {
    const event = entry.event;
    if (event.type === "raw-line") {
      if (
        transcript &&
        transcript.stream === event.stream &&
        transcript.encoding === event.encoding &&
        transcript.endSequence === event.sequence - 1 &&
        transcript.transient === entry.transient
      ) {
        transcript.lines.push(event.line);
        transcript.endSequence = event.sequence;
        continue;
      }

      flushTranscript();
      transcript = {
        encoding: event.encoding,
        endSequence: event.sequence,
        lines: [event.line],
        startSequence: event.sequence,
        stream: event.stream,
        timestamp: event.timestamp,
        transient: entry.transient,
      };
      continue;
    }

    flushTranscript();
    items.push({
      event,
      key: `${event.type}:${event.sequence}`,
      kind: "event",
      transient: entry.transient,
    });
  }

  flushTranscript();
  return items;
}

function SessionTimelineItem({ item }: { readonly item: WorkflowTimelineItem }) {
  if (item.kind === "transcript") {
    return (
      <div
        className={`rounded-lg border px-3 py-3 ${
          item.transient ? "border-primary/30 bg-primary/5 border-dashed" : "border-border/70"
        }`}
      >
        <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
          <div className="font-medium">
            {item.stream} transcript [{item.startSequence}-{item.endSequence}]
          </div>
          <div className="text-muted-foreground text-xs">{item.timestamp}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{item.stream}</Badge>
          <Badge variant="outline">{item.encoding}</Badge>
          {item.transient ? <Badge variant="secondary">transient</Badge> : null}
        </div>
        <pre className="bg-muted/40 mt-3 overflow-x-auto rounded-md px-3 py-3 text-xs whitespace-pre-wrap">
          {item.lines.join("\n")}
        </pre>
      </div>
    );
  }

  const { event } = item;
  const title =
    event.type === "session"
      ? `Session ${event.phase}`
      : event.type === "status"
        ? (event.text ?? event.code)
        : event.method;
  const detail =
    event.type === "status"
      ? event.text
      : event.type === "codex-notification"
        ? stringifyRecord(event.params)
        : event.data
          ? stringifyRecord(event.data)
          : undefined;

  return (
    <div
      className={`rounded-lg border px-3 py-3 ${
        item.transient ? "border-primary/30 bg-primary/5 border-dashed" : "border-border/70"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="font-medium">{title}</div>
          <div className="text-muted-foreground text-xs">
            Sequence {event.sequence} at {event.timestamp}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{event.type}</Badge>
          {event.type === "session" ? <Badge variant="outline">{event.phase}</Badge> : null}
          {event.type === "status" ? <Badge variant="outline">{event.code}</Badge> : null}
          {item.transient ? <Badge variant="secondary">transient</Badge> : null}
        </div>
      </div>
      {detail ? (
        <pre className="bg-muted/40 mt-3 overflow-x-auto rounded-md px-3 py-3 text-xs whitespace-pre-wrap">
          {detail}
        </pre>
      ) : null}
    </div>
  );
}

function SessionResourcesPanel({
  result,
}: {
  readonly result: Extract<WorkflowSessionFeedReadResult, { readonly status: "ready" }>;
}) {
  return (
    <div className="grid gap-4">
      <div className="border-border/70 rounded-lg border px-3 py-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="font-medium">Artifacts</div>
          <Badge variant="secondary">{result.artifacts.length}</Badge>
        </div>
        {result.artifacts.length === 0 ? (
          <p className="text-muted-foreground text-sm">No retained artifacts attached.</p>
        ) : (
          <div className="space-y-3">
            {result.artifacts.map((artifact) => (
              <div
                className="border-border/70 rounded-lg border border-dashed px-3 py-3"
                key={artifact.id}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="font-medium">{artifact.title}</div>
                  <Badge variant="outline">{artifact.kind}</Badge>
                </div>
                <div className="text-muted-foreground mt-1 text-xs">{artifact.createdAt}</div>
                {artifact.bodyText ? (
                  <pre className="bg-muted/40 mt-3 overflow-x-auto rounded-md px-3 py-3 text-xs whitespace-pre-wrap">
                    {artifact.bodyText}
                  </pre>
                ) : artifact.blobId ? (
                  <div className="text-muted-foreground mt-3 text-xs">Blob: {artifact.blobId}</div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-border/70 rounded-lg border px-3 py-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="font-medium">Decisions</div>
          <Badge variant="secondary">{result.decisions.length}</Badge>
        </div>
        {result.decisions.length === 0 ? (
          <p className="text-muted-foreground text-sm">No retained decisions attached.</p>
        ) : (
          <div className="space-y-3">
            {result.decisions.map((decision) => (
              <div
                className="border-border/70 rounded-lg border border-dashed px-3 py-3"
                key={decision.id}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="font-medium">{decision.summary}</div>
                  <Badge variant="outline">{decision.kind}</Badge>
                </div>
                <div className="text-muted-foreground mt-1 text-xs">{decision.createdAt}</div>
                {decision.details ? (
                  <p className="text-muted-foreground mt-3 text-sm">{decision.details}</p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SessionFeedPanel({
  liveSessionState,
  search,
  sessionFeedState,
}: {
  readonly liveSessionState: SessionLiveState;
  readonly search: WorkflowRouteSearch;
  readonly sessionFeedState: WorkflowSessionFeedReadState;
}) {
  if (sessionFeedState.status === "loading") {
    return (
      <EmptyPanelBody
        detail="Resolve the selected branch and commit context before the browser requests retained session history."
        title="Loading session panel"
      />
    );
  }

  if (sessionFeedState.status === "missing-data") {
    return (
      <EmptyPanelBody detail={sessionFeedState.result.message} title="Session panel unavailable" />
    );
  }

  if (sessionFeedState.status === "stale-selection") {
    return (
      <div className="flex h-full min-h-0 flex-col justify-center gap-3 rounded-lg border border-dashed px-4 py-6 text-center">
        <p className="font-medium">Session selection is stale</p>
        <p className="text-muted-foreground text-sm">{sessionFeedState.result.message}</p>
        {sessionFeedState.result.availableCommitIds.length > 0 ? (
          <p className="text-muted-foreground text-xs">
            Visible commits: {sessionFeedState.result.availableCommitIds.join(", ")}
          </p>
        ) : null}
        <a
          className="text-sm underline underline-offset-2"
          href={buildWorkflowHref({
            branch: search.branch,
            project: search.project,
          })}
        >
          Clear stale session selection
        </a>
      </div>
    );
  }

  if (sessionFeedState.status === "error") {
    return (
      <div className="border-destructive/20 bg-destructive/5 rounded-lg border px-4 py-4 text-sm">
        <div className="font-medium">Session feed read failed</div>
        <div className="mt-2">{sessionFeedState.message}</div>
        {sessionFeedState.code ? <code className="mt-3 block">{sessionFeedState.code}</code> : null}
      </div>
    );
  }

  if (sessionFeedState.result.status === "no-session") {
    return (
      <div className="grid gap-3">
        <EmptyPanelBody
          detail={
            sessionFeedState.result.query.subject.kind === "commit"
              ? "No retained session is recorded for the selected workflow commit."
              : "No retained branch-scoped session is recorded for the selected workflow branch."
          }
          title="No retained session"
        />
        {sessionFeedState.result.branchLatestSession ? (
          <div className="border-border/70 rounded-lg border px-3 py-3 text-sm">
            Branch latest session:{" "}
            {formatBranchLatestSessionSummary(sessionFeedState.result.branchLatestSession)}
          </div>
        ) : null}
      </div>
    );
  }

  if (sessionFeedState.result.status === "stale-selection") {
    const clearSearch =
      sessionFeedState.result.query.session.kind === "session-id"
        ? {
            branch: sessionFeedState.result.query.subject.branchId,
            ...(sessionFeedState.result.query.subject.kind === "commit"
              ? { commit: sessionFeedState.result.query.subject.commitId }
              : {}),
            project: sessionFeedState.result.query.projectId,
          }
        : {
            branch: sessionFeedState.result.query.subject.branchId,
            project: sessionFeedState.result.query.projectId,
          };

    return (
      <div className="flex h-full min-h-0 flex-col justify-center gap-3 rounded-lg border border-dashed px-4 py-6 text-center">
        <p className="font-medium">Pinned session is stale</p>
        <p className="text-muted-foreground text-sm">
          {sessionFeedState.result.reason === "session-not-found"
            ? "The selected session is no longer visible in authoritative graph history."
            : "The selected session no longer matches the current workflow subject."}
        </p>
        {sessionFeedState.result.branchLatestSession ? (
          <p className="text-muted-foreground text-xs">
            Branch latest session:{" "}
            {formatBranchLatestSessionSummary(sessionFeedState.result.branchLatestSession)}
          </p>
        ) : null}
        <a className="text-sm underline underline-offset-2" href={buildWorkflowHref(clearSearch)}>
          Return to the latest subject session
        </a>
      </div>
    );
  }

  const result = sessionFeedState.result;
  const localLiveEvents =
    liveSessionState.status !== "idle" && liveSessionState.sessionId === result.header.id
      ? liveSessionState.events
      : [];
  const liveReconciliation = partitionWorkflowSessionLiveEvents(result.events, localLiveEvents);
  const timelineEvents = mergeWorkflowSessionTimelineEvents({
    authoritativeEvents: result.events,
    localEvents: localLiveEvents,
  });
  const transientEventCount = timelineEvents.filter((event) => event.transient).length;
  const pendingLiveEventCount = liveReconciliation.pendingEvents.length;
  const conflictingSequenceLabels = [
    ...new Set(liveReconciliation.conflictingEvents.map((event) => event.event.sequence)),
  ];
  const timelineItems = buildWorkflowTimelineItems(timelineEvents);
  const finalization = formatSessionFeedFinalization(result.finalization);
  const history = formatSessionFeedHistory(result.history);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold">{result.header.title}</div>
          <div className="text-muted-foreground mt-1 font-mono text-xs">
            {result.header.sessionKey}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge>{result.header.kind}</Badge>
          <Badge variant="secondary">{formatEnumLabel(result.runtime.state)}</Badge>
          <Badge variant="outline">{finalization.label}</Badge>
          {conflictingSequenceLabels.length > 0 ? (
            <Badge variant="outline">live drift</Badge>
          ) : null}
          {transientEventCount > 0 ? (
            <Badge variant="secondary">{transientEventCount} transient</Badge>
          ) : null}
          {search.session ? <Badge variant="outline">pinned session</Badge> : null}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <DetailField label="Session id" value={result.header.id} />
        <DetailField label="Subject" value={formatSessionFeedSubjectLabel(result)} />
        <DetailField label="Started at" value={result.runtime.startedAt} />
        <DetailField label="Ended at" value={result.runtime.endedAt ?? "Still running"} />
        <DetailField label="History" value={history.detail} />
        <DetailField label="Finalization" value={finalization.detail} />
      </div>

      {pendingLiveEventCount > 0 ? (
        <div className="border-primary/20 bg-primary/5 rounded-lg border px-3 py-3 text-sm">
          Showing {pendingLiveEventCount} locally seen update
          {pendingLiveEventCount === 1 ? "" : "s"} until graph-backed session history catches up.
        </div>
      ) : null}

      {conflictingSequenceLabels.length > 0 ? (
        <div className="border-destructive/20 bg-destructive/5 rounded-lg border px-3 py-3 text-sm">
          Local live reconciliation drifted from graph-backed history at sequence
          {conflictingSequenceLabels.length === 1 ? "" : "s"} {conflictingSequenceLabels.join(", ")}
          . Keeping the authoritative timeline visible and marking the conflicting local update
          {conflictingSequenceLabels.length === 1 ? "" : "s"} as transient.
        </div>
      ) : null}

      {liveSessionState.status === "unavailable" && liveSessionState.message ? (
        <div className="border-border/70 bg-muted/20 rounded-lg border px-3 py-3 text-sm">
          {liveSessionState.message}
        </div>
      ) : null}

      {search.commit || search.session ? (
        <div className="flex flex-wrap gap-3 text-sm">
          {search.commit ? (
            <a
              className="underline underline-offset-2"
              href={buildWorkflowHref({
                branch: result.query.subject.branchId,
                project: result.query.projectId,
                ...(search.session ? { session: search.session } : {}),
              })}
            >
              View branch session feed
            </a>
          ) : null}
          {search.session ? (
            <a
              className="underline underline-offset-2"
              href={buildWorkflowHref({
                branch: result.query.subject.branchId,
                ...(result.query.subject.kind === "commit"
                  ? { commit: result.query.subject.commitId }
                  : {}),
                project: result.query.projectId,
              })}
            >
              Follow latest subject session
            </a>
          ) : null}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,0.9fr)]">
        <div className="min-h-0">
          {result.history.status === "empty" ? (
            <EmptyPanelBody
              detail="This session exists in the graph, but no retained session events have been persisted yet."
              title="No retained history"
            />
          ) : timelineItems.length === 0 ? (
            <EmptyPanelBody
              detail={`The retained session feed is degraded and no readable timeline entries are currently available. ${history.detail}`}
              title="Retained history degraded"
            />
          ) : (
            <div className="flex min-h-0 h-full flex-col gap-3 overflow-auto pr-1">
              {timelineItems.map((item) => (
                <SessionTimelineItem item={item} key={item.key} />
              ))}
            </div>
          )}
        </div>
        <SessionResourcesPanel result={result} />
      </div>
    </div>
  );
}

function LaunchMetadataFields({ result }: { readonly result: CodexSessionLaunchSuccess }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <DetailField label="Outcome" value={result.outcome} />
      <DetailField label="Session key" value={result.session.sessionKey} />
      <DetailField label="Session id" value={result.session.id} />
      <DetailField label="Runtime state" value={result.session.runtimeState} />
      <DetailField label="Attach token" value={result.attach.attachToken} />
      <DetailField label="Attach transport" value={result.attach.transport} />
      <DetailField label="Browser-agent session" value={result.attach.browserAgentSessionId} />
      <DetailField label="Attach expiry" value={result.attach.expiresAt} />
      <DetailField label="Repository id" value={result.workspace.repositoryId} />
      <DetailField
        label="Repository branch"
        value={result.workspace.repositoryBranchName ?? "Not reported"}
      />
      <DetailField
        label="Repository root"
        value={result.workspace.repositoryRoot ?? "Not reported"}
      />
      <DetailField label="Worktree path" value={result.workspace.worktreePath ?? "Not reported"} />
    </div>
  );
}

function BranchSessionActionCard({
  action,
  actionState,
  lookupState,
  onTrigger,
  pending,
}: {
  readonly action: SessionActionModel;
  readonly actionState?: SessionActionRequestState;
  readonly lookupState: SessionLookupState;
  readonly onTrigger: () => void;
  readonly pending: boolean;
}) {
  const lookupMessage =
    lookupState.status === "checking"
      ? "Checking the local browser-agent runtime for a reusable branch session."
      : lookupState.status === "ready" && lookupState.result.ok
        ? formatLookupMetadata(lookupState.result)
        : undefined;
  const successResult =
    actionState?.status === "success" && actionState.result && isLaunchSuccess(actionState.result)
      ? actionState.result
      : undefined;

  return (
    <div className="border-border/70 grid gap-3 rounded-lg border px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="font-medium">Branch session</div>
          <p className="text-muted-foreground text-sm">{action.description}</p>
        </div>
        <Button
          disabled={action.availability !== "available" || pending}
          onClick={onTrigger}
          type="button"
          variant={action.availability === "available" ? "default" : "outline"}
        >
          {pending ? `${action.label}...` : action.label}
        </Button>
      </div>
      {action.reason ? (
        <p className="text-muted-foreground text-sm" data-workflow-branch-session-reason="">
          {action.reason}
        </p>
      ) : null}
      {lookupMessage ? (
        <p className="text-muted-foreground text-sm" data-workflow-branch-session-lookup="">
          {lookupMessage}
        </p>
      ) : null}
      {actionState ? (
        <div
          className={`rounded-lg border px-3 py-3 text-sm ${
            actionState.status === "failure"
              ? "border-destructive/20 bg-destructive/5"
              : actionState.status === "success"
                ? "border-primary/20 bg-primary/5"
                : "border-border/70 bg-muted/30"
          }`}
          data-workflow-branch-session-state={actionState.status}
        >
          {actionState.message}
        </div>
      ) : null}
      {successResult ? <LaunchMetadataFields result={successResult} /> : null}
    </div>
  );
}

function CommitSessionActionCard({
  action,
  actionState,
  lookupState,
  onTrigger,
  pending,
}: {
  readonly action: SessionActionModel;
  readonly actionState?: SessionActionRequestState;
  readonly lookupState: SessionLookupState;
  readonly onTrigger: () => void;
  readonly pending: boolean;
}) {
  const lookupMessage =
    lookupState.status === "checking"
      ? "Checking the local browser-agent runtime for a reusable commit session."
      : lookupState.status === "ready" && lookupState.result.ok
        ? formatLookupMetadata(lookupState.result)
        : undefined;
  const successResult =
    actionState?.status === "success" && actionState.result && isLaunchSuccess(actionState.result)
      ? actionState.result
      : undefined;

  return (
    <div className="border-border/70 grid gap-3 rounded-lg border px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="font-medium">Commit session</div>
          <p className="text-muted-foreground text-sm">{action.description}</p>
        </div>
        <Button
          disabled={action.availability !== "available" || pending}
          onClick={onTrigger}
          type="button"
          variant={action.availability === "available" ? "default" : "outline"}
        >
          {pending ? `${action.label}...` : action.label}
        </Button>
      </div>
      {action.reason ? (
        <p className="text-muted-foreground text-sm" data-workflow-commit-session-reason="">
          {action.reason}
        </p>
      ) : null}
      {lookupMessage ? (
        <p className="text-muted-foreground text-sm" data-workflow-commit-session-lookup="">
          {lookupMessage}
        </p>
      ) : null}
      {actionState ? (
        <div
          className={`rounded-lg border px-3 py-3 text-sm ${
            actionState.status === "failure"
              ? "border-destructive/20 bg-destructive/5"
              : actionState.status === "success"
                ? "border-primary/20 bg-primary/5"
                : "border-border/70 bg-muted/30"
          }`}
          data-workflow-commit-session-state={actionState.status}
        >
          {actionState.message}
        </div>
      ) : null}
      {successResult ? <LaunchMetadataFields result={successResult} /> : null}
    </div>
  );
}

function CommitQueuePanel({
  commitAction,
  commitActionState,
  commitLookupState,
  commitQueue,
  onTriggerCommitSession,
  projectId,
  search,
}: {
  readonly commitAction: SessionActionModel;
  readonly commitActionState?: SessionActionRequestState;
  readonly commitLookupState: SessionLookupState;
  readonly commitQueue?: CommitQueueScopeResult;
  readonly onTriggerCommitSession: () => void;
  readonly projectId?: string;
  readonly search: WorkflowRouteSearch;
}) {
  const selectedCommit = resolveSelectedCommitRow(commitQueue, search.commit);

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
          <Badge variant="outline">{commitQueue.branch.branch.state}</Badge>
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
          <div className="font-medium">{commitQueue.branch.branch.title}</div>
          <div className="text-muted-foreground mt-1 text-xs">
            Active commit: {commitQueue.branch.activeCommit?.commit.title ?? "None"}
          </div>
        </div>
        <Badge variant="secondary">{commitQueue.rows.length} commits</Badge>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto pr-1">
        {commitQueue.rows.map((row) => {
          const selected = row.commit.id === selectedCommit?.commit.id;
          const active = row.commit.id === commitQueue.branch.branch.activeCommitId;
          return (
            <a
              href={buildWorkflowHref({
                branch: commitQueue.branch.branch.id,
                commit: row.commit.id,
                project: projectId,
              })}
              className={`rounded-lg border px-3 py-3 ${
                selected ? "border-foreground/40 bg-muted/60" : "border-border/70"
              }`}
              key={row.commit.id}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium">
                    {row.commit.order}. {row.commit.title}
                  </div>
                  <div className="text-muted-foreground mt-1 text-xs">{row.commit.commitKey}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {active ? <Badge variant="default">active</Badge> : null}
                  <Badge variant="outline">{row.commit.state}</Badge>
                </div>
              </div>
              <div className="text-muted-foreground mt-3 space-y-1 text-xs">
                <div>{formatRepositoryCommitSummary(row)}</div>
              </div>
            </a>
          );
        })}
      </div>
      {selectedCommit ? (
        <div className="border-border/70 grid gap-3 rounded-lg border border-dashed px-3 py-3">
          <div className="font-medium">Selected commit detail</div>
          <DetailField label="Commit" value={selectedCommit.commit.title} />
          <DetailField label="State" value={selectedCommit.commit.state} />
          <DetailField
            label="Repository commit"
            value={formatRepositoryCommitSummary(selectedCommit)}
          />
          <CommitSessionActionCard
            action={commitAction}
            actionState={commitActionState}
            lookupState={commitLookupState}
            onTrigger={onTriggerCommitSession}
            pending={commitActionState?.status === "pending"}
          />
        </div>
      ) : null}
    </div>
  );
}

export function WorkflowReviewSurface({
  branchAction,
  branchActionState,
  branchLookupState,
  commitAction,
  commitActionState,
  commitLookupState,
  liveSessionState = { events: [], status: "idle" },
  onTriggerBranchSession,
  onTriggerCommitSession,
  readState,
  runtime,
  search,
  sessionFeedState = { status: "loading" },
  startupState,
}: {
  readonly branchAction: SessionActionModel;
  readonly branchActionState?: SessionActionRequestState;
  readonly branchLookupState: SessionLookupState;
  readonly commitAction: SessionActionModel;
  readonly commitActionState?: SessionActionRequestState;
  readonly commitLookupState: SessionLookupState;
  readonly liveSessionState?: SessionLiveState;
  readonly onTriggerBranchSession: () => void;
  readonly onTriggerCommitSession: () => void;
  readonly readState: WorkflowReviewReadState;
  readonly runtime: BrowserAgentRuntimeProbe;
  readonly search: WorkflowRouteSearch;
  readonly sessionFeedState?: WorkflowSessionFeedReadState;
  readonly startupState: WorkflowReviewStartupState;
}) {
  const selectedBranchId =
    readState.status === "ready"
      ? (readState.commitQueue?.branch.branch.id ??
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
        runtime={runtime}
        selectedBranchId={selectedBranchId}
      />
      <BrowserAgentStatusCard runtime={runtime} />

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
              branchAction={branchAction}
              branchActionState={branchActionState}
              branchBoard={readState.status === "ready" ? readState.branchBoard : undefined}
              branchLookupState={branchLookupState}
              commitQueue={readState.status === "ready" ? readState.commitQueue : undefined}
              onTriggerBranchSession={onTriggerBranchSession}
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
              commitAction={commitAction}
              commitActionState={commitActionState}
              commitLookupState={commitLookupState}
              commitQueue={readState.status === "ready" ? readState.commitQueue : undefined}
              onTriggerCommitSession={onTriggerCommitSession}
              projectId={projectId}
              search={search}
            />
          )}
        </PanelShell>
      </div>

      <PanelShell
        description="Inspect graph-backed session history, transcript blocks, artifacts, and decisions for the selected workflow subject."
        title="Session panel"
      >
        <SessionFeedPanel
          liveSessionState={liveSessionState}
          search={search}
          sessionFeedState={sessionFeedState}
        />
      </PanelShell>

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
  const auth = useWebAuthSession();
  const contract = useMemo(() => createWorkflowReviewStartupContract(search), [search]);
  const sessionFeedContract = useMemo(() => createWorkflowSessionFeedContract(search), [search]);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const visibleProjects = useMemo(
    () =>
      runtime.graph.project
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
      runtime.graph.branch.list().map((branch) => ({
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
  const [runtimeState, setRuntimeState] = useState<BrowserAgentRuntimeProbe>({
    message: "Checking local browser-agent runtime.",
    status: "checking",
  });
  const [readState, setReadState] = useState<WorkflowReviewReadState>({ status: "loading" });
  const [branchLookupState, setBranchLookupState] = useState<SessionLookupState>({
    status: "idle",
  });
  const [commitLookupState, setCommitLookupState] = useState<SessionLookupState>({
    status: "idle",
  });
  const [sessionFeedState, setSessionFeedState] = useState<WorkflowSessionFeedReadState>({
    status: "loading",
  });
  const [sessionLiveState, setSessionLiveState] = useState<SessionLiveState>({
    events: [],
    status: "idle",
  });
  const [branchActionStates, setBranchActionStates] = useState<
    Readonly<Record<string, SessionActionRequestState>>
  >({});
  const [commitActionStates, setCommitActionStates] = useState<
    Readonly<Record<string, SessionActionRequestState>>
  >({});
  const canonicalSearch = useMemo(
    () => resolveCanonicalWorkflowRouteSearch(search, startupState),
    [search, startupState],
  );
  const selectedBranchId =
    readState.status === "ready"
      ? (readState.commitQueue?.branch.branch.id ??
        (startupState.kind === "ready" ? startupState.selectedBranch?.id : undefined))
      : startupState.kind === "ready"
        ? startupState.selectedBranch?.id
        : undefined;
  const selectedBranchState =
    readState.status === "ready"
      ? readState.branchBoard.rows.find((row) => row.branch.id === selectedBranchId)?.branch.state
      : undefined;
  const branchAction = useMemo(
    () =>
      createBranchSessionActionModel({
        authStatus: auth.status,
        commitQueue: readState.status === "ready" ? readState.commitQueue : undefined,
        lookupState: branchLookupState,
        runtime: runtimeState,
        selectedBranchState,
      }),
    [auth.status, branchLookupState, readState, runtimeState, selectedBranchState],
  );
  const branchActionState = selectedBranchId ? branchActionStates[selectedBranchId] : undefined;
  const selectedCommit =
    readState.status === "ready"
      ? resolveSelectedCommitRow(readState.commitQueue, search.commit)
      : undefined;
  const selectedCommitId = selectedCommit?.commit.id;
  const selectedProjectId =
    startupState.kind === "ready" || startupState.kind === "partial-data"
      ? startupState.project.id
      : undefined;
  const startupSelectedBranchId =
    startupState.kind === "ready" ? startupState.selectedBranch?.id : undefined;
  const readyBranchBoardProjectId =
    readState.status === "ready" ? readState.branchBoard.project.id : undefined;
  const readyCommitQueueBranchId =
    readState.status === "ready" ? readState.commitQueue?.branch.branch.id : undefined;
  const commitAction = useMemo(
    () =>
      createCommitSessionActionModel({
        authStatus: auth.status,
        commitQueue: readState.status === "ready" ? readState.commitQueue : undefined,
        lookupState: commitLookupState,
        runtime: runtimeState,
        selectedCommitId: search.commit,
        selectedBranchState,
      }),
    [auth.status, commitLookupState, readState, runtimeState, search.commit, selectedBranchState],
  );
  const commitActionState = selectedCommitId ? commitActionStates[selectedCommitId] : undefined;
  const liveSessionCandidate = useMemo(
    () =>
      resolveLiveSessionCandidate({
        branchLookupState,
        commitLookupState,
        search,
      }),
    [branchLookupState, commitLookupState, search],
  );

  useEffect(() => {
    if (!onSearchChange || !canonicalSearch) {
      return;
    }
    void onSearchChange(canonicalSearch);
  }, [canonicalSearch, onSearchChange]);

  useEffect(() => {
    let cancelled = false;
    void probeBrowserAgentRuntime().then((state) => {
      if (!cancelled) {
        setRuntimeState(state);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (
      auth.status !== "ready" ||
      runtimeState.status !== "ready" ||
      startupState.kind !== "ready"
    ) {
      setBranchLookupState((current) => (current.status === "idle" ? current : { status: "idle" }));
      return;
    }

    const branchId = startupSelectedBranchId;
    if (!branchId) {
      setBranchLookupState((current) => (current.status === "idle" ? current : { status: "idle" }));
      return;
    }
    const projectId = selectedProjectId;
    if (!projectId) {
      setBranchLookupState((current) => (current.status === "idle" ? current : { status: "idle" }));
      return;
    }

    let cancelled = false;
    setBranchLookupState((current) =>
      current.status === "checking" ? current : { status: "checking" },
    );
    void requestBrowserAgentActiveSessionLookup({
      actor: {
        principalId: auth.principalId,
        sessionId: auth.sessionId,
        surface: "browser",
      },
      kind: "planning",
      projectId,
      subject: {
        kind: "branch",
        branchId,
      },
    })
      .then((result) => {
        if (!cancelled) {
          setBranchLookupState({
            result,
            status: "ready",
          });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setBranchLookupState({
            message: formatBrowserAgentRequestError(
              error,
              "Branch session attach recovery failed.",
            ),
            status: "failed",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    auth.principalId,
    auth.sessionId,
    auth.status,
    runtimeState.status,
    selectedProjectId,
    startupSelectedBranchId,
    startupState.kind,
  ]);

  useEffect(() => {
    if (
      auth.status !== "ready" ||
      runtimeState.status !== "ready" ||
      readState.status !== "ready"
    ) {
      setCommitLookupState((current) => (current.status === "idle" ? current : { status: "idle" }));
      return;
    }

    const commitQueue = readState.commitQueue;
    const selectedCommit = resolveSelectedCommitRow(commitQueue);
    if (!selectedCommit || !commitQueue) {
      setCommitLookupState((current) => (current.status === "idle" ? current : { status: "idle" }));
      return;
    }
    const projectId = readyBranchBoardProjectId;
    const branchId = readyCommitQueueBranchId;
    const commitId = selectedCommitId;
    if (!projectId || !branchId || !commitId) {
      setCommitLookupState((current) => (current.status === "idle" ? current : { status: "idle" }));
      return;
    }

    let cancelled = false;
    setCommitLookupState((current) =>
      current.status === "checking" ? current : { status: "checking" },
    );
    void requestBrowserAgentActiveSessionLookup({
      actor: {
        principalId: auth.principalId,
        sessionId: auth.sessionId,
        surface: "browser",
      },
      kind: "execution",
      projectId,
      subject: {
        kind: "commit",
        branchId,
        commitId,
      },
    })
      .then((result) => {
        if (!cancelled) {
          setCommitLookupState({
            result,
            status: "ready",
          });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setCommitLookupState({
            message: formatBrowserAgentRequestError(
              error,
              "Commit session attach recovery failed.",
            ),
            status: "failed",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    auth.principalId,
    auth.sessionId,
    auth.status,
    readState.status,
    readyBranchBoardProjectId,
    readyCommitQueueBranchId,
    runtimeState.status,
    selectedCommitId,
  ]);

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
          startupState.selectedBranch?.id ?? branchBoard.result.rows[0]?.branch.id;

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

  useEffect(() => {
    if (startupState.kind !== "ready" || readState.status !== "ready") {
      setSessionFeedState({ status: "loading" });
      return;
    }

    const selectionState = resolveWorkflowSessionFeedSelectionState({
      contract: sessionFeedContract,
      selectedBranchId,
      selectedProjectId,
      visibleCommitIds: readState.commitQueue?.rows.map((row) => row.commit.id),
    });

    if (selectionState.kind === "missing-data") {
      setSessionFeedState({
        result: selectionState,
        status: "missing-data",
      });
      return;
    }

    if (selectionState.kind === "stale-selection") {
      setSessionFeedState({
        result: selectionState,
        status: "stale-selection",
      });
      return;
    }

    const controller = new AbortController();
    setSessionFeedState({ status: "loading" });

    void requestWorkflowRead(
      {
        kind: "session-feed",
        query: selectionState.query,
      },
      {
        signal: controller.signal,
      },
    )
      .then((response) => {
        if (!controller.signal.aborted) {
          setSessionFeedState({
            result: response.result,
            status: "ready",
          });
        }
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }

        const message =
          error instanceof WorkflowReadClientError || error instanceof Error
            ? error.message
            : String(error);
        setSessionFeedState({
          ...(error instanceof WorkflowReadClientError && error.code ? { code: error.code } : {}),
          message,
          status: "error",
        });
      });

    return () => {
      controller.abort();
    };
  }, [
    readState,
    refreshVersion,
    selectedBranchId,
    selectedProjectId,
    sessionFeedContract,
    startupState,
  ]);

  useEffect(() => {
    if (!liveSessionCandidate) {
      setSessionLiveState((current) =>
        current.status === "idle" ? current : { events: [], status: "idle" },
      );
      return;
    }

    const controller = new AbortController();
    setSessionLiveState((current) =>
      current.status !== "idle" &&
      current.sessionId === liveSessionCandidate.sessionId &&
      current.browserAgentSessionId === liveSessionCandidate.attach.browserAgentSessionId
        ? current
        : {
            browserAgentSessionId: liveSessionCandidate.attach.browserAgentSessionId,
            events: [],
            sessionId: liveSessionCandidate.sessionId,
            status: "connecting",
          },
    );

    void observeBrowserAgentSessionEvents(
      {
        attach: liveSessionCandidate.attach,
        sessionId: liveSessionCandidate.sessionId,
      },
      {
        onEvent: (message) => {
          setSessionLiveState((current) => {
            if (current.status === "idle" || current.sessionId !== message.sessionId) {
              return current;
            }

            return {
              browserAgentSessionId: message.browserAgentSessionId,
              events: appendWorkflowSessionLiveEvent(
                current.events,
                createWorkflowSessionLiveEvent(message),
              ),
              sessionId: message.sessionId,
              status: "streaming",
            };
          });
        },
        signal: controller.signal,
      },
    ).catch((error) => {
      if (controller.signal.aborted) {
        return;
      }

      setSessionLiveState((current) => {
        if (current.status === "idle" || current.sessionId !== liveSessionCandidate.sessionId) {
          return current;
        }

        return {
          ...current,
          message: formatBrowserAgentRequestError(
            error,
            "Local live session updates unavailable. Showing graph-backed history only.",
          ),
          status: "unavailable",
        };
      });
    });

    return () => {
      controller.abort();
    };
  }, [liveSessionCandidate]);

  useEffect(() => {
    if (sessionFeedState.status !== "ready") {
      return;
    }
    const result = sessionFeedState.result;
    if (result.status !== "ready") {
      return;
    }

    setSessionLiveState((current) => {
      if (current.status === "idle" || current.sessionId !== result.header.id) {
        return current;
      }

      const events = reconcileWorkflowSessionLiveEvents(result.events, current.events);
      if (
        events.length === current.events.length &&
        events.every((event, index) => event === current.events[index])
      ) {
        return current;
      }

      return {
        ...current,
        events,
      };
    });
  }, [sessionFeedState]);

  function updateBranchActionState(branchId: string, nextState: SessionActionRequestState) {
    setBranchActionStates((current) => ({
      ...current,
      [branchId]: nextState,
    }));
  }

  function updateCommitActionState(commitId: string, nextState: SessionActionRequestState) {
    setCommitActionStates((current) => ({
      ...current,
      [commitId]: nextState,
    }));
  }

  function handleTriggerBranchSession() {
    if (
      auth.status !== "ready" ||
      startupState.kind !== "ready" ||
      !startupState.selectedBranch ||
      branchAction.availability !== "available"
    ) {
      return;
    }

    const branchId = startupState.selectedBranch.id;
    updateBranchActionState(branchId, {
      message: `${branchAction.label} requested for ${branchId}.`,
      status: "pending",
    });

    void requestBrowserAgentLaunch({
      actor: {
        principalId: auth.principalId,
        sessionId: auth.sessionId,
        surface: "browser",
      },
      kind: "planning",
      preference: branchAction.preference,
      projectId: startupState.project.id,
      selection: {
        branchId,
        projectId: startupState.project.id,
      },
      subject: {
        kind: "branch",
        branchId,
      },
    })
      .then((result) => {
        if (isLaunchFailure(result)) {
          updateBranchActionState(branchId, {
            message: result.message,
            result,
            status: "failure",
          });
          return;
        }

        updateBranchActionState(branchId, {
          message: formatLaunchOutcome(result),
          result,
          status: "success",
        });
        setBranchLookupState({
          result: {
            attach: result.attach,
            found: true,
            ok: true,
            session: result.session,
            workspace: result.workspace,
          },
          status: "ready",
        });
        setRefreshVersion((current) => current + 1);
      })
      .catch((error) => {
        updateBranchActionState(branchId, {
          message: formatBrowserAgentRequestError(error, "Branch session launch failed."),
          status: "failure",
        });
      });
  }

  function handleTriggerCommitSession() {
    if (
      auth.status !== "ready" ||
      readState.status !== "ready" ||
      commitAction.availability !== "available"
    ) {
      return;
    }

    const selectedCommit = resolveSelectedCommitRow(readState.commitQueue);
    const commitQueue = readState.commitQueue;
    if (!selectedCommit || !commitQueue) {
      return;
    }

    const branchId = commitQueue.branch.branch.id;
    const commitId = selectedCommit.commit.id;
    updateCommitActionState(commitId, {
      message: `${commitAction.label} requested for ${commitId}.`,
      status: "pending",
    });

    void requestBrowserAgentLaunch({
      actor: {
        principalId: auth.principalId,
        sessionId: auth.sessionId,
        surface: "browser",
      },
      kind: "execution",
      preference: commitAction.preference,
      projectId: readState.branchBoard.project.id,
      selection: {
        branchId,
        commitId,
        projectId: readState.branchBoard.project.id,
      },
      subject: {
        kind: "commit",
        branchId,
        commitId,
      },
    })
      .then((result) => {
        if (isLaunchFailure(result)) {
          updateCommitActionState(commitId, {
            message: result.message,
            result,
            status: "failure",
          });
          return;
        }

        updateCommitActionState(commitId, {
          message: formatLaunchOutcome(result),
          result,
          status: "success",
        });
        setCommitLookupState({
          result: {
            attach: result.attach,
            found: true,
            ok: true,
            session: result.session,
            workspace: result.workspace,
          },
          status: "ready",
        });
        setRefreshVersion((current) => current + 1);
      })
      .catch((error) => {
        updateCommitActionState(commitId, {
          message: formatBrowserAgentRequestError(error, "Commit session launch failed."),
          status: "failure",
        });
      });
  }

  return (
    <WorkflowReviewSurface
      branchAction={branchAction}
      branchActionState={branchActionState}
      branchLookupState={branchLookupState}
      commitAction={commitAction}
      commitActionState={commitActionState}
      commitLookupState={commitLookupState}
      liveSessionState={sessionLiveState}
      onTriggerBranchSession={handleTriggerBranchSession}
      onTriggerCommitSession={handleTriggerCommitSession}
      readState={readState}
      runtime={runtimeState}
      search={search}
      sessionFeedState={sessionFeedState}
      startupState={startupState}
    />
  );
}
