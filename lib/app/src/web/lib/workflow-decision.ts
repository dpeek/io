import { type GraphStore } from "@io/app/graph";
import { type AuthoritativeGraphWriteResult, type GraphWriteTransaction } from "@io/graph-kernel";
import {
  evaluateDecisionWriteRequest,
  type DecisionWriteKind,
  type DecisionWriteRequest,
  type DecisionWriteResult,
  type WorkflowDecisionRecord,
  workflow,
} from "@io/graph-module-workflow";

import type {
  WebAppAuthorityCommandOptions,
  WebAppAuthorityTransactionOptions,
} from "./authority.js";
import { requireAgentSession } from "./workflow-authority-shared.js";
import {
  WorkflowMutationError,
  planWorkflowMutation,
  requireString,
  type ProductGraphClient,
} from "./workflow-mutation-helpers.js";

type WorkflowDecisionAuthority = {
  readonly store: GraphStore;
  applyTransaction(
    transaction: GraphWriteTransaction,
    options: WebAppAuthorityTransactionOptions,
  ): Promise<AuthoritativeGraphWriteResult>;
};

const decisionKindIds = {
  assumption: workflow.decisionKind.values.assumption.id as string,
  blocker: workflow.decisionKind.values.blocker.id as string,
  plan: workflow.decisionKind.values.plan.id as string,
  question: workflow.decisionKind.values.question.id as string,
  resolution: workflow.decisionKind.values.resolution.id as string,
} as const satisfies Record<DecisionWriteKind, string>;

const decisionKindKeysById = invertRecord(decisionKindIds);
const branchSubjectKindId = workflow.agentSessionSubjectKind.values.branch.id as string;
const commitSubjectKindId = workflow.agentSessionSubjectKind.values.commit.id as string;

function invertRecord<TValue extends string>(
  value: Record<TValue, string>,
): Record<string, TValue> {
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [entry, key])) as Record<
    string,
    TValue
  >;
}

function decodeDecisionKind(value: string): DecisionWriteKind {
  const kind = decisionKindKeysById[value];
  if (!kind) {
    throw new Error(`Unknown workflow decision kind id "${value}".`);
  }
  return kind;
}

function requireDecisionKindId(value: string): string {
  if (value in decisionKindIds) {
    return decisionKindIds[value as DecisionWriteKind];
  }
  throw new WorkflowMutationError(
    400,
    `Decision kind must be one of: ${Object.keys(decisionKindIds).join(", ")}.`,
  );
}

function buildWorkflowDecisionRecord(
  entity: ReturnType<ProductGraphClient["decision"]["get"]>,
): WorkflowDecisionRecord {
  return {
    id: entity.id,
    projectId: entity.project,
    ...(entity.repository ? { repositoryId: entity.repository } : {}),
    branchId: entity.branch,
    ...(entity.commit ? { commitId: entity.commit } : {}),
    sessionId: entity.session,
    kind: decodeDecisionKind(entity.kind),
    summary: entity.name,
    ...(entity.details ? { details: entity.details } : {}),
    createdAt: entity.createdAt.toISOString(),
  };
}

function resolveDecisionCommitId(
  session: ReturnType<ProductGraphClient["agentSession"]["get"]>,
): string | undefined {
  if (session.subjectKind === branchSubjectKindId) {
    return undefined;
  }
  if (session.subjectKind === commitSubjectKindId) {
    if (!session.commit) {
      throw new WorkflowMutationError(
        409,
        `Workflow session "${session.id}" is missing commit provenance.`,
        "invalid-transition",
      );
    }
    return session.commit;
  }
  throw new Error(`Unknown workflow session subject kind id "${session.subjectKind}".`);
}

function materializeDecisionWrite(
  graph: ProductGraphClient,
  store: GraphStore,
  input: DecisionWriteRequest,
): DecisionWriteResult {
  const session = requireAgentSession(graph, store, requireString(input.sessionId, "Session id"));
  const evaluated = evaluateDecisionWriteRequest(input);
  if (!evaluated.ok) {
    throw new WorkflowMutationError(400, evaluated.message);
  }

  const commitId = resolveDecisionCommitId(session);
  const decisionId = graph.decision.create({
    name: evaluated.decision.summary,
    project: session.project,
    ...(session.repository ? { repository: session.repository } : {}),
    branch: session.branch,
    ...(commitId ? { commit: commitId } : {}),
    session: session.id,
    kind: requireDecisionKindId(evaluated.decision.kind),
    ...(evaluated.decision.details ? { details: evaluated.decision.details } : {}),
  });

  return {
    decision: buildWorkflowDecisionRecord(graph.decision.get(decisionId)),
  };
}

export async function runWorkflowDecisionWriteCommand(
  input: DecisionWriteRequest,
  authority: WorkflowDecisionAuthority,
  options: WebAppAuthorityCommandOptions,
): Promise<DecisionWriteResult> {
  const planned = planWorkflowMutation(
    authority.store.snapshot(),
    `workflow-decision-write:${input.sessionId}:${Date.now()}`,
    (graph, store) => materializeDecisionWrite(graph, store, input),
  );

  await authority.applyTransaction(planned.transaction, {
    authorization: options.authorization,
    writeScope: "server-command",
  });
  return planned.result;
}
