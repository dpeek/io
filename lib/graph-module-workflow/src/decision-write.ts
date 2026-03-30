import { edgeId } from "@io/graph-kernel";
import type { GraphCommandSpec } from "@io/graph-module";

import { decision, decisionKind } from "./type.js";

function hasNonBlankString(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export const decisionWriteFailureCodes = ["details-missing", "summary-missing"] as const;

export type DecisionWriteFailureCode = (typeof decisionWriteFailureCodes)[number];
export type DecisionWriteKind = keyof typeof decisionKind.options;

export interface WorkflowDecisionInput {
  readonly details?: string;
  readonly kind: DecisionWriteKind;
  readonly summary: string;
}

export interface DecisionWriteRequest {
  readonly decision: WorkflowDecisionInput;
  readonly sessionId: string;
}

export interface WorkflowDecisionRecord {
  readonly branchId: string;
  readonly commitId?: string;
  readonly createdAt: string;
  readonly details?: string;
  readonly id: string;
  readonly kind: DecisionWriteKind;
  readonly projectId: string;
  readonly repositoryId?: string;
  readonly sessionId: string;
  readonly summary: string;
}

export interface DecisionWriteResult {
  readonly decision: WorkflowDecisionRecord;
}

export interface DecisionWriteValidationSuccess {
  readonly decision: WorkflowDecisionInput;
  readonly ok: true;
}

export interface DecisionWriteValidationFailure {
  readonly code: DecisionWriteFailureCode;
  readonly message: string;
  readonly ok: false;
}

export type DecisionWriteValidationResult =
  | DecisionWriteValidationFailure
  | DecisionWriteValidationSuccess;

export function evaluateDecisionWriteRequest(
  request: DecisionWriteRequest,
): DecisionWriteValidationResult {
  const summary = request.decision.summary.trim();
  if (!summary) {
    return {
      ok: false,
      code: "summary-missing",
      message: "Workflow decision writes require a non-empty summary.",
    };
  }

  const details = request.decision.details?.trim();
  if (request.decision.kind === "blocker" && !details) {
    return {
      ok: false,
      code: "details-missing",
      message: "Workflow blocker decisions require non-empty details.",
    };
  }

  return {
    ok: true,
    decision: {
      kind: request.decision.kind,
      summary,
      ...(details ? { details } : {}),
    },
  };
}

export const decisionWriteCommand = {
  key: "workflow:decision-write",
  label: "Persist workflow decision",
  execution: "serverOnly",
  input: undefined as unknown as DecisionWriteRequest,
  output: undefined as unknown as DecisionWriteResult,
  policy: {
    touchesPredicates: [
      { predicateId: edgeId(decision.fields.name) },
      { predicateId: edgeId(decision.fields.project) },
      { predicateId: edgeId(decision.fields.repository) },
      { predicateId: edgeId(decision.fields.branch) },
      { predicateId: edgeId(decision.fields.commit) },
      { predicateId: edgeId(decision.fields.session) },
      { predicateId: edgeId(decision.fields.kind) },
      { predicateId: edgeId(decision.fields.details) },
    ],
  },
} satisfies GraphCommandSpec<DecisionWriteRequest, DecisionWriteResult>;
