import {
  createGraphStore,
  type AnyTypeOutput,
  type AuthoritativeGraphWriteResult,
  type GraphStore,
  type GraphStoreSnapshot,
} from "@io/graph-kernel";
import {
  createGraphSyncValidationIssue,
  invalidAuthoritativeGraphWriteResult,
  invalidTotalSyncPayloadResult,
  materializeGraphWriteTransactionSnapshot,
  prepareAuthoritativeGraphWriteResult,
  prepareTotalSyncPayload,
  type AuthoritativeGraphWriteResultValidator,
  type GraphSyncValidationIssue,
  type GraphSyncValidationResult,
  type TotalSyncPayload,
  type TotalSyncPayloadValidator,
} from "@io/graph-sync";

import {
  GraphValidationError,
  validateGraphStore,
  type GraphValidationIssue,
  type GraphValidationResult,
} from "./graph.js";

function withValidationValue<TValue, TResult extends GraphValidationResult<unknown>>(
  result: TResult,
  value: TValue,
): GraphValidationResult<TValue> {
  return {
    ...result,
    value,
  } as GraphValidationResult<TValue>;
}

function cloneSyncValidationIssue(issue: GraphSyncValidationIssue): GraphValidationIssue {
  return {
    code: issue.code,
    message: issue.message,
    source: "runtime",
    path: Object.freeze([...issue.path]),
    predicateKey: issue.predicateKey,
    nodeId: issue.nodeId,
  };
}

function toClientValidationResult<TValue>(
  result: Extract<GraphSyncValidationResult<TValue>, { ok: false }>,
): Extract<GraphValidationResult<TValue>, { ok: false }> {
  return {
    ok: false,
    phase: result.phase,
    event: result.event,
    value: result.value,
    changedPredicateKeys: [...result.changedPredicateKeys],
    issues: result.issues.map((issue) => cloneSyncValidationIssue(issue)),
  };
}

function prefixGraphWriteResultIssues(
  issues: readonly GraphSyncValidationIssue[],
): GraphSyncValidationIssue[] {
  return issues.map((issue) =>
    createGraphSyncValidationIssue(["transaction", ...issue.path], issue.code, issue.message),
  );
}

function validateClientTotalSyncPayload<const T extends Record<string, AnyTypeOutput>>(
  payload: TotalSyncPayload,
  namespace: T,
  options: {
    preserveSnapshot?: GraphStoreSnapshot;
  } = {},
): GraphValidationResult<TotalSyncPayload> {
  const prepared = prepareTotalSyncPayload(payload, options);
  if (!prepared.ok) {
    return toClientValidationResult(invalidTotalSyncPayloadResult(payload, prepared.result.issues));
  }

  const validationStore = createGraphStore(prepared.value.snapshot);
  return withValidationValue(validateGraphStore(validationStore, namespace), payload);
}

function validateClientGraphWriteResult<const T extends Record<string, AnyTypeOutput>>(
  result: AuthoritativeGraphWriteResult,
  store: GraphStore,
  namespace: T,
): GraphValidationResult<AuthoritativeGraphWriteResult> {
  const prepared = prepareAuthoritativeGraphWriteResult(result);
  if (!prepared.ok) {
    return toClientValidationResult(
      invalidAuthoritativeGraphWriteResult(result, prepared.result.issues),
    );
  }

  const materialized = materializeGraphWriteTransactionSnapshot(store, prepared.value.transaction, {
    allowExistingAssertEdgeIds: true,
  });
  if (!materialized.ok) {
    return toClientValidationResult(
      invalidAuthoritativeGraphWriteResult(
        prepared.value,
        prefixGraphWriteResultIssues(materialized.result.issues),
      ),
    );
  }

  const validationStore = createGraphStore(materialized.value);
  return withValidationValue(validateGraphStore(validationStore, namespace), prepared.value);
}

export function createClientTotalSyncValidator<const T extends Record<string, AnyTypeOutput>>(
  namespace: T,
  options: {
    preserveSnapshot?: GraphStoreSnapshot;
  } = {},
): TotalSyncPayloadValidator {
  return (payload) => {
    const validation = validateClientTotalSyncPayload(payload, namespace, options);
    if (!validation.ok) throw new GraphValidationError(validation);
  };
}

export function createClientGraphWriteResultValidator<
  const T extends Record<string, AnyTypeOutput>,
>(store: GraphStore, namespace: T): AuthoritativeGraphWriteResultValidator {
  return (result, validationStore = store) => {
    const validation = validateClientGraphWriteResult(result, validationStore, namespace);
    if (!validation.ok) throw new GraphValidationError(validation);
  };
}
