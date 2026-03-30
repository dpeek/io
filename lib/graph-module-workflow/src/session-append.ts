import { edgeId } from "@io/graph-kernel";
import type { GraphCommandSpec } from "@io/graph-module";

import {
  agentSession,
  agentSessionEvent,
  agentSessionEventPhase,
  agentSessionKind,
  agentSessionRawLineEncoding,
  agentSessionStatusCode,
  agentSessionStatusFormat,
  agentSessionStream,
} from "./type.js";

export const agentSessionAppendFailureCodes = [
  "subject-missing",
  "sequence-conflict",
  "event-too-large",
] as const;

export type AgentSessionAppendFailureCode = (typeof agentSessionAppendFailureCodes)[number];

export const agentSessionAppendSessionAckStatusValues = ["created", "existing"] as const;

export type AgentSessionAppendSessionAckStatus =
  (typeof agentSessionAppendSessionAckStatusValues)[number];

export const agentSessionAppendEventAckStatusValues = ["accepted", "duplicate"] as const;

export type AgentSessionAppendEventAckStatus =
  (typeof agentSessionAppendEventAckStatusValues)[number];

export const agentSessionAppendRetainedRoleValues = ["supervisor", "worker", "child"] as const;

export type AgentSessionAppendRetainedRole = (typeof agentSessionAppendRetainedRoleValues)[number];

export const agentSessionAppendRetainedRuntimeStateValues = [
  "blocked",
  "finalized",
  "interrupted",
  "pending-finalization",
  "running",
] as const;

export type AgentSessionAppendRetainedRuntimeState =
  (typeof agentSessionAppendRetainedRuntimeStateValues)[number];

export type AgentSessionAppendSessionKind = keyof typeof agentSessionKind.options;
export type AgentSessionAppendLifecyclePhase = keyof typeof agentSessionEventPhase.options;
export type AgentSessionAppendStatusCode = keyof typeof agentSessionStatusCode.options;
export type AgentSessionAppendStatusFormat = keyof typeof agentSessionStatusFormat.options;
export type AgentSessionAppendStream = keyof typeof agentSessionStream.options;
export type AgentSessionAppendRawLineEncoding = keyof typeof agentSessionRawLineEncoding.options;

export interface AgentSessionAppendIssueRef {
  readonly id?: string;
  readonly identifier: string;
  readonly title: string;
}

export interface AgentSessionAppendWorkflowIssueRef {
  readonly id?: string;
  readonly identifier: string;
  readonly state?: string;
  readonly title?: string;
}

export interface AgentSessionAppendWorkflowRef {
  readonly feature?: AgentSessionAppendWorkflowIssueRef;
  readonly stream?: AgentSessionAppendWorkflowIssueRef;
  readonly task?: AgentSessionAppendWorkflowIssueRef;
}

export interface AgentSessionAppendBlockerRef {
  readonly kind?: "blocked" | "interrupted";
  readonly reason?: string;
}

export interface AgentSessionAppendFinalizationRef {
  readonly commitSha?: string;
  readonly finalizedAt?: string;
  readonly landedAt?: string;
  readonly linearState?: string;
  readonly state: "finalized" | "pending";
}

export interface AgentSessionAppendRetainedRuntimeRef {
  readonly blocker?: AgentSessionAppendBlockerRef;
  readonly finalization?: AgentSessionAppendFinalizationRef;
  readonly state?: AgentSessionAppendRetainedRuntimeState;
}

export interface AgentSessionAppendRetainedSessionRef {
  readonly branchName?: string;
  readonly externalSessionId: string;
  readonly issue?: AgentSessionAppendIssueRef;
  readonly parentSessionId?: string;
  readonly retainedRole: AgentSessionAppendRetainedRole;
  readonly rootSessionId: string;
  readonly runtime?: AgentSessionAppendRetainedRuntimeRef;
  readonly workflow?: AgentSessionAppendWorkflowRef;
  readonly workspacePath?: string;
}

export type AgentSessionAppendSubject =
  | {
      readonly kind: "branch";
      readonly branchId: string;
    }
  | {
      readonly kind: "commit";
      readonly branchId: string;
      readonly commitId: string;
    };

export interface AgentSessionAppendSessionCreate {
  readonly mode: "create";
  readonly kind: AgentSessionAppendSessionKind;
  readonly projectId: string;
  readonly repositoryId?: string;
  readonly retainedSession: AgentSessionAppendRetainedSessionRef;
  readonly sessionKey: string;
  readonly startedAt?: string;
  readonly subject: AgentSessionAppendSubject;
  readonly threadId?: string;
  readonly title: string;
  readonly turnId?: string;
  readonly workerId: string;
}

export interface AgentSessionAppendSessionExisting {
  readonly mode: "existing";
  readonly sessionId: string;
}

export type AgentSessionAppendSessionInput =
  | AgentSessionAppendSessionCreate
  | AgentSessionAppendSessionExisting;

export interface AgentSessionAppendEventData extends Record<string, unknown> {}

interface AgentSessionAppendEventBase {
  readonly sequence: number;
  readonly timestamp: string;
}

export interface AgentSessionAppendLifecycleEvent extends AgentSessionAppendEventBase {
  readonly data?: AgentSessionAppendEventData;
  readonly phase: AgentSessionAppendLifecyclePhase;
  readonly type: "session";
}

export interface AgentSessionAppendStatusEvent extends AgentSessionAppendEventBase {
  readonly code: AgentSessionAppendStatusCode;
  readonly data?: AgentSessionAppendEventData;
  readonly format: AgentSessionAppendStatusFormat;
  readonly itemId?: string;
  readonly text?: string;
  readonly type: "status";
}

export interface AgentSessionAppendRawLineEvent extends AgentSessionAppendEventBase {
  readonly encoding: AgentSessionAppendRawLineEncoding;
  readonly line: string;
  readonly stream: AgentSessionAppendStream;
  readonly type: "raw-line";
}

export interface AgentSessionAppendCodexNotificationEvent extends AgentSessionAppendEventBase {
  readonly method: string;
  readonly params: Record<string, unknown>;
  readonly type: "codex-notification";
}

export type AgentSessionAppendEvent =
  | AgentSessionAppendCodexNotificationEvent
  | AgentSessionAppendLifecycleEvent
  | AgentSessionAppendRawLineEvent
  | AgentSessionAppendStatusEvent;

export interface AgentSessionAppendRequest {
  readonly events: readonly AgentSessionAppendEvent[];
  readonly session: AgentSessionAppendSessionInput;
}

export interface AgentSessionAppendSessionAcknowledgement {
  readonly sessionId: string;
  readonly status: AgentSessionAppendSessionAckStatus;
}

export interface AgentSessionAppendEventAcknowledgement {
  readonly bytes: number;
  readonly fingerprint: string;
  readonly sequence: number;
  readonly status: AgentSessionAppendEventAckStatus;
}

export interface AgentSessionAppendSuccess {
  readonly events: readonly AgentSessionAppendEventAcknowledgement[];
  readonly nextExpectedSequence: number;
  readonly ok: true;
  readonly session: AgentSessionAppendSessionAcknowledgement;
}

export interface AgentSessionAppendFailure {
  readonly code: AgentSessionAppendFailureCode;
  readonly details?: {
    readonly actualBytes?: number;
    readonly expectedSequence?: number;
    readonly fingerprint?: string;
    readonly maxBytes?: number;
    readonly sequence?: number;
  };
  readonly message: string;
  readonly ok: false;
}

export type AgentSessionAppendResult = AgentSessionAppendSuccess | AgentSessionAppendFailure;

export interface EvaluateAgentSessionAppendRequestOptions {
  readonly maxEventBytes?: number;
  readonly nextExpectedSequence: number;
  readonly persistedEventFingerprints?: ReadonlyMap<number, string>;
  readonly request: AgentSessionAppendRequest;
  readonly session: AgentSessionAppendSessionAcknowledgement;
}

function normalizeOptionalField<T extends Record<string, unknown>, TValue>(
  target: T,
  key: string,
  value: TValue | undefined,
): T {
  if (value !== undefined) {
    (target as Record<string, unknown>)[key] = value;
  }
  return target;
}

function normalizeAgentSessionAppendEvent(event: AgentSessionAppendEvent): Record<string, unknown> {
  switch (event.type) {
    case "session":
      return normalizeOptionalField(
        {
          type: event.type,
          sequence: event.sequence,
          timestamp: event.timestamp,
          phase: event.phase,
        },
        "data",
        event.data,
      );
    case "status":
      return normalizeOptionalField(
        normalizeOptionalField(
          normalizeOptionalField(
            {
              type: event.type,
              sequence: event.sequence,
              timestamp: event.timestamp,
              code: event.code,
              format: event.format,
            },
            "itemId",
            event.itemId,
          ),
          "text",
          event.text,
        ),
        "data",
        event.data,
      );
    case "raw-line":
      return {
        type: event.type,
        sequence: event.sequence,
        timestamp: event.timestamp,
        encoding: event.encoding,
        line: event.line,
        stream: event.stream,
      };
    case "codex-notification":
      return {
        type: event.type,
        sequence: event.sequence,
        timestamp: event.timestamp,
        method: event.method,
        params: event.params,
      };
  }
}

export function createAgentSessionAppendEventFingerprint(event: AgentSessionAppendEvent): string {
  return JSON.stringify(normalizeAgentSessionAppendEvent(event));
}

export function evaluateAgentSessionAppendRequest(
  options: EvaluateAgentSessionAppendRequestOptions,
): AgentSessionAppendResult {
  const persistedFingerprints = new Map(options.persistedEventFingerprints);
  const acknowledgements: AgentSessionAppendEventAcknowledgement[] = [];
  let nextExpectedSequence = options.nextExpectedSequence;

  for (const event of options.request.events) {
    const fingerprint = createAgentSessionAppendEventFingerprint(event);
    const bytes = new TextEncoder().encode(fingerprint).length;

    if (options.maxEventBytes !== undefined && bytes > options.maxEventBytes) {
      return {
        ok: false,
        code: "event-too-large",
        message: `Session event ${event.sequence} exceeds the ${options.maxEventBytes} byte limit.`,
        details: {
          actualBytes: bytes,
          maxBytes: options.maxEventBytes,
          sequence: event.sequence,
        },
      };
    }

    if (event.sequence > nextExpectedSequence) {
      return {
        ok: false,
        code: "sequence-conflict",
        message: `Session event ${event.sequence} skipped the next expected sequence ${nextExpectedSequence}.`,
        details: {
          expectedSequence: nextExpectedSequence,
          fingerprint,
          sequence: event.sequence,
        },
      };
    }

    if (event.sequence < nextExpectedSequence) {
      const persisted = persistedFingerprints.get(event.sequence);
      if (persisted === fingerprint) {
        acknowledgements.push({
          bytes,
          fingerprint,
          sequence: event.sequence,
          status: "duplicate",
        });
        continue;
      }
      return {
        ok: false,
        code: "sequence-conflict",
        message: `Session event ${event.sequence} conflicts with the already acknowledged event at that sequence.`,
        details: {
          expectedSequence: nextExpectedSequence,
          fingerprint,
          sequence: event.sequence,
        },
      };
    }

    persistedFingerprints.set(event.sequence, fingerprint);
    acknowledgements.push({
      bytes,
      fingerprint,
      sequence: event.sequence,
      status: "accepted",
    });
    nextExpectedSequence += 1;
  }

  return {
    ok: true,
    events: acknowledgements,
    nextExpectedSequence,
    session: options.session,
  };
}

export const agentSessionAppendCommand = {
  key: "workflow:agent-session-append",
  label: "Append retained workflow session history",
  execution: "serverOnly",
  input: undefined as unknown as AgentSessionAppendRequest,
  output: undefined as unknown as AgentSessionAppendResult,
  policy: {
    touchesPredicates: [
      { predicateId: edgeId(agentSession.fields.sessionKey) },
      { predicateId: edgeId(agentSession.fields.runtimeState) },
      { predicateId: edgeId(agentSessionEvent.fields.type) },
      { predicateId: edgeId(agentSessionEvent.fields.sequence) },
      { predicateId: edgeId(agentSessionEvent.fields.timestamp) },
      { predicateId: edgeId(agentSessionEvent.fields.data) },
    ],
  },
} satisfies GraphCommandSpec<AgentSessionAppendRequest, AgentSessionAppendResult>;
