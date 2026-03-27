import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { toCodexNotificationEvent } from "./runner/codex-events.js";
import type {
  AgentCodexNotificationEvent,
  AgentRawLineEvent,
  AgentSessionEvent,
  AgentSessionIssueRef,
  AgentSessionLifecycleEvent,
  AgentSessionPhase,
  AgentSessionRef,
  AgentSessionRuntimeRef,
  AgentSessionWorkflowIssueRef,
  AgentSessionWorkflowRef,
  AgentStatusCode,
  AgentStatusEvent,
} from "./tui/index.js";
import type { IssueRuntimeState } from "./workspace.js";

export type AgentTuiRetainedMode = "attach" | "replay";
export type AgentTuiRetainedSource = "empty" | "events" | "runtime" | "stdout";

type RetainedOutputSummary = {
  blockedReason?: string;
  commitBranchName?: string;
  commitSha?: string;
  interruptedReason?: string;
};

type RetainedRuntimeContext = {
  beforeTerminal: AgentSessionEvent[];
  beforeTerminalIndex?: number;
  leading: AgentSessionEvent[];
  trailing: AgentSessionEvent[];
};

function mergeIssueRef(
  current: AgentSessionIssueRef | undefined,
  next: AgentSessionIssueRef | undefined,
): AgentSessionIssueRef | undefined {
  if (!current && !next) {
    return undefined;
  }
  return {
    ...current,
    ...next,
  } as AgentSessionIssueRef;
}

function mergeWorkflowIssueRef(
  current: AgentSessionWorkflowIssueRef | undefined,
  next: AgentSessionWorkflowIssueRef | undefined,
) {
  if (!current && !next) {
    return undefined;
  }
  return {
    ...current,
    ...next,
  } as AgentSessionWorkflowIssueRef;
}

function mergeWorkflowRef(
  current: AgentSessionWorkflowRef | undefined,
  next: AgentSessionWorkflowRef | undefined,
): AgentSessionWorkflowRef | undefined {
  if (!current && !next) {
    return undefined;
  }
  return {
    feature: mergeWorkflowIssueRef(current?.feature, next?.feature),
    stream: mergeWorkflowIssueRef(current?.stream, next?.stream),
    task: mergeWorkflowIssueRef(current?.task, next?.task),
  };
}

function mergeRuntimeRef(
  current: AgentSessionRuntimeRef | undefined,
  next: AgentSessionRuntimeRef | undefined,
): AgentSessionRuntimeRef | undefined {
  if (!current && !next) {
    return undefined;
  }
  return {
    ...current,
    ...next,
    blocker:
      current?.blocker || next?.blocker
        ? {
            ...current?.blocker,
            ...next?.blocker,
          }
        : undefined,
    finalization:
      current?.finalization || next?.finalization
        ? {
            ...current?.finalization,
            ...next?.finalization,
            state: next?.finalization?.state ?? current?.finalization?.state ?? "pending",
          }
        : undefined,
  };
}

function mergeSessionRef(current: AgentSessionRef, next: AgentSessionRef): AgentSessionRef {
  return {
    ...current,
    ...next,
    issue: mergeIssueRef(current.issue, next.issue),
    runtime: mergeRuntimeRef(current.runtime, next.runtime),
    workflow: mergeWorkflowRef(current.workflow, next.workflow),
  };
}

function createSupervisorSession(repoRoot: string): AgentSessionRef {
  return {
    id: "supervisor",
    kind: "supervisor",
    rootSessionId: "supervisor",
    title: "Supervisor",
    workerId: "supervisor",
    workspacePath: repoRoot,
  };
}

function createFallbackWorkerSession(issueState: IssueRuntimeState): AgentSessionRef {
  const current = {
    id: issueState.issueId,
    identifier: issueState.issueIdentifier,
    title: issueState.issueTitle,
  };
  const streamIdentifier =
    issueState.streamIssueIdentifier ??
    issueState.parentIssueIdentifier ??
    issueState.issueIdentifier;
  const stream = {
    id: issueState.streamIssueId ?? issueState.parentIssueId ?? issueState.issueId,
    identifier: streamIdentifier,
    title: streamIdentifier === issueState.issueIdentifier ? issueState.issueTitle : undefined,
  };
  const workflow =
    issueState.parentIssueIdentifier && issueState.parentIssueIdentifier !== streamIdentifier
      ? {
          feature: {
            id: issueState.parentIssueId,
            identifier: issueState.parentIssueIdentifier,
          },
          stream,
          task: current,
        }
      : issueState.parentIssueIdentifier &&
          issueState.parentIssueIdentifier !== issueState.issueIdentifier
        ? {
            feature: current,
            stream,
          }
        : {
            stream: current,
          };
  return {
    branchName: issueState.branchName,
    id: `worker:${issueState.workerId}:retained`,
    issue: current,
    kind: "worker",
    parentSessionId: "supervisor",
    rootSessionId: "supervisor",
    title: issueState.issueTitle,
    workerId: issueState.workerId,
    runtime: createRetainedRuntimeRef(issueState),
    workflow,
    workspacePath: issueState.worktreePath,
  };
}

function createRetainedRuntimeRef(
  issueState: IssueRuntimeState,
  options: {
    blockedReason?: string;
    commitSha?: string;
    interruptedReason?: string;
  } = {},
): AgentSessionRuntimeRef | undefined {
  const commitSha = options.commitSha ?? issueState.landedCommitSha ?? issueState.commitSha;
  switch (issueState.status) {
    case "blocked":
      return {
        blocker:
          issueState.blockedReason || options.blockedReason
            ? {
                kind: "blocked",
                reason: options.blockedReason ?? issueState.blockedReason,
              }
            : {
                kind: "blocked",
              },
        state: "blocked",
      };
    case "completed":
      return {
        finalization: {
          commitSha,
          landedAt: issueState.landedAt,
          state: "pending",
        },
        state: "pending-finalization",
      };
    case "finalized":
      return {
        finalization: {
          commitSha,
          finalizedAt: issueState.finalizedAt,
          landedAt: issueState.landedAt,
          linearState: issueState.finalizedLinearState,
          state: "finalized",
        },
        state: "finalized",
      };
    case "interrupted":
      return {
        blocker:
          issueState.interruptedReason || options.interruptedReason
            ? {
                kind: "interrupted",
                reason: options.interruptedReason ?? issueState.interruptedReason,
              }
            : {
                kind: "interrupted",
              },
        state: "interrupted",
      };
    case "running":
      return {
        state: "running",
      };
    default:
      return undefined;
  }
}

function toRuntimePhase(issueState: IssueRuntimeState): AgentSessionPhase {
  switch (issueState.status) {
    case "blocked":
      return "failed";
    case "completed":
    case "finalized":
      return "completed";
    case "interrupted":
      return "stopped";
    case "running":
    default:
      return "started";
  }
}

function toSyntheticTimestamp(baseTime: number, sequence: number) {
  return new Date(baseTime + sequence).toISOString();
}

function toAnchoredTimestamp(timestamp: string, offsetMs = 1) {
  const parsedTime = Date.parse(timestamp);
  if (!Number.isFinite(parsedTime)) {
    return timestamp;
  }
  return new Date(parsedTime - offsetMs).toISOString();
}

function describeSource(source: AgentTuiRetainedSource) {
  switch (source) {
    case "events":
      return "events.log";
    case "runtime":
      return "runtime files";
    case "stdout":
      return "codex.stdout.jsonl";
    default:
      return "runtime files";
  }
}

function capitalizeMode(mode: AgentTuiRetainedMode) {
  return mode === "attach" ? "Attach" : "Replay";
}

function formatRetainedWorkflowScope(issue: IssueRuntimeState) {
  const streamIssueIdentifier =
    issue.streamIssueIdentifier ?? issue.parentIssueIdentifier ?? issue.issueIdentifier;
  const featureIssueIdentifier =
    issue.parentIssueIdentifier &&
    issue.streamIssueIdentifier &&
    issue.parentIssueIdentifier !== issue.streamIssueIdentifier
      ? issue.parentIssueIdentifier
      : undefined;
  const parts = [`stream ${streamIssueIdentifier}`];
  if (featureIssueIdentifier) {
    parts.push(`feature ${featureIssueIdentifier}`);
  }
  if (issue.parentIssueIdentifier) {
    parts.push(`task ${issue.issueIdentifier}`);
  }
  return parts.join(" / ");
}

function describeRetainedRuntimeState(issue: IssueRuntimeState) {
  switch (issue.status) {
    case "blocked":
      return `runtime state: blocked; worktree preserved on ${issue.branchName}`;
    case "completed":
      return `runtime state: waiting on finalization on ${issue.branchName}`;
    case "finalized":
      return issue.finalizedLinearState
        ? `runtime state: finalized in ${issue.finalizedLinearState}`
        : "runtime state: finalized";
    case "interrupted":
      return `runtime state: interrupted; worktree preserved to resume on ${issue.branchName}`;
    case "running":
    default:
      return `runtime state: active on ${issue.branchName}`;
  }
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function truncateSha(sha: string) {
  return sha.slice(0, 7);
}

function isTerminalIssueStatus(status: IssueRuntimeState["status"]) {
  return status !== "running";
}
class AppendOnlyLineReader {
  readonly path: string;
  #offset = 0;
  #remainder = "";

  constructor(path: string) {
    this.path = path;
  }

  async readNewLines() {
    let text: string;
    try {
      text = await readFile(this.path, "utf8");
    } catch {
      return [];
    }

    if (text.length < this.#offset) {
      this.#offset = 0;
      this.#remainder = "";
    }

    const chunk = text.slice(this.#offset);
    this.#offset = text.length;
    if (!chunk.length) {
      return [];
    }

    const combined = `${this.#remainder}${chunk}`;
    const parts = combined.split(/\r?\n/);
    this.#remainder = parts.pop() ?? "";
    return parts.map((line) => line.trim()).filter(Boolean);
  }
}

export class AgentTuiRetainedReader {
  readonly issueState: IssueRuntimeState;
  readonly supervisorSession: AgentSessionRef;

  #eventLogReader: AppendOnlyLineReader;
  #outputSummary: RetainedOutputSummary | undefined;
  #outputSummaryLoaded = false;
  #preludeSequence = -10_000;
  #source: AgentTuiRetainedSource = "empty";
  #stdoutLogReader: AppendOnlyLineReader;
  #syntheticSequence = 0;
  #syntheticTimeBase: number;
  #workerSession: AgentSessionRef;

  constructor(options: { issueState: IssueRuntimeState; repoRoot: string }) {
    this.issueState = options.issueState;
    this.supervisorSession = createSupervisorSession(options.repoRoot);
    this.#workerSession = createFallbackWorkerSession(options.issueState);
    this.#eventLogReader = new AppendOnlyLineReader(
      resolve(options.issueState.runtimePath, "events.log"),
    );
    this.#stdoutLogReader = new AppendOnlyLineReader(
      resolve(options.issueState.runtimePath, "codex.stdout.jsonl"),
    );
    const parsedTime = Date.parse(options.issueState.updatedAt);
    this.#syntheticTimeBase = Number.isFinite(parsedTime) ? parsedTime : Date.now();
  }

  get source() {
    return this.#source;
  }

  get workerSession() {
    return this.#workerSession;
  }

  async readInitialEvents(mode: AgentTuiRetainedMode) {
    const retainedEvents = await this.#readRetainedEvents();
    const runtimeContext = await this.#buildRuntimeContextEvents(retainedEvents);
    const runtimeEventCount = runtimeContext.leading.length + runtimeContext.trailing.length;
    if (!retainedEvents.length && runtimeEventCount) {
      this.#source = "runtime";
    }
    const events = this.#buildPrelude(mode);
    events.push(...runtimeContext.leading);
    if (runtimeContext.beforeTerminal.length && runtimeContext.beforeTerminalIndex !== undefined) {
      events.push(...retainedEvents.slice(0, runtimeContext.beforeTerminalIndex));
      events.push(...runtimeContext.beforeTerminal);
      events.push(...retainedEvents.slice(runtimeContext.beforeTerminalIndex));
    } else {
      events.push(...retainedEvents);
    }
    events.push(...runtimeContext.trailing);
    if (!retainedEvents.length && !isTerminalIssueStatus(this.issueState.status)) {
      events.push(
        this.#buildStatusEvent(this.#workerSession, "idle", "Waiting for retained session events"),
      );
    }
    return events;
  }

  async readNextEvents() {
    return await this.#readRetainedEvents();
  }

  createReplayCompletedEvent() {
    return this.#buildRuntimeStatusEvent(this.supervisorSession, "idle", "Replay complete");
  }

  #buildLifecycleEvent(
    session: AgentSessionRef,
    phase: AgentSessionPhase,
    data?: Record<string, unknown>,
  ): AgentSessionLifecycleEvent {
    const sequence = this.#nextPreludeSequence();
    return {
      data,
      phase,
      sequence,
      session,
      timestamp: toSyntheticTimestamp(this.#syntheticTimeBase, sequence),
      type: "session",
    };
  }

  #buildPrelude(mode: AgentTuiRetainedMode): AgentSessionEvent[] {
    const issue = this.issueState;
    return [
      this.#buildLifecycleEvent(this.supervisorSession, "started", {
        workspacePath: this.supervisorSession.workspacePath,
      }),
      this.#buildStatusEvent(
        this.supervisorSession,
        "ready",
        `${capitalizeMode(mode)} ${issue.issueIdentifier} from ${describeSource(this.#source)}`,
      ),
      this.#buildStatusEvent(
        this.supervisorSession,
        "workflow-diagnostic",
        `workflow: ${formatRetainedWorkflowScope(issue)}`,
      ),
      this.#buildStatusEvent(
        this.supervisorSession,
        "workflow-diagnostic",
        describeRetainedRuntimeState(issue),
      ),
      this.#buildStatusEvent(
        this.supervisorSession,
        "workflow-diagnostic",
        `workspace: ${issue.worktreePath}`,
      ),
      this.#buildStatusEvent(this.supervisorSession, "ready", `runtime: ${issue.runtimePath}`),
    ];
  }

  #buildStatusEvent(
    session: AgentSessionRef,
    code: AgentStatusCode,
    text: string,
    data?: Record<string, unknown>,
  ): AgentStatusEvent {
    const sequence = this.#nextPreludeSequence();
    return {
      code,
      data,
      format: "line",
      sequence,
      session,
      text,
      timestamp: toSyntheticTimestamp(this.#syntheticTimeBase, sequence),
      type: "status",
    };
  }

  #buildRuntimeStatusEvent(
    session: AgentSessionRef,
    code: AgentStatusCode,
    text: string,
    data?: Record<string, unknown>,
  ): AgentStatusEvent {
    const sequence = this.#nextSyntheticSequence();
    return {
      code,
      data,
      format: "line",
      sequence,
      session,
      text,
      timestamp: toSyntheticTimestamp(this.#syntheticTimeBase, sequence),
      type: "status",
    };
  }

  #buildRuntimeLifecycleEvent(
    session: AgentSessionRef,
    phase: AgentSessionPhase,
    data?: Record<string, unknown>,
  ): AgentSessionLifecycleEvent {
    const sequence = this.#nextSyntheticSequence();
    return {
      data,
      phase,
      sequence,
      session,
      timestamp: toSyntheticTimestamp(this.#syntheticTimeBase, sequence),
      type: "session",
    };
  }

  #buildWorkerPhaseEvent(
    phase: AgentSessionPhase,
    data?: Record<string, unknown>,
    sequenceKind: "prelude" | "runtime" = "prelude",
  ) {
    const eventData = {
      branchName: this.issueState.branchName,
      workspacePath: this.issueState.worktreePath,
      ...data,
    };
    return sequenceKind === "runtime"
      ? this.#buildRuntimeLifecycleEvent(this.#workerSession, phase, eventData)
      : this.#buildLifecycleEvent(this.#workerSession, phase, eventData);
  }

  #buildAnchoredStatusEvent(
    anchor: AgentSessionEvent,
    session: AgentSessionRef,
    code: AgentStatusCode,
    text: string,
    data?: Record<string, unknown>,
  ): AgentStatusEvent {
    return {
      code,
      data,
      format: "line",
      sequence: anchor.sequence - 0.001,
      session,
      text,
      timestamp: toAnchoredTimestamp(anchor.timestamp),
      type: "status",
    };
  }

  #buildWorkflowDetailEvent(text: string, sequenceKind: "prelude" | "runtime" = "prelude") {
    return sequenceKind === "runtime"
      ? this.#buildRuntimeStatusEvent(this.supervisorSession, "ready", text)
      : this.#buildStatusEvent(this.supervisorSession, "ready", text);
  }

  async #buildRuntimeContextEvents(retainedEvents: AgentSessionEvent[]) {
    const beforeTerminal: AgentSessionEvent[] = [];
    const leading: AgentSessionEvent[] = [];
    const trailing: AgentSessionEvent[] = [];
    let beforeTerminalIndex: number | undefined;
    let completedPhaseEvent: AgentSessionLifecycleEvent | undefined;
    let completedPhaseIndex: number | undefined;
    let failedPhaseEvent: AgentSessionLifecycleEvent | undefined;
    let failedPhaseIndex: number | undefined;
    const phases = new Set<AgentSessionPhase>();
    let hasBlockedStatus = false;
    let hasCommittedStatus = false;

    for (const [index, event] of retainedEvents.entries()) {
      if (event.session.id !== this.#workerSession.id) {
        continue;
      }
      if (event.type === "session") {
        phases.add(event.phase);
        if (event.phase === "completed" && completedPhaseEvent === undefined) {
          completedPhaseEvent = event;
          completedPhaseIndex = index;
        }
        if (event.phase === "failed" && failedPhaseEvent === undefined) {
          failedPhaseEvent = event;
          failedPhaseIndex = index;
        }
        continue;
      }
      if (event.type !== "status") {
        continue;
      }
      if (event.code === "issue-blocked") {
        hasBlockedStatus = true;
      }
      if (event.code === "issue-committed") {
        hasCommittedStatus = true;
      }
    }

    const outputSummary = await this.#readOutputSummary();
    const commitSha = this.#resolveCommitSha(outputSummary);
    const terminalPhase = toRuntimePhase(this.issueState);
    this.#workerSession = mergeSessionRef(this.#workerSession, {
      ...this.#workerSession,
      runtime: createRetainedRuntimeRef(this.issueState, {
        blockedReason: outputSummary?.blockedReason,
        commitSha,
        interruptedReason: outputSummary?.interruptedReason,
      }),
    });

    if (!phases.has("scheduled")) {
      leading.push(this.#buildWorkerPhaseEvent("scheduled"));
    }

    if (terminalPhase === "started") {
      if (!phases.has("started")) {
        leading.push(this.#buildWorkerPhaseEvent("started"));
      }
    }

    if (terminalPhase === "completed") {
      if (!hasCommittedStatus && commitSha) {
        const eventText = `${this.issueState.issueIdentifier}: committed ${commitSha} on ${this.issueState.branchName}`;
        const eventData = {
          branchName: this.issueState.branchName,
          commitSha,
        };
        if (completedPhaseEvent && completedPhaseIndex !== undefined) {
          beforeTerminal.push(
            this.#buildAnchoredStatusEvent(
              completedPhaseEvent,
              this.#workerSession,
              "issue-committed",
              eventText,
              eventData,
            ),
          );
          beforeTerminalIndex = completedPhaseIndex;
        } else {
          trailing.push(
            this.#buildRuntimeStatusEvent(
              this.#workerSession,
              "issue-committed",
              eventText,
              eventData,
            ),
          );
        }
      }
      if (!phases.has("completed")) {
        const data = commitSha ? { commitSha } : undefined;
        trailing.push(this.#buildWorkerPhaseEvent("completed", data, "runtime"));
      }
    }

    if (terminalPhase === "failed") {
      if (!hasBlockedStatus) {
        const eventText = `${this.issueState.issueIdentifier}: blocked`;
        if (failedPhaseEvent && failedPhaseIndex !== undefined) {
          beforeTerminal.push(
            this.#buildAnchoredStatusEvent(
              failedPhaseEvent,
              this.#workerSession,
              "issue-blocked",
              eventText,
            ),
          );
          beforeTerminalIndex = failedPhaseIndex;
        } else {
          trailing.push(
            this.#buildRuntimeStatusEvent(this.#workerSession, "issue-blocked", eventText),
          );
        }
      }
      if (!phases.has("failed")) {
        const reason = this.#resolveFailureReason(outputSummary);
        trailing.push(
          this.#buildWorkerPhaseEvent("failed", reason ? { reason } : undefined, "runtime"),
        );
      }
    }

    if (terminalPhase === "stopped" && !phases.has("stopped")) {
      const reason = outputSummary?.interruptedReason;
      trailing.push(
        this.#buildWorkerPhaseEvent("stopped", reason ? { reason } : undefined, "runtime"),
      );
    }

    if (
      this.issueState.streamIssueIdentifier &&
      this.issueState.streamIssueIdentifier !== this.issueState.issueIdentifier
    ) {
      trailing.push(
        this.#buildWorkflowDetailEvent(
          `stream: ${this.issueState.streamIssueIdentifier}`,
          "runtime",
        ),
      );
    }

    if (commitSha && (this.issueState.landedAt || terminalPhase === "completed")) {
      trailing.push(
        this.#buildWorkflowDetailEvent(
          `landed: ${truncateSha(commitSha)} on ${this.issueState.branchName}`,
          "runtime",
        ),
      );
    }

    if (this.issueState.finalizedLinearState) {
      trailing.push(
        this.#buildWorkflowDetailEvent(
          `finalized: ${this.issueState.finalizedLinearState}`,
          "runtime",
        ),
      );
    } else if (this.issueState.finalizedAt) {
      trailing.push(this.#buildWorkflowDetailEvent("finalized", "runtime"));
    }

    return {
      beforeTerminal,
      beforeTerminalIndex,
      leading,
      trailing,
    } satisfies RetainedRuntimeContext;
  }

  async #readOutputSummary() {
    if (this.#outputSummaryLoaded) {
      return this.#outputSummary;
    }
    this.#outputSummaryLoaded = true;

    try {
      const text = await readFile(this.issueState.outputPath, "utf8");
      const summary: RetainedOutputSummary = {};
      const identifier = escapeRegExp(this.issueState.issueIdentifier);
      const blockedPattern = new RegExp(`^${identifier}: blocked(?:: (.+))?$`);
      const committedPattern = new RegExp(`^${identifier}: committed ([0-9a-f]{7,40}) on (.+)$`);
      const interruptedPattern = new RegExp(`^${identifier}: interrupted(?:: (.+))?$`);

      for (const line of text.split(/\r?\n/).reverse()) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        if (!summary.commitSha) {
          const match = trimmed.match(committedPattern);
          if (match) {
            summary.commitSha = match[1];
            summary.commitBranchName = match[2];
            continue;
          }
        }
        if (!summary.blockedReason) {
          const match = trimmed.match(blockedPattern);
          if (match) {
            summary.blockedReason = match[1]?.trim() || undefined;
            continue;
          }
        }
        if (!summary.interruptedReason) {
          const match = trimmed.match(interruptedPattern);
          if (match) {
            summary.interruptedReason = match[1]?.trim() || undefined;
          }
        }
      }

      this.#outputSummary = summary;
    } catch {
      this.#outputSummary = undefined;
    }

    return this.#outputSummary;
  }

  #resolveCommitSha(outputSummary: RetainedOutputSummary | undefined) {
    return this.issueState.landedCommitSha ?? this.issueState.commitSha ?? outputSummary?.commitSha;
  }

  #resolveFailureReason(outputSummary: RetainedOutputSummary | undefined) {
    return this.issueState.blockedReason ?? outputSummary?.blockedReason;
  }

  #runtimeFromEvent(event: AgentSessionEvent): AgentSessionRuntimeRef | undefined {
    if (event.type === "session") {
      const reason = typeof event.data?.reason === "string" ? event.data.reason : undefined;
      const commitSha =
        typeof event.data?.commitSha === "string" ? event.data.commitSha : undefined;
      switch (event.phase) {
        case "completed":
          return {
            finalization: {
              commitSha,
              state: this.issueState.status === "finalized" ? "finalized" : "pending",
            },
            state: this.issueState.status === "finalized" ? "finalized" : "pending-finalization",
          };
        case "failed":
          return {
            blocker: {
              kind: this.issueState.status === "interrupted" ? "interrupted" : "blocked",
              reason,
            },
            state: this.issueState.status === "interrupted" ? "interrupted" : "blocked",
          };
        case "stopped":
          return {
            blocker: {
              kind: "interrupted",
              reason,
            },
            state: "interrupted",
          };
      }
      return undefined;
    }

    if (event.type !== "status") {
      return undefined;
    }

    switch (event.code) {
      case "issue-blocked":
        return {
          blocker: {
            kind: this.issueState.status === "interrupted" ? "interrupted" : "blocked",
            reason: typeof event.data?.reason === "string" ? event.data.reason : undefined,
          },
          state: this.issueState.status === "interrupted" ? "interrupted" : "blocked",
        };
      case "issue-committed":
        return {
          finalization: {
            commitSha: typeof event.data?.commitSha === "string" ? event.data.commitSha : undefined,
            state: this.issueState.status === "finalized" ? "finalized" : "pending",
          },
          state: this.issueState.status === "finalized" ? "finalized" : "pending-finalization",
        };
      default:
        return undefined;
    }
  }
  #coerceWorkerSession(next: AgentSessionRef) {
    const merged = mergeSessionRef(this.#workerSession, next);
    if (next.kind === "worker" && next.id) {
      this.#workerSession = {
        ...merged,
        id: next.id,
        kind: "worker",
      };
      return this.#workerSession;
    }
    this.#workerSession = {
      ...merged,
      id: this.#workerSession.id,
      kind: "worker",
      parentSessionId: this.#workerSession.parentSessionId,
      rootSessionId: this.#workerSession.rootSessionId,
      workerId: this.#workerSession.workerId,
    };
    return this.#workerSession;
  }

  async #readRetainedEvents(): Promise<AgentSessionEvent[]> {
    if (this.#source === "events") {
      return await this.#readEventLogEvents();
    }
    if (this.#source === "stdout") {
      return await this.#readStdoutLogEvents();
    }

    const eventLogEvents = await this.#readEventLogEvents();
    if (eventLogEvents.length) {
      this.#source = "events";
      return eventLogEvents;
    }

    const stdoutEvents = await this.#readStdoutLogEvents();
    if (stdoutEvents.length) {
      this.#source = "stdout";
      return stdoutEvents;
    }

    return [];
  }

  async #readEventLogEvents() {
    const lines = await this.#eventLogReader.readNewLines();
    const events: AgentSessionEvent[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as AgentSessionEvent;
        this.#syntheticSequence = Math.max(this.#syntheticSequence, parsed.sequence);
        if (parsed.session.kind === "supervisor") {
          events.push(parsed);
          continue;
        }
        const runtime = this.#runtimeFromEvent(parsed);
        const session = this.#coerceWorkerSession(
          runtime
            ? {
                ...parsed.session,
                runtime: mergeRuntimeRef(parsed.session.runtime, runtime),
              }
            : parsed.session,
        );
        events.push({
          ...parsed,
          session,
        });
      } catch {
        // Ignore partial or malformed retained lines and continue tailing.
      }
    }
    return events;
  }

  async #readStdoutLogEvents() {
    const lines = await this.#stdoutLogReader.readNewLines();
    const events: AgentSessionEvent[] = [];
    for (const line of lines) {
      const rawLine = this.#buildRawLineEvent(line);
      events.push(rawLine);
      try {
        const message = JSON.parse(line);
        const codexEvent = toCodexNotificationEvent(message);
        if (codexEvent) {
          events.push(this.#buildCodexNotificationEvent(codexEvent.method, codexEvent.params));
        }
      } catch {
        // Keep the raw stdout line even when the JSON payload is malformed.
      }
    }
    return events;
  }

  #buildRawLineEvent(line: string): AgentRawLineEvent {
    const sequence = this.#nextSyntheticSequence();
    return {
      encoding: "jsonl",
      line,
      sequence,
      session: this.#workerSession,
      stream: "stdout",
      timestamp: toSyntheticTimestamp(this.#syntheticTimeBase, sequence),
      type: "raw-line",
    };
  }

  #buildCodexNotificationEvent(
    method: string,
    params: Record<string, unknown>,
  ): AgentCodexNotificationEvent {
    const sequence = this.#nextSyntheticSequence();
    return {
      method,
      params,
      sequence,
      session: this.#workerSession,
      timestamp: toSyntheticTimestamp(this.#syntheticTimeBase, sequence),
      type: "codex-notification",
    };
  }

  #nextSyntheticSequence() {
    this.#syntheticSequence += 1;
    return this.#syntheticSequence;
  }

  #nextPreludeSequence() {
    this.#preludeSequence += 1;
    return this.#preludeSequence;
  }
}
