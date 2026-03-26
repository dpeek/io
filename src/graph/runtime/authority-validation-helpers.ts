import {
  cloneAuthoritativeGraphWriteResult,
  cloneGraphWriteTransaction,
  type AuthoritativeGraphWriteResult,
  type GraphWriteTransaction,
} from "@io/graph-kernel";
import {
  cloneIncrementalSyncResult,
  cloneTotalSyncPayload,
  type IncrementalSyncResult,
  type TotalSyncPayload,
} from "@io/graph-sync";

import type { GraphValidationIssue, GraphValidationResult } from "./client";

const totalSyncPayloadValidationKey = "$sync:payload";
const incrementalSyncValidationKey = "$sync:incremental";
const graphWriteTransactionValidationKey = "$sync:tx";
const graphWriteResultValidationKey = "$sync:txResult";

export function createPayloadValidationIssue(
  path: readonly string[],
  code: string,
  message: string,
): GraphValidationIssue {
  return {
    source: "runtime",
    code,
    message,
    path: Object.freeze([...path]),
    predicateKey: totalSyncPayloadValidationKey,
    nodeId: totalSyncPayloadValidationKey,
  };
}

export function invalidPayloadResult(
  payload: TotalSyncPayload,
  issues: readonly GraphValidationIssue[],
): Extract<GraphValidationResult<TotalSyncPayload>, { ok: false }> {
  return {
    ok: false,
    phase: "authoritative",
    event: "reconcile",
    value: payload,
    changedPredicateKeys: issues.length > 0 ? [totalSyncPayloadValidationKey] : [],
    issues,
  };
}

export function createIncrementalSyncValidationIssue(
  path: readonly string[],
  code: string,
  message: string,
): GraphValidationIssue {
  return {
    source: "runtime",
    code,
    message,
    path: Object.freeze([...path]),
    predicateKey: incrementalSyncValidationKey,
    nodeId: incrementalSyncValidationKey,
  };
}

export function invalidIncrementalSyncResult(
  result: IncrementalSyncResult,
  issues: readonly GraphValidationIssue[],
): Extract<GraphValidationResult<IncrementalSyncResult>, { ok: false }> {
  return {
    ok: false,
    phase: "authoritative",
    event: "reconcile",
    value: result,
    changedPredicateKeys: issues.length > 0 ? [incrementalSyncValidationKey] : [],
    issues,
  };
}

export function createTransactionValidationIssue(
  path: readonly string[],
  code: string,
  message: string,
): GraphValidationIssue {
  return {
    source: "runtime",
    code,
    message,
    path: Object.freeze([...path]),
    predicateKey: graphWriteTransactionValidationKey,
    nodeId: graphWriteTransactionValidationKey,
  };
}

export function invalidTransactionResult(
  transaction: GraphWriteTransaction,
  issues: readonly GraphValidationIssue[],
): Extract<GraphValidationResult<GraphWriteTransaction>, { ok: false }> {
  return {
    ok: false,
    phase: "authoritative",
    event: "reconcile",
    value: transaction,
    changedPredicateKeys: issues.length > 0 ? [graphWriteTransactionValidationKey] : [],
    issues,
  };
}

export function createGraphWriteResultValidationIssue(
  path: readonly string[],
  code: string,
  message: string,
): GraphValidationIssue {
  return {
    source: "runtime",
    code,
    message,
    path: Object.freeze([...path]),
    predicateKey: graphWriteResultValidationKey,
    nodeId: graphWriteResultValidationKey,
  };
}

export function invalidGraphWriteResult(
  result: AuthoritativeGraphWriteResult,
  issues: readonly GraphValidationIssue[],
): Extract<GraphValidationResult<AuthoritativeGraphWriteResult>, { ok: false }> {
  return {
    ok: false,
    phase: "authoritative",
    event: "reconcile",
    value: result,
    changedPredicateKeys: issues.length > 0 ? [graphWriteResultValidationKey] : [],
    issues,
  };
}

export function withValidationValue<TValue>(
  result: GraphValidationResult<void>,
  value: TValue,
): GraphValidationResult<TValue> {
  return result.ok
    ? {
        ...result,
        value,
      }
    : {
        ...result,
        value,
      };
}

export function cloneValidationIssue(issue: GraphValidationIssue): GraphValidationIssue {
  return {
    ...issue,
    path: Object.freeze([...issue.path]),
  };
}

export function exposeTotalSyncValidationResult(
  result: GraphValidationResult<TotalSyncPayload>,
): GraphValidationResult<TotalSyncPayload> {
  if (result.ok) {
    return {
      ...result,
      value: cloneTotalSyncPayload(result.value),
      changedPredicateKeys: [...result.changedPredicateKeys],
    };
  }

  return {
    ...result,
    value: cloneTotalSyncPayload(result.value),
    changedPredicateKeys: [...result.changedPredicateKeys],
    issues: result.issues.map((issue) => cloneValidationIssue(issue)),
  };
}

export function exposeIncrementalSyncValidationResult(
  result: GraphValidationResult<IncrementalSyncResult>,
): GraphValidationResult<IncrementalSyncResult> {
  if (result.ok) {
    return {
      ...result,
      value: cloneIncrementalSyncResult(result.value),
      changedPredicateKeys: [...result.changedPredicateKeys],
    };
  }

  return {
    ...result,
    value: cloneIncrementalSyncResult(result.value),
    changedPredicateKeys: [...result.changedPredicateKeys],
    issues: result.issues.map((issue) => cloneValidationIssue(issue)),
  };
}

export function exposeGraphWriteValidationResult(
  result: GraphValidationResult<GraphWriteTransaction>,
): GraphValidationResult<GraphWriteTransaction> {
  if (result.ok) {
    return {
      ...result,
      value: cloneGraphWriteTransaction(result.value),
      changedPredicateKeys: [...result.changedPredicateKeys],
    };
  }

  return {
    ...result,
    value: cloneGraphWriteTransaction(result.value),
    changedPredicateKeys: [...result.changedPredicateKeys],
    issues: result.issues.map((issue) => cloneValidationIssue(issue)),
  };
}

export function exposeGraphWriteResultValidationResult(
  result: GraphValidationResult<AuthoritativeGraphWriteResult>,
): GraphValidationResult<AuthoritativeGraphWriteResult> {
  if (result.ok) {
    return {
      ...result,
      value: cloneAuthoritativeGraphWriteResult(result.value),
      changedPredicateKeys: [...result.changedPredicateKeys],
    };
  }

  return {
    ...result,
    value: cloneAuthoritativeGraphWriteResult(result.value),
    changedPredicateKeys: [...result.changedPredicateKeys],
    issues: result.issues.map((issue) => cloneValidationIssue(issue)),
  };
}

export function prefixGraphWriteResultIssues(
  issues: readonly Pick<GraphValidationIssue, "code" | "message" | "path">[],
): GraphValidationIssue[] {
  return issues.map((issue) =>
    createGraphWriteResultValidationIssue(
      ["transaction", ...issue.path],
      issue.code,
      issue.message,
    ),
  );
}

export function prefixIncrementalSyncTransactionIssues(
  index: number,
  issues: readonly Pick<GraphValidationIssue, "code" | "message" | "path">[],
): GraphValidationIssue[] {
  return issues.map((issue) =>
    createIncrementalSyncValidationIssue(
      [`transactions[${index}]`, ...issue.path],
      issue.code,
      issue.message,
    ),
  );
}
