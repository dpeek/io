import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { normalizeCodexSessionMessage } from "./runner/codex-events.js";
import type {
  AgentRawLineEvent,
  AgentSessionEvent,
  AgentSessionIssueRef,
  AgentSessionLifecycleEvent,
  AgentSessionPhase,
  AgentSessionRef,
  AgentStatusCode,
  AgentStatusEvent,
} from "./session-events.js";
import type { IssueRuntimeState } from "./workspace.js";

export type AgentTuiRetainedMode = "attach" | "replay";
export type AgentTuiRetainedSource = "empty" | "events" | "stdout";

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

function mergeSessionRef(current: AgentSessionRef, next: AgentSessionRef): AgentSessionRef {
  return {
    ...current,
    ...next,
    issue: mergeIssueRef(current.issue, next.issue),
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
  return {
    branchName: issueState.branchName,
    id: `worker:${issueState.workerId}:retained`,
    issue: {
      id: issueState.issueId,
      identifier: issueState.issueIdentifier,
      title: issueState.issueTitle,
    },
    kind: "worker",
    parentSessionId: "supervisor",
    rootSessionId: "supervisor",
    title: issueState.issueTitle,
    workerId: issueState.workerId,
    workspacePath: issueState.worktreePath,
  };
}

function toRuntimePhase(issueState: IssueRuntimeState): AgentSessionPhase {
  switch (issueState.status) {
    case "blocked":
      return "failed";
    case "completed":
    case "finalized":
      return "completed";
    case "running":
    default:
      return "started";
  }
}

function toSyntheticTimestamp(baseTime: number, sequence: number) {
  return new Date(baseTime + sequence).toISOString();
}

function describeSource(source: AgentTuiRetainedSource) {
  switch (source) {
    case "events":
      return "events.log";
    case "stdout":
      return "codex.stdout.jsonl";
    default:
      return "runtime files";
  }
}

function capitalizeMode(mode: AgentTuiRetainedMode) {
  return mode === "attach" ? "Attach" : "Replay";
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
    const events = this.#buildPrelude(mode);
    if (this.#source !== "events") {
      events.push(this.#buildWorkerLifecycleEvent());
    }
    events.push(...retainedEvents);
    if (!retainedEvents.length) {
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
    const summary = [issue.status, issue.branchName, issue.worktreePath]
      .filter(Boolean)
      .join(" | ");
    return [
      this.#buildLifecycleEvent(this.supervisorSession, "started", {
        workspacePath: this.supervisorSession.workspacePath,
      }),
      this.#buildStatusEvent(
        this.supervisorSession,
        "ready",
        `${capitalizeMode(mode)} ${issue.issueIdentifier} from ${describeSource(this.#source)}`,
      ),
      this.#buildStatusEvent(this.supervisorSession, "ready", summary),
      this.#buildStatusEvent(this.supervisorSession, "ready", `runtime: ${issue.runtimePath}`),
    ];
  }

  #buildStatusEvent(
    session: AgentSessionRef,
    code: AgentStatusCode,
    text: string,
  ): AgentStatusEvent {
    const sequence = this.#nextPreludeSequence();
    return {
      code,
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
  ): AgentStatusEvent {
    const sequence = this.#nextSyntheticSequence();
    return {
      code,
      format: "line",
      sequence,
      session,
      text,
      timestamp: toSyntheticTimestamp(this.#syntheticTimeBase, sequence),
      type: "status",
    };
  }

  #buildWorkerLifecycleEvent() {
    return this.#buildLifecycleEvent(this.#workerSession, toRuntimePhase(this.issueState), {
      branchName: this.issueState.branchName,
      workspacePath: this.issueState.worktreePath,
    });
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
        const session = this.#coerceWorkerSession(parsed.session);
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
        const message = JSON.parse(line) as Parameters<typeof normalizeCodexSessionMessage>[0];
        const stamped = normalizeCodexSessionMessage(message).map((event) =>
          this.#buildStatusFromNormalizedEvent(
            event.code,
            event.format,
            event.data,
            event.text,
            event.itemId,
          ),
        );
        events.push(...stamped);
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

  #buildStatusFromNormalizedEvent(
    code: AgentStatusCode,
    format: AgentStatusEvent["format"],
    data?: Record<string, unknown>,
    text?: string,
    itemId?: string,
  ): AgentStatusEvent {
    const sequence = this.#nextSyntheticSequence();
    return {
      code,
      data,
      format,
      itemId,
      sequence,
      session: this.#workerSession,
      text,
      timestamp: toSyntheticTimestamp(this.#syntheticTimeBase, sequence),
      type: "status",
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
