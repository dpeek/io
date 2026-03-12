import {
  GraphValidationError,
  createTypeClient,
  type GraphValidationIssue,
  type GraphValidationResult,
  type NamespaceClient,
  validateGraphStore,
} from "./client"
import { bootstrap } from "./bootstrap"
import type { AnyTypeOutput } from "./schema"
import { createStore, type Store, type StoreSnapshot } from "./store"

export type SyncCompleteness = "complete" | "incomplete"
export type SyncFreshness = "current" | "stale"
export type SyncStatus = "idle" | "syncing" | "pushing" | "ready" | "error"
export type SyncActivity =
  | {
      readonly kind: "total"
      readonly cursor: string
      readonly freshness: SyncFreshness
      readonly at: Date
    }
  | {
      readonly kind: "incremental"
      readonly after: string
      readonly cursor: string
      readonly freshness: SyncFreshness
      readonly transactionCount: number
      readonly txIds: readonly string[]
      readonly at: Date
    }
  | {
      readonly kind: "fallback"
      readonly after: string
      readonly cursor: string
      readonly freshness: SyncFreshness
      readonly reason: IncrementalSyncFallbackReason
      readonly at: Date
    }
  | {
      readonly kind: "write"
      readonly txId: string
      readonly cursor: string
      readonly freshness: SyncFreshness
      readonly replayed: boolean
      readonly at: Date
    }

export type SyncScope = {
  readonly kind: "graph"
}

export const graphSyncScope: SyncScope = Object.freeze({ kind: "graph" })

export type TotalSyncPayload = {
  readonly mode: "total"
  readonly scope: SyncScope
  readonly snapshot: StoreSnapshot
  readonly cursor: string
  readonly completeness: "complete"
  readonly freshness: SyncFreshness
}

export type IncrementalSyncFallbackReason = "unknown-cursor" | "gap" | "reset"

export type IncrementalSyncPayload = {
  readonly mode: "incremental"
  readonly scope: SyncScope
  readonly after: string
  readonly transactions: readonly AuthoritativeGraphWriteResult[]
  readonly cursor: string
  readonly completeness: "complete"
  readonly freshness: SyncFreshness
}

export type IncrementalSyncFallback = {
  readonly mode: "incremental"
  readonly scope: SyncScope
  readonly after: string
  readonly transactions: readonly []
  readonly cursor: string
  readonly completeness: "complete"
  readonly freshness: SyncFreshness
  readonly fallback: IncrementalSyncFallbackReason
}

export type IncrementalSyncResult = IncrementalSyncPayload | IncrementalSyncFallback
export type SyncPayload = TotalSyncPayload | IncrementalSyncResult

export type GraphWriteAssertOperation = {
  readonly op: "assert"
  readonly edge: StoreSnapshot["edges"][number]
}

export type GraphWriteRetractOperation = {
  readonly op: "retract"
  readonly edgeId: string
}

export type GraphWriteOperation = GraphWriteAssertOperation | GraphWriteRetractOperation

export type GraphWriteTransaction = {
  readonly id: string
  readonly ops: readonly GraphWriteOperation[]
}

export type AuthoritativeGraphWriteResult = {
  readonly txId: string
  readonly cursor: string
  readonly replayed: boolean
  readonly transaction: GraphWriteTransaction
}

export type AuthoritativeGraphWriteHistory = {
  readonly cursorPrefix: string
  readonly baseSequence: number
  readonly results: readonly AuthoritativeGraphWriteResult[]
}

export type AuthoritativeGraphChangesAfterResult =
  | {
      readonly kind: "changes"
      readonly cursor: string
      readonly changes: readonly AuthoritativeGraphWriteResult[]
    }
  | {
      readonly kind: "reset"
      readonly cursor: string
      readonly changes: readonly []
    }

export type GraphWriteSink = (
  transaction: GraphWriteTransaction,
) => AuthoritativeGraphWriteResult | Promise<AuthoritativeGraphWriteResult>

export class GraphSyncWriteError extends Error {
  override readonly name: string
  readonly transaction: GraphWriteTransaction
  override readonly cause: unknown

  constructor(transaction: GraphWriteTransaction, cause: unknown) {
    super(`Failed to push pending graph write "${transaction.id}".`)
    this.name = "GraphSyncWriteError"
    this.transaction = cloneGraphWriteTransaction(transaction)
    this.cause = cause
  }
}

const totalSyncPayloadValidationKey = "$sync:payload"
const incrementalSyncValidationKey = "$sync:incremental"
const graphWriteTransactionValidationKey = "$sync:tx"
const graphWriteResultValidationKey = "$sync:txResult"

function createPayloadValidationIssue(
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
  }
}

function invalidPayloadResult(
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
  }
}

function createIncrementalSyncValidationIssue(
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
  }
}

function invalidIncrementalSyncResult(
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
  }
}

function createTransactionValidationIssue(
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
  }
}

function invalidTransactionResult(
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
  }
}

function createGraphWriteResultValidationIssue(
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
  }
}

function invalidGraphWriteResult(
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
  }
}

function prepareTotalSyncPayload(
  payload: TotalSyncPayload,
  options: {
    preserveSnapshot?: StoreSnapshot
  } = {},
):
  | {
      ok: true
      value: TotalSyncPayload
    }
  | {
      ok: false
      result: Extract<GraphValidationResult<TotalSyncPayload>, { ok: false }>
    } {
  const issues = validateTotalSyncPayloadShape(payload)
  if (issues.length > 0) {
    return {
      ok: false,
      result: invalidPayloadResult(payload, issues),
    }
  }

  return {
    ok: true,
    value: materializeTotalSyncPayload(payload, options.preserveSnapshot),
  }
}

function withValidationValue<TValue>(
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
      }
}

function cloneValidationIssue(issue: GraphValidationIssue): GraphValidationIssue {
  return {
    ...issue,
    path: Object.freeze([...issue.path]),
  }
}

function cloneGraphWriteOperation(operation: unknown): GraphWriteOperation {
  if (isObjectRecord(operation) && operation.op === "retract") {
    return {
      op: "retract",
      edgeId: typeof operation.edgeId === "string" ? operation.edgeId : "",
    }
  }

  const edge = isObjectRecord(operation) && isObjectRecord(operation.edge) ? operation.edge : {}
  return {
    op: "assert",
    edge: {
      id: typeof edge.id === "string" ? edge.id : "",
      s: typeof edge.s === "string" ? edge.s : "",
      p: typeof edge.p === "string" ? edge.p : "",
      o: typeof edge.o === "string" ? edge.o : "",
    },
  }
}

function cloneGraphWriteTransaction(transaction: GraphWriteTransaction): GraphWriteTransaction {
  const candidate = transaction as Partial<GraphWriteTransaction> & Record<string, unknown>
  return {
    id: typeof candidate.id === "string" ? candidate.id : "",
    ops: Array.isArray(candidate.ops)
      ? candidate.ops.map((operation) => cloneGraphWriteOperation(operation))
      : [],
  }
}

function cloneAuthoritativeGraphWriteResult(
  result: AuthoritativeGraphWriteResult,
  options: {
    replayed?: boolean
  } = {},
): AuthoritativeGraphWriteResult {
  return {
    ...result,
    replayed: options.replayed ?? result.replayed,
    transaction: cloneGraphWriteTransaction(result.transaction),
  }
}

function cloneTotalSyncPayload(payload: TotalSyncPayload): TotalSyncPayload {
  return {
    ...payload,
    scope: { ...payload.scope },
    snapshot: {
      edges: payload.snapshot.edges.map((edge) => ({ ...edge })),
      retracted: [...payload.snapshot.retracted],
    },
  }
}

function cloneIncrementalSyncResult(result: IncrementalSyncResult): IncrementalSyncResult {
  return "fallback" in result
    ? {
        ...result,
        scope: { ...result.scope },
        transactions: [],
      }
    : {
        ...result,
        scope: { ...result.scope },
        transactions: result.transactions.map((transaction) =>
          cloneAuthoritativeGraphWriteResult(transaction),
        ),
      }
}

function exposeTotalSyncValidationResult(
  result: GraphValidationResult<TotalSyncPayload>,
): GraphValidationResult<TotalSyncPayload> {
  if (result.ok) {
    return {
      ...result,
      value: cloneTotalSyncPayload(result.value),
      changedPredicateKeys: [...result.changedPredicateKeys],
    }
  }

  return {
    ...result,
    value: cloneTotalSyncPayload(result.value),
    changedPredicateKeys: [...result.changedPredicateKeys],
    issues: result.issues.map((issue) => cloneValidationIssue(issue)),
  }
}

function exposeIncrementalSyncValidationResult(
  result: GraphValidationResult<IncrementalSyncResult>,
): GraphValidationResult<IncrementalSyncResult> {
  if (result.ok) {
    return {
      ...result,
      value: cloneIncrementalSyncResult(result.value),
      changedPredicateKeys: [...result.changedPredicateKeys],
    }
  }

  return {
    ...result,
    value: cloneIncrementalSyncResult(result.value),
    changedPredicateKeys: [...result.changedPredicateKeys],
    issues: result.issues.map((issue) => cloneValidationIssue(issue)),
  }
}

function exposeGraphWriteValidationResult(
  result: GraphValidationResult<GraphWriteTransaction>,
): GraphValidationResult<GraphWriteTransaction> {
  if (result.ok) {
    return {
      ...result,
      value: cloneGraphWriteTransaction(result.value),
      changedPredicateKeys: [...result.changedPredicateKeys],
    }
  }

  return {
    ...result,
    value: cloneGraphWriteTransaction(result.value),
    changedPredicateKeys: [...result.changedPredicateKeys],
    issues: result.issues.map((issue) => cloneValidationIssue(issue)),
  }
}

function exposeGraphWriteResultValidationResult(
  result: GraphValidationResult<AuthoritativeGraphWriteResult>,
): GraphValidationResult<AuthoritativeGraphWriteResult> {
  if (result.ok) {
    return {
      ...result,
      value: cloneAuthoritativeGraphWriteResult(result.value),
      changedPredicateKeys: [...result.changedPredicateKeys],
    }
  }

  return {
    ...result,
    value: cloneAuthoritativeGraphWriteResult(result.value),
    changedPredicateKeys: [...result.changedPredicateKeys],
    issues: result.issues.map((issue) => cloneValidationIssue(issue)),
  }
}

function prefixGraphWriteResultIssues(
  issues: readonly GraphValidationIssue[],
): GraphValidationIssue[] {
  return issues.map((issue) =>
    createGraphWriteResultValidationIssue(["transaction", ...issue.path], issue.code, issue.message),
  )
}

function compareGraphWriteOperations(left: GraphWriteOperation, right: GraphWriteOperation): number {
  if (left.op !== right.op) return left.op === "retract" ? -1 : 1

  if (left.op === "retract" && right.op === "retract") {
    return left.edgeId.localeCompare(right.edgeId)
  }

  if (left.op === "assert" && right.op === "assert") {
    return (
      left.edge.s.localeCompare(right.edge.s) ||
      left.edge.p.localeCompare(right.edge.p) ||
      left.edge.o.localeCompare(right.edge.o) ||
      left.edge.id.localeCompare(right.edge.id)
    )
  }

  return 0
}

function sameGraphWriteOperation(left: GraphWriteOperation, right: GraphWriteOperation): boolean {
  if (left.op !== right.op) return false
  if (left.op === "retract" && right.op === "retract") return left.edgeId === right.edgeId
  if (left.op === "assert" && right.op === "assert") {
    return (
      left.edge.id === right.edge.id &&
      left.edge.s === right.edge.s &&
      left.edge.p === right.edge.p &&
      left.edge.o === right.edge.o
    )
  }
  return false
}

function sameGraphWriteTransaction(
  left: GraphWriteTransaction,
  right: GraphWriteTransaction,
): boolean {
  if (left.id !== right.id) return false
  if (left.ops.length !== right.ops.length) return false
  for (let index = 0; index < left.ops.length; index += 1) {
    const leftOperation = left.ops[index]
    const rightOperation = right.ops[index]
    if (!leftOperation || !rightOperation) return false
    if (!sameGraphWriteOperation(leftOperation, rightOperation)) return false
  }
  return true
}

function logicalFactKey(edge: StoreSnapshot["edges"][number]): string {
  return `${edge.s}\0${edge.p}\0${edge.o}`
}

export function createGraphWriteOperationsFromSnapshots(
  before: StoreSnapshot,
  after: StoreSnapshot,
): readonly GraphWriteOperation[] {
  const beforeEdgeIds = new Set(before.edges.map((edge) => edge.id))
  const beforeRetractedIds = new Set(before.retracted)

  return canonicalizeGraphWriteTransaction({
    id: "$sync:derived",
    ops: [
      ...after.retracted
        .filter((edgeId) => !beforeRetractedIds.has(edgeId))
        .map(
          (edgeId): GraphWriteRetractOperation => ({
            op: "retract",
            edgeId,
          }),
        ),
      ...after.edges
        .filter((edge) => !beforeEdgeIds.has(edge.id))
        .map(
          (edge): GraphWriteAssertOperation => ({
            op: "assert",
            edge: { ...edge },
          }),
        ),
    ],
  }).ops
}

export function createGraphWriteTransactionFromSnapshots(
  before: StoreSnapshot,
  after: StoreSnapshot,
  txId: string,
): GraphWriteTransaction {
  return canonicalizeGraphWriteTransaction({
    id: txId,
    ops: createGraphWriteOperationsFromSnapshots(before, after),
  })
}

function materializeTotalSyncPayload(
  payload: TotalSyncPayload,
  preserveSnapshot?: StoreSnapshot,
): TotalSyncPayload {
  if (
    !preserveSnapshot ||
    (preserveSnapshot.edges.length === 0 && preserveSnapshot.retracted.length === 0)
  ) {
    return payload
  }

  const retractedIds = new Set(payload.snapshot.retracted)
  const currentFactKeys = new Set(
    payload.snapshot.edges
      .filter((edge) => !retractedIds.has(edge.id))
      .map((edge) => logicalFactKey(edge)),
  )
  const edgeIds = new Set(payload.snapshot.edges.map((edge) => edge.id))
  const mergedRetractedIds = new Set(payload.snapshot.retracted)
  const edges = payload.snapshot.edges.map((edge) => ({ ...edge }))
  const retracted = [...payload.snapshot.retracted]

  for (const edge of preserveSnapshot.edges) {
    if (currentFactKeys.has(logicalFactKey(edge))) continue
    if (edgeIds.has(edge.id)) continue
    edges.push({ ...edge })
    edgeIds.add(edge.id)
  }

  for (const edgeId of preserveSnapshot.retracted) {
    if (!edgeIds.has(edgeId) || mergedRetractedIds.has(edgeId)) continue
    retracted.push(edgeId)
    mergedRetractedIds.add(edgeId)
  }

  return {
    ...payload,
    snapshot: {
      edges,
      retracted,
    },
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object"
}

function validateGraphWriteTransactionShape(
  transaction: GraphWriteTransaction,
): readonly GraphValidationIssue[] {
  const issues: GraphValidationIssue[] = []
  const candidate = transaction as Partial<GraphWriteTransaction> & Record<string, unknown>
  const assertIds = new Map<string, StoreSnapshot["edges"][number]>()
  const retractIds = new Set<string>()

  if (typeof candidate.id !== "string") {
    issues.push(
      createTransactionValidationIssue(
        ["id"],
        "sync.tx.id",
        'Field "id" must be a string.',
      ),
    )
  } else if (candidate.id.length === 0) {
    issues.push(
      createTransactionValidationIssue(
        ["id"],
        "sync.tx.id.empty",
        'Field "id" must not be empty.',
      ),
    )
  }

  if (!Array.isArray(candidate.ops)) {
    issues.push(
      createTransactionValidationIssue(
        ["ops"],
        "sync.tx.ops",
        'Field "ops" must be an array.',
      ),
    )
    return issues
  }

  if (candidate.ops.length === 0) {
    issues.push(
      createTransactionValidationIssue(
        ["ops"],
        "sync.tx.ops.empty",
        'Field "ops" must contain at least one operation.',
      ),
    )
  }

  candidate.ops.forEach((operation, index) => {
    const opPath = `ops[${index}]`
    if (!isObjectRecord(operation)) {
      issues.push(
        createTransactionValidationIssue(
          [opPath],
          "sync.tx.op",
          `Field "${opPath}" must be an operation object.`,
        ),
      )
      return
    }

    if (operation.op === "retract") {
      if (typeof operation.edgeId !== "string") {
        issues.push(
          createTransactionValidationIssue(
            [opPath, "edgeId"],
            "sync.tx.op.retract.edgeId",
            `Field "${opPath}.edgeId" must be a string.`,
          ),
        )
        return
      }

      if (assertIds.has(operation.edgeId)) {
        issues.push(
          createTransactionValidationIssue(
            [opPath, "edgeId"],
            "sync.tx.op.edgeId.reused",
            `Field "${opPath}.edgeId" must not reuse an asserted edge id in the same transaction.`,
          ),
        )
      }
      retractIds.add(operation.edgeId)
      return
    }

    if (operation.op !== "assert") {
      issues.push(
        createTransactionValidationIssue(
          [opPath, "op"],
          "sync.tx.op.kind",
          `Field "${opPath}.op" must be "assert" or "retract".`,
        ),
      )
      return
    }

    if (!isObjectRecord(operation.edge)) {
      issues.push(
        createTransactionValidationIssue(
          [opPath, "edge"],
          "sync.tx.op.assert.edge",
          `Field "${opPath}.edge" must be an edge object.`,
        ),
      )
      return
    }

    for (const key of ["id", "s", "p", "o"] as const) {
      if (typeof operation.edge[key] !== "string") {
        issues.push(
          createTransactionValidationIssue(
            [opPath, "edge", key],
            `sync.tx.op.assert.edge.${key}`,
            `Field "${opPath}.edge.${key}" must be a string.`,
          ),
        )
      }
    }

    if (
      typeof operation.edge.id !== "string" ||
      typeof operation.edge.s !== "string" ||
      typeof operation.edge.p !== "string" ||
      typeof operation.edge.o !== "string"
    ) {
      return
    }
    if (retractIds.has(operation.edge.id)) {
      issues.push(
        createTransactionValidationIssue(
          [opPath, "edge", "id"],
          "sync.tx.op.edgeId.reused",
          `Field "${opPath}.edge.id" must not reuse a retracted edge id in the same transaction.`,
        ),
      )
    }

    const existing = assertIds.get(operation.edge.id)
    if (!existing) {
      assertIds.set(operation.edge.id, {
        id: operation.edge.id,
        s: operation.edge.s,
        p: operation.edge.p,
        o: operation.edge.o,
      })
      return
    }

    if (
      existing.s !== operation.edge.s ||
      existing.p !== operation.edge.p ||
      existing.o !== operation.edge.o
    ) {
      issues.push(
        createTransactionValidationIssue(
          [opPath, "edge", "id"],
          "sync.tx.op.assert.edge.id.conflict",
          `Field "${opPath}.edge.id" must not describe multiple asserted edges in the same transaction.`,
        ),
      )
    }
  })

  return issues
}

export function canonicalizeGraphWriteTransaction(
  transaction: GraphWriteTransaction,
): GraphWriteTransaction {
  const retractIds = new Set<string>()
  const assertById = new Map<string, StoreSnapshot["edges"][number]>()

  for (const operation of transaction.ops) {
    if (operation.op === "retract") {
      retractIds.add(operation.edgeId)
      continue
    }

    if (assertById.has(operation.edge.id)) continue
    assertById.set(operation.edge.id, { ...operation.edge })
  }

  const ops: GraphWriteOperation[] = [
    ...[...retractIds]
      .sort((left, right) => left.localeCompare(right))
      .map(
        (edgeId): GraphWriteRetractOperation => ({
          op: "retract",
          edgeId,
        }),
      ),
    ...[...assertById.values()]
      .sort((left, right) => {
        return (
          left.s.localeCompare(right.s) ||
          left.p.localeCompare(right.p) ||
          left.o.localeCompare(right.o) ||
          left.id.localeCompare(right.id)
        )
      })
      .map(
        (edge): GraphWriteAssertOperation => ({
          op: "assert",
          edge: { ...edge },
        }),
      ),
  ]
  ops.sort(compareGraphWriteOperations)

  return {
    ...transaction,
    ops,
  }
}

function prepareGraphWriteTransaction(
  transaction: GraphWriteTransaction,
):
  | {
      ok: true
      value: GraphWriteTransaction
    }
  | {
      ok: false
      result: Extract<GraphValidationResult<GraphWriteTransaction>, { ok: false }>
    } {
  const issues = validateGraphWriteTransactionShape(transaction)
  if (issues.length > 0) {
    return {
      ok: false,
      result: invalidTransactionResult(cloneGraphWriteTransaction(transaction), issues),
    }
  }

  return {
    ok: true,
    value: canonicalizeGraphWriteTransaction(transaction),
  }
}

function prepareAuthoritativeGraphWriteResult(
  result: AuthoritativeGraphWriteResult,
):
  | {
      ok: true
      value: AuthoritativeGraphWriteResult
    }
  | {
      ok: false
      result: Extract<GraphValidationResult<AuthoritativeGraphWriteResult>, { ok: false }>
    } {
  const candidate = result as Partial<AuthoritativeGraphWriteResult> & Record<string, unknown>
  const issues: GraphValidationIssue[] = []

  if (typeof candidate.txId !== "string") {
    issues.push(
      createGraphWriteResultValidationIssue(
        ["txId"],
        "sync.txResult.txId",
        'Field "txId" must be a string.',
      ),
    )
  } else if (candidate.txId.length === 0) {
    issues.push(
      createGraphWriteResultValidationIssue(
        ["txId"],
        "sync.txResult.txId.empty",
        'Field "txId" must not be empty.',
      ),
    )
  }

  if (typeof candidate.cursor !== "string") {
    issues.push(
      createGraphWriteResultValidationIssue(
        ["cursor"],
        "sync.txResult.cursor",
        'Field "cursor" must be a string.',
      ),
    )
  } else if (candidate.cursor.length === 0) {
    issues.push(
      createGraphWriteResultValidationIssue(
        ["cursor"],
        "sync.txResult.cursor.empty",
        'Field "cursor" must not be empty.',
      ),
    )
  }

  if (typeof candidate.replayed !== "boolean") {
    issues.push(
      createGraphWriteResultValidationIssue(
        ["replayed"],
        "sync.txResult.replayed",
        'Field "replayed" must be a boolean.',
      ),
    )
  }

  const transaction = cloneGraphWriteTransaction(
    isObjectRecord(candidate.transaction)
      ? (candidate.transaction as GraphWriteTransaction)
      : ({ id: "", ops: [] } as GraphWriteTransaction),
  )
  issues.push(...prefixGraphWriteResultIssues(validateGraphWriteTransactionShape(transaction)))

  if (typeof candidate.txId === "string" && candidate.txId !== transaction.id) {
    issues.push(
      createGraphWriteResultValidationIssue(
        ["txId"],
        "sync.txResult.txId.mismatch",
        'Field "txId" must match "transaction.id".',
      ),
    )
  }

  const cloned = cloneAuthoritativeGraphWriteResult({
    txId: typeof candidate.txId === "string" ? candidate.txId : "",
    cursor: typeof candidate.cursor === "string" ? candidate.cursor : "",
    replayed: typeof candidate.replayed === "boolean" ? candidate.replayed : false,
    transaction,
  })

  if (issues.length > 0) {
    return {
      ok: false,
      result: invalidGraphWriteResult(cloned, issues),
    }
  }

  return {
    ok: true,
    value: {
      ...cloned,
      transaction: canonicalizeGraphWriteTransaction(transaction),
    },
  }
}

function materializeGraphWriteTransactionSnapshot(
  store: Store,
  transaction: GraphWriteTransaction,
  options: {
    allowExistingAssertEdgeIds?: boolean
  } = {},
):
  | {
      ok: true
      value: StoreSnapshot
    }
  | {
      ok: false
      result: Extract<GraphValidationResult<GraphWriteTransaction>, { ok: false }>
    } {
  const snapshot = store.snapshot()
  const edges = snapshot.edges.map((edge) => ({ ...edge }))
  const edgeById = new Map(edges.map((edge) => [edge.id, edge]))
  const retracted = new Set(snapshot.retracted)
  const issues: GraphValidationIssue[] = []

  for (const [index, operation] of transaction.ops.entries()) {
    const opPath = `ops[${index}]`
    if (operation.op === "retract") {
      if (!edgeById.has(operation.edgeId)) {
        issues.push(
          createTransactionValidationIssue(
            [opPath, "edgeId"],
            "sync.tx.op.retract.missing",
            `Field "${opPath}.edgeId" must reference an existing edge.`,
          ),
        )
        continue
      }

      retracted.add(operation.edgeId)
      continue
    }

    const existing = edgeById.get(operation.edge.id)
    if (existing) {
      if (
        options.allowExistingAssertEdgeIds &&
        existing.s === operation.edge.s &&
        existing.p === operation.edge.p &&
        existing.o === operation.edge.o
      ) {
        continue
      }
      issues.push(
        createTransactionValidationIssue(
          [opPath, "edge", "id"],
          "sync.tx.op.assert.edge.id.conflict",
          `Field "${opPath}.edge.id" must not collide with an existing edge id.`,
        ),
      )
      continue
    }

    const edge = { ...operation.edge }
    edges.push(edge)
    edgeById.set(edge.id, edge)
  }

  if (issues.length > 0) {
    return {
      ok: false,
      result: invalidTransactionResult(transaction, issues),
    }
  }

  return {
    ok: true,
    value: {
      edges,
      retracted: [...retracted],
    },
  }
}

function applyGraphWriteTransaction(store: Store, transaction: GraphWriteTransaction): void {
  store.batch(() => {
    for (const operation of transaction.ops) {
      if (operation.op === "retract") {
        store.retract(operation.edgeId)
        continue
      }

      store.assertEdge(operation.edge)
    }
  })
}

function validateStoreSnapshotShape(snapshot: unknown): readonly GraphValidationIssue[] {
  const issues: GraphValidationIssue[] = []
  if (!isObjectRecord(snapshot)) {
    issues.push(
      createPayloadValidationIssue(
        ["snapshot"],
        "sync.snapshot",
        'Field "snapshot" must be a store snapshot object.',
      ),
    )
    return issues
  }

  const edgeIds = new Set<string>()

  if (!Array.isArray(snapshot.edges)) {
    issues.push(
      createPayloadValidationIssue(
        ["snapshot", "edges"],
        "sync.snapshot.edges",
        'Field "snapshot.edges" must be an array.',
      ),
    )
  } else {
    snapshot.edges.forEach((edge, index) => {
      const edgePath = `edges[${index}]`
      if (!isObjectRecord(edge)) {
        issues.push(
          createPayloadValidationIssue(
            ["snapshot", edgePath],
            "sync.snapshot.edge",
            `Field "snapshot.${edgePath}" must be an edge object.`,
          ),
        )
        return
      }

      for (const key of ["id", "s", "p", "o"] as const) {
        const value = edge[key]
        if (typeof value !== "string") {
          issues.push(
            createPayloadValidationIssue(
              ["snapshot", edgePath, key],
              `sync.snapshot.edge.${key}`,
              `Field "snapshot.${edgePath}.${key}" must be a string.`,
            ),
          )
        }
      }

      if (typeof edge.id !== "string") return
      if (edgeIds.has(edge.id)) {
        issues.push(
          createPayloadValidationIssue(
            ["snapshot", edgePath, "id"],
            "sync.snapshot.edge.id.duplicate",
            `Field "snapshot.${edgePath}.id" must be unique within the snapshot.`,
          ),
        )
        return
      }
      edgeIds.add(edge.id)
    })
  }

  if (!Array.isArray(snapshot.retracted)) {
    issues.push(
      createPayloadValidationIssue(
        ["snapshot", "retracted"],
        "sync.snapshot.retracted",
        'Field "snapshot.retracted" must be an array.',
      ),
    )
  } else {
    snapshot.retracted.forEach((edgeId, index) => {
      const retractedPath = `retracted[${index}]`
      if (typeof edgeId !== "string") {
        issues.push(
          createPayloadValidationIssue(
            ["snapshot", retractedPath],
            "sync.snapshot.retracted.id",
            `Field "snapshot.${retractedPath}" must be a string edge id.`,
          ),
        )
        return
      }

      if (!edgeIds.has(edgeId)) {
        issues.push(
          createPayloadValidationIssue(
            ["snapshot", retractedPath],
            "sync.snapshot.retracted.missing",
            `Field "snapshot.${retractedPath}" must reference an edge id present in "snapshot.edges".`,
          ),
        )
      }
    })
  }

  return issues
}

function validateTotalSyncPayloadShape(payload: TotalSyncPayload): readonly GraphValidationIssue[] {
  const issues: GraphValidationIssue[] = []
  const candidate = payload as Partial<TotalSyncPayload> & Record<string, unknown>

  if (candidate.mode !== "total") {
    issues.push(
      createPayloadValidationIssue(
        ["mode"],
        "sync.mode",
        'Field "mode" must be "total".',
      ),
    )
  }

  if (!isObjectRecord(candidate.scope) || candidate.scope.kind !== "graph") {
    issues.push(
      createPayloadValidationIssue(
        ["scope", "kind"],
        "sync.scope",
        'Field "scope.kind" must be "graph".',
      ),
    )
  }

  if (typeof candidate.cursor !== "string") {
    issues.push(
      createPayloadValidationIssue(
        ["cursor"],
        "sync.cursor",
        'Field "cursor" must be a string.',
      ),
    )
  }

  if (candidate.completeness !== "complete") {
    issues.push(
      createPayloadValidationIssue(
        ["completeness"],
        "sync.completeness",
        'Field "completeness" must be "complete" for total sync payloads.',
      ),
    )
  }

  if (candidate.freshness !== "current" && candidate.freshness !== "stale") {
    issues.push(
      createPayloadValidationIssue(
        ["freshness"],
        "sync.freshness",
        'Field "freshness" must be "current" or "stale".',
      ),
    )
  }

  issues.push(...validateStoreSnapshotShape(candidate.snapshot))
  return issues
}

function isIncrementalSyncFallbackReason(value: unknown): value is IncrementalSyncFallbackReason {
  return value === "unknown-cursor" || value === "gap" || value === "reset"
}

function prefixIncrementalSyncTransactionIssues(
  index: number,
  issues: readonly GraphValidationIssue[],
): GraphValidationIssue[] {
  return issues.map((issue) =>
    createIncrementalSyncValidationIssue(
      [`transactions[${index}]`, ...issue.path],
      issue.code,
      issue.message,
    ),
  )
}

function validateIncrementalSyncPayloadShape(
  payload: IncrementalSyncPayload,
  options: {
    allowFallback: boolean
  } = {
    allowFallback: false,
  },
): {
  issues: GraphValidationIssue[]
  value: IncrementalSyncResult
} {
  const issues: GraphValidationIssue[] = []
  const candidate = payload as Partial<IncrementalSyncResult> & Record<string, unknown>
  const transactions: AuthoritativeGraphWriteResult[] = []
  const txIds = new Set<string>()
  const cursors = new Set<string>()

  if (candidate.mode !== "incremental") {
    issues.push(
      createIncrementalSyncValidationIssue(
        ["mode"],
        "sync.incremental.mode",
        'Field "mode" must be "incremental".',
      ),
    )
  }

  if (!isObjectRecord(candidate.scope) || candidate.scope.kind !== "graph") {
    issues.push(
      createIncrementalSyncValidationIssue(
        ["scope", "kind"],
        "sync.incremental.scope",
        'Field "scope.kind" must be "graph".',
      ),
    )
  }

  if (typeof candidate.after !== "string") {
    issues.push(
      createIncrementalSyncValidationIssue(
        ["after"],
        "sync.incremental.after",
        'Field "after" must be a string.',
      ),
    )
  } else if (candidate.after.length === 0) {
    issues.push(
      createIncrementalSyncValidationIssue(
        ["after"],
        "sync.incremental.after.empty",
        'Field "after" must not be empty.',
      ),
    )
  }

  if (typeof candidate.cursor !== "string") {
    issues.push(
      createIncrementalSyncValidationIssue(
        ["cursor"],
        "sync.incremental.cursor",
        'Field "cursor" must be a string.',
      ),
    )
  } else if (candidate.cursor.length === 0) {
    issues.push(
      createIncrementalSyncValidationIssue(
        ["cursor"],
        "sync.incremental.cursor.empty",
        'Field "cursor" must not be empty.',
      ),
    )
  }

  if (candidate.completeness !== "complete") {
    issues.push(
      createIncrementalSyncValidationIssue(
        ["completeness"],
        "sync.incremental.completeness",
        'Field "completeness" must be "complete" for graph-scoped incremental sync.',
      ),
    )
  }

  if (candidate.freshness !== "current" && candidate.freshness !== "stale") {
    issues.push(
      createIncrementalSyncValidationIssue(
        ["freshness"],
        "sync.incremental.freshness",
        'Field "freshness" must be "current" or "stale".',
      ),
    )
  }

  if (!Array.isArray(candidate.transactions)) {
    issues.push(
      createIncrementalSyncValidationIssue(
        ["transactions"],
        "sync.incremental.transactions",
        'Field "transactions" must be an array.',
      ),
    )
  } else {
    candidate.transactions.forEach((transaction, index) => {
      if (isObjectRecord(transaction) && transaction.replayed === true) {
        issues.push(
          createIncrementalSyncValidationIssue(
            [`transactions[${index}]`, "replayed"],
            "sync.incremental.transaction.replayed",
            `Field "transactions[${index}].replayed" must be false for incremental pull delivery.`,
          ),
        )
      }

      const prepared = prepareAuthoritativeGraphWriteResult(
        cloneAuthoritativeGraphWriteResult(
          isObjectRecord(transaction)
            ? (transaction as AuthoritativeGraphWriteResult)
            : {
                txId: "",
                cursor: "",
                replayed: false,
                transaction: {
                  id: "",
                  ops: [],
                },
              },
        ),
      )
      if (!prepared.ok) {
        issues.push(...prefixIncrementalSyncTransactionIssues(index, prepared.result.issues))
        return
      }

      const value = cloneAuthoritativeGraphWriteResult(prepared.value)

      if (txIds.has(value.txId)) {
        issues.push(
          createIncrementalSyncValidationIssue(
            [`transactions[${index}]`, "txId"],
            "sync.incremental.transaction.txId.duplicate",
            `Field "transactions[${index}].txId" must be unique within the incremental result.`,
          ),
        )
      } else {
        txIds.add(value.txId)
      }

      if (cursors.has(value.cursor)) {
        issues.push(
          createIncrementalSyncValidationIssue(
            [`transactions[${index}]`, "cursor"],
            "sync.incremental.transaction.cursor.duplicate",
            `Field "transactions[${index}].cursor" must be unique within the incremental result.`,
          ),
        )
      } else {
        cursors.add(value.cursor)
      }

      if (typeof candidate.after === "string" && candidate.after.length > 0 && value.cursor === candidate.after) {
        issues.push(
          createIncrementalSyncValidationIssue(
            [`transactions[${index}]`, "cursor"],
            "sync.incremental.transaction.cursor.after",
            `Field "transactions[${index}].cursor" must be strictly after "after".`,
          ),
        )
      }

      transactions.push(value)
    })
  }

  const after = typeof candidate.after === "string" ? candidate.after : ""
  const cursor = typeof candidate.cursor === "string" ? candidate.cursor : ""
  const freshness = candidate.freshness === "stale" ? "stale" : "current"
  const hasFallback = "fallback" in candidate
  const fallbackReason = isIncrementalSyncFallbackReason(candidate.fallback)
    ? candidate.fallback
    : "unknown-cursor"

  if (!options.allowFallback && hasFallback) {
    issues.push(
      createIncrementalSyncValidationIssue(
        ["fallback"],
        "sync.incremental.fallback.unexpected",
        'Field "fallback" is only valid on incremental pull results that require total-sync recovery.',
      ),
    )
  }

  if (options.allowFallback && hasFallback) {
    if (!isIncrementalSyncFallbackReason(candidate.fallback)) {
      issues.push(
        createIncrementalSyncValidationIssue(
          ["fallback"],
          "sync.incremental.fallback",
          'Field "fallback" must be "unknown-cursor", "gap", or "reset".',
        ),
      )
    }

    if (Array.isArray(candidate.transactions) && candidate.transactions.length > 0) {
      issues.push(
        createIncrementalSyncValidationIssue(
          ["transactions"],
          "sync.incremental.fallback.transactions",
          'Field "transactions" must be empty when "fallback" is present.',
        ),
      )
    }
  }

  if (!hasFallback) {
    if (transactions.length === 0) {
      if (typeof candidate.after === "string" && typeof candidate.cursor === "string" && candidate.cursor !== candidate.after) {
        issues.push(
          createIncrementalSyncValidationIssue(
            ["cursor"],
            "sync.incremental.cursor.head",
            'Field "cursor" must match "after" when "transactions" is empty.',
          ),
        )
      }
    } else {
      const tail = transactions[transactions.length - 1]
      if (typeof candidate.cursor === "string" && tail && tail.cursor !== candidate.cursor) {
        issues.push(
          createIncrementalSyncValidationIssue(
            ["cursor"],
            "sync.incremental.cursor.tail",
            'Field "cursor" must match the last delivered transaction cursor.',
          ),
        )
      }
    }
  }

  return {
    issues,
    value:
      options.allowFallback && hasFallback
        ? createIncrementalSyncFallback(fallbackReason, {
            after,
            cursor,
            freshness,
          })
        : createIncrementalSyncPayload(transactions, {
            after,
            cursor,
            freshness,
          }),
  }
}

export function validateIncrementalSyncPayload(
  payload: IncrementalSyncPayload,
): GraphValidationResult<IncrementalSyncPayload> {
  const prepared = validateIncrementalSyncPayloadShape(payload)
  if (prepared.issues.length > 0) {
    return exposeIncrementalSyncValidationResult(
      invalidIncrementalSyncResult(prepared.value, prepared.issues),
    ) as GraphValidationResult<IncrementalSyncPayload>
  }

  return exposeIncrementalSyncValidationResult({
    ok: true,
    phase: "authoritative",
    event: "reconcile",
    value: prepared.value,
    changedPredicateKeys: [],
  }) as GraphValidationResult<IncrementalSyncPayload>
}

export function validateIncrementalSyncResult(
  result: IncrementalSyncResult,
): GraphValidationResult<IncrementalSyncResult> {
  const prepared = validateIncrementalSyncPayloadShape(result as IncrementalSyncPayload, {
    allowFallback: true,
  })
  if (prepared.issues.length > 0) {
    return exposeIncrementalSyncValidationResult(
      invalidIncrementalSyncResult(prepared.value, prepared.issues),
    )
  }

  return exposeIncrementalSyncValidationResult({
    ok: true,
    phase: "authoritative",
    event: "reconcile",
    value: prepared.value,
    changedPredicateKeys: [],
  })
}

function validateIncrementalSyncCursorSequence(
  result: IncrementalSyncPayload,
): readonly GraphValidationIssue[] {
  const issues: GraphValidationIssue[] = []
  const after = parseAuthoritativeGraphCursor(result.after)

  if (!after) {
    issues.push(
      createIncrementalSyncValidationIssue(
        ["after"],
        "sync.incremental.after.cursor",
        'Field "after" must be a cursor with a trailing numeric sequence before incremental apply.',
      ),
    )
    return issues
  }

  let previous = after
  for (const [index, transaction] of result.transactions.entries()) {
    const current = parseAuthoritativeGraphCursor(transaction.cursor)
    if (!current) {
      issues.push(
        createIncrementalSyncValidationIssue(
          [`transactions[${index}]`, "cursor"],
          "sync.incremental.transaction.cursor.sequence",
          `Field "transactions[${index}].cursor" must be a cursor with a trailing numeric sequence.`,
        ),
      )
      continue
    }

    if (current.prefix !== previous.prefix || current.sequence !== previous.sequence + 1) {
      issues.push(
        createIncrementalSyncValidationIssue(
          [`transactions[${index}]`, "cursor"],
          "sync.incremental.transaction.cursor.sequence",
          `Field "transactions[${index}].cursor" must advance contiguously from the previous cursor.`,
        ),
      )
      continue
    }

    previous = current
  }

  if (result.transactions.length === 0) {
    const cursor = parseAuthoritativeGraphCursor(result.cursor)
    if (!cursor) {
      issues.push(
        createIncrementalSyncValidationIssue(
          ["cursor"],
          "sync.incremental.cursor.sequence",
          'Field "cursor" must be a cursor with a trailing numeric sequence.',
        ),
      )
    } else if (cursor.prefix !== after.prefix || cursor.sequence !== after.sequence) {
      issues.push(
        createIncrementalSyncValidationIssue(
          ["cursor"],
          "sync.incremental.cursor.sequence",
          'Field "cursor" must match "after" when no transactions are delivered.',
        ),
      )
    }
  }

  return issues
}

function prepareIncrementalSyncResultForApply(
  store: Store,
  result: IncrementalSyncResult,
  currentCursor: string | undefined,
  options: {
    validateWriteResult?: AuthoritativeGraphWriteResultValidator
  } = {},
):
  | {
      ok: true
      value: IncrementalSyncPayload
      snapshot?: StoreSnapshot
    }
  | {
      ok: false
      result:
        | Extract<GraphValidationResult<IncrementalSyncResult>, { ok: false }>
        | Extract<GraphValidationResult<AuthoritativeGraphWriteResult>, { ok: false }>
    } {
  const validation = validateIncrementalSyncResult(result)
  if (!validation.ok) {
    return {
      ok: false,
      result: validation,
    }
  }

  const materialized = validation.value
  if ("fallback" in materialized) {
    return {
      ok: false,
      result: invalidIncrementalSyncResult(materialized, [
        createIncrementalSyncValidationIssue(
          ["fallback"],
          "sync.incremental.recovery",
          `Incremental sync requires total snapshot recovery because the authority reported "${materialized.fallback}".`,
        ),
      ]),
    }
  }

  if (typeof currentCursor !== "string" || currentCursor.length === 0 || materialized.after !== currentCursor) {
    return {
      ok: false,
      result: invalidIncrementalSyncResult(materialized, [
        createIncrementalSyncValidationIssue(
          ["after"],
          "sync.incremental.after.current",
          'Field "after" must match the current sync cursor before incremental apply.',
        ),
      ]),
    }
  }

  const cursorIssues = validateIncrementalSyncCursorSequence(materialized)
  if (cursorIssues.length > 0) {
    return {
      ok: false,
      result: invalidIncrementalSyncResult(materialized, cursorIssues),
    }
  }

  if (materialized.transactions.length === 0) {
    return {
      ok: true,
      value: materialized,
    }
  }

  const validationStore = createStore()
  validationStore.replace(store.snapshot())

  for (const transaction of materialized.transactions) {
    const candidateSnapshot = materializeGraphWriteTransactionSnapshot(
      validationStore,
      transaction.transaction,
      {
        allowExistingAssertEdgeIds: true,
      },
    )
    if (!candidateSnapshot.ok) {
      return {
        ok: false,
        result: invalidGraphWriteResult(
          transaction,
          prefixGraphWriteResultIssues(candidateSnapshot.result.issues),
        ),
      }
    }

    try {
      options.validateWriteResult?.(transaction, validationStore)
    } catch (error) {
      if (error instanceof GraphValidationError) {
        return {
          ok: false,
          result: error.result as Extract<
            GraphValidationResult<AuthoritativeGraphWriteResult>,
            { ok: false }
          >,
        }
      }
      throw error
    }

    validationStore.replace(candidateSnapshot.value)
  }

  return {
    ok: true,
    value: materialized,
    snapshot: validationStore.snapshot(),
  }
}

export type SyncState = {
  readonly mode: "total"
  readonly scope: SyncScope
  readonly status: SyncStatus
  readonly completeness: SyncCompleteness
  readonly freshness: SyncFreshness
  readonly pendingCount: number
  readonly recentActivities: readonly SyncActivity[]
  readonly cursor?: string
  readonly lastSyncedAt?: Date
  readonly error?: unknown
}

export type SyncStateListener = (state: SyncState) => void
export type SyncSource = (state: SyncState) => SyncPayload | Promise<SyncPayload>
export type TotalSyncSource = SyncSource
export type TotalSyncPayloadValidator = (payload: TotalSyncPayload) => void
export type AuthoritativeGraphWriteResultValidator = (
  result: AuthoritativeGraphWriteResult,
  store?: Store,
) => void

export interface TotalSyncController {
  apply(payload: SyncPayload): SyncPayload
  applyWriteResult(result: AuthoritativeGraphWriteResult): AuthoritativeGraphWriteResult
  sync(): Promise<SyncPayload>
  getState(): SyncState
  subscribe(listener: SyncStateListener): () => void
}

export interface SyncedTypeSyncController extends TotalSyncController {
  flush(): Promise<readonly AuthoritativeGraphWriteResult[]>
  getPendingTransactions(): readonly GraphWriteTransaction[]
}

export type SyncedTypeClient<T extends Record<string, AnyTypeOutput>> = {
  store: Store
  graph: NamespaceClient<T>
  sync: SyncedTypeSyncController
}

export interface TotalSyncSession {
  apply(payload: SyncPayload): SyncPayload
  applyWriteResult(result: AuthoritativeGraphWriteResult): AuthoritativeGraphWriteResult
  pull(source: SyncSource): Promise<SyncPayload>
  getState(): SyncState
  subscribe(listener: SyncStateListener): () => void
}

export interface AuthoritativeGraphWriteSession {
  apply(transaction: GraphWriteTransaction): AuthoritativeGraphWriteResult
  getCursor(): string | undefined
  getBaseCursor(): string
  getChangesAfter(cursor?: string): AuthoritativeGraphChangesAfterResult
  getIncrementalSyncResult(
    after?: string,
    options?: {
      freshness?: SyncFreshness
    },
  ): IncrementalSyncResult
  getHistory(): AuthoritativeGraphWriteHistory
}

export function validateAuthoritativeTotalSyncPayload<
  const T extends Record<string, AnyTypeOutput>,
>(
  payload: TotalSyncPayload,
  namespace: T,
  options: {
    preserveSnapshot?: StoreSnapshot
  } = {},
): GraphValidationResult<TotalSyncPayload> {
  const prepared = prepareTotalSyncPayload(payload, options)
  if (!prepared.ok) return prepared.result

  const materialized = prepared.value
  const validationStore = createStore()
  validationStore.replace(materialized.snapshot)
  return exposeTotalSyncValidationResult(
    withValidationValue(validateGraphStore(validationStore, namespace), materialized),
  )
}

export function validateAuthoritativeGraphWriteTransaction<
  const T extends Record<string, AnyTypeOutput>,
>(
  transaction: GraphWriteTransaction,
  store: Store,
  namespace: T,
): GraphValidationResult<GraphWriteTransaction> {
  const prepared = prepareGraphWriteTransaction(transaction)
  if (!prepared.ok) return prepared.result

  const materialized = materializeGraphWriteTransactionSnapshot(store, prepared.value)
  if (!materialized.ok) return exposeGraphWriteValidationResult(materialized.result)

  const validationStore = createStore()
  validationStore.replace(materialized.value)
  return exposeGraphWriteValidationResult(
    withValidationValue(validateGraphStore(validationStore, namespace), prepared.value),
  )
}

export function validateAuthoritativeGraphWriteResult<
  const T extends Record<string, AnyTypeOutput>,
>(
  result: AuthoritativeGraphWriteResult,
  store: Store,
  namespace: T,
): GraphValidationResult<AuthoritativeGraphWriteResult> {
  const prepared = prepareAuthoritativeGraphWriteResult(result)
  if (!prepared.ok) return prepared.result

  const materialized = materializeGraphWriteTransactionSnapshot(store, prepared.value.transaction, {
    allowExistingAssertEdgeIds: true,
  })
  if (!materialized.ok) {
    return exposeGraphWriteResultValidationResult(
      invalidGraphWriteResult(prepared.value, prefixGraphWriteResultIssues(materialized.result.issues)),
    )
  }

  const validationStore = createStore()
  validationStore.replace(materialized.value)
  return exposeGraphWriteResultValidationResult(
    withValidationValue(validateGraphStore(validationStore, namespace), prepared.value),
  )
}

export function createAuthoritativeTotalSyncValidator<
  const T extends Record<string, AnyTypeOutput>,
>(
  namespace: T,
  options: {
    preserveSnapshot?: StoreSnapshot
  } = {},
): TotalSyncPayloadValidator {
  return (payload) => {
    const result = validateAuthoritativeTotalSyncPayload(payload, namespace, options)
    if (!result.ok) throw new GraphValidationError(result)
  }
}

export function createAuthoritativeGraphWriteResultValidator<
  const T extends Record<string, AnyTypeOutput>,
>(
  store: Store,
  namespace: T,
): AuthoritativeGraphWriteResultValidator {
  return (result, validationStore = store) => {
    const validation = validateAuthoritativeGraphWriteResult(result, validationStore, namespace)
    if (!validation.ok) throw new GraphValidationError(validation)
  }
}

export function createIncrementalSyncPayload(
  transactions: readonly AuthoritativeGraphWriteResult[],
  options: {
    after: string
    cursor?: string
    freshness?: SyncFreshness
  },
): IncrementalSyncPayload {
  return {
    mode: "incremental",
    scope: graphSyncScope,
    after: options.after,
    transactions: transactions.map((transaction) => cloneAuthoritativeGraphWriteResult(transaction)),
    cursor: options.cursor ?? transactions[transactions.length - 1]?.cursor ?? options.after,
    completeness: "complete",
    freshness: options.freshness ?? "current",
  }
}

export function createIncrementalSyncFallback(
  fallback: IncrementalSyncFallbackReason,
  options: {
    after: string
    cursor: string
    freshness?: SyncFreshness
  },
): IncrementalSyncFallback {
  return {
    mode: "incremental",
    scope: graphSyncScope,
    after: options.after,
    transactions: [],
    cursor: options.cursor,
    completeness: "complete",
    freshness: options.freshness ?? "current",
    fallback,
  }
}

function parseAuthoritativeGraphCursor(
  cursor: string,
):
  | {
      prefix: string
      sequence: number
    }
  | null {
  const match = /^(.*?)(\d+)$/.exec(cursor)
  if (!match) return null

  return {
    prefix: match[1] ?? "",
    sequence: Number.parseInt(match[2] ?? "", 10),
  }
}

function classifyIncrementalSyncFallbackReason(
  cursor: string,
  options: {
    cursorPrefix: string
    baseSequence: number
  },
): IncrementalSyncFallbackReason {
  const parsed = parseAuthoritativeGraphCursor(cursor)
  if (!parsed) return "unknown-cursor"
  if (parsed.prefix !== options.cursorPrefix) return "reset"
  if (parsed.sequence < options.baseSequence) return "gap"
  return "unknown-cursor"
}

function buildAuthoritativeGraphWriteReplayResult(
  result: AuthoritativeGraphWriteResult,
): AuthoritativeGraphWriteResult {
  return cloneAuthoritativeGraphWriteResult(result, { replayed: true })
}

function formatAuthoritativeGraphCursor(cursorPrefix: string, sequence: number): string {
  return `${cursorPrefix}${sequence}`
}

function cloneAuthoritativeGraphWriteHistory(
  history: AuthoritativeGraphWriteHistory,
): AuthoritativeGraphWriteHistory {
  return {
    cursorPrefix: history.cursorPrefix,
    baseSequence: history.baseSequence,
    results: history.results.map((result) => cloneAuthoritativeGraphWriteResult(result)),
  }
}

type AuthoritativeGraphWriteRecord =
  | {
      ok: true
      transaction: GraphWriteTransaction
      result: AuthoritativeGraphWriteResult
    }
  | {
      ok: false
      transaction: GraphWriteTransaction
      result: Extract<GraphValidationResult<GraphWriteTransaction>, { ok: false }>
    }

export function createAuthoritativeGraphWriteSession<
  const T extends Record<string, AnyTypeOutput>,
>(
  store: Store,
  namespace: T,
  options: {
    cursorPrefix?: string
    initialSequence?: number
    history?: readonly AuthoritativeGraphWriteResult[]
  } = {},
): AuthoritativeGraphWriteSession {
  const cursorPrefix = options.cursorPrefix ?? "tx:"
  const baseSequence = options.initialSequence ?? 0
  if (!Number.isInteger(baseSequence) || baseSequence < 0) {
    throw new Error("Authoritative graph write sessions require a non-negative integer initial sequence.")
  }
  const txRecords = new Map<string, AuthoritativeGraphWriteRecord>()
  const acceptedResults: AuthoritativeGraphWriteResult[] = []
  const cursorToIndex = new Map<string, number>()
  let sequence = baseSequence

  function baseCursor(): string {
    return formatAuthoritativeGraphCursor(cursorPrefix, baseSequence)
  }

  function currentCursor(): string | undefined {
    return sequence > 0 ? formatAuthoritativeGraphCursor(cursorPrefix, sequence) : undefined
  }

  function currentHeadCursor(): string {
    return currentCursor() ?? baseCursor()
  }

  function cloneAcceptedResults(startIndex = 0): AuthoritativeGraphWriteResult[] {
    return acceptedResults
      .slice(startIndex)
      .map((result) => cloneAuthoritativeGraphWriteResult(result))
  }

  function getChangesAfter(cursor?: string): AuthoritativeGraphChangesAfterResult {
    if (cursor === undefined || cursor === baseCursor()) {
      return {
        kind: "changes",
        cursor: currentHeadCursor(),
        changes: cloneAcceptedResults(),
      }
    }

    if (cursor === currentHeadCursor()) {
      return {
        kind: "changes",
        cursor,
        changes: [],
      }
    }

    const index = cursorToIndex.get(cursor)
    if (index === undefined) {
      return {
        kind: "reset",
        cursor: currentHeadCursor(),
        changes: [],
      }
    }

    return {
      kind: "changes",
      cursor: currentHeadCursor(),
      changes: cloneAcceptedResults(index + 1),
    }
  }

  function getIncrementalSyncResult(
    after = baseCursor(),
    options: {
      freshness?: SyncFreshness
    } = {},
  ): IncrementalSyncResult {
    const changes = getChangesAfter(after)
    if (changes.kind === "changes") {
      return createIncrementalSyncPayload(changes.changes, {
        after,
        cursor: changes.cursor,
        freshness: options.freshness,
      })
    }

    return createIncrementalSyncFallback(
      classifyIncrementalSyncFallbackReason(after, {
        cursorPrefix,
        baseSequence,
      }),
      {
        after,
        cursor: changes.cursor,
        freshness: options.freshness,
      },
    )
  }

  const history = options.history ?? []
  history.forEach((result, index) => {
    const prepared = prepareAuthoritativeGraphWriteResult(result)
    if (!prepared.ok) throw new GraphValidationError(prepared.result)

    const normalized = cloneAuthoritativeGraphWriteResult(prepared.value, { replayed: false })
    const expectedCursor = formatAuthoritativeGraphCursor(cursorPrefix, baseSequence + index + 1)
    if (normalized.cursor !== expectedCursor) {
      throw new Error(
        `Invalid authoritative graph write history at index ${index}: expected cursor "${expectedCursor}".`,
      )
    }
    if (txRecords.has(normalized.txId)) {
      throw new Error(
        `Invalid authoritative graph write history at index ${index}: duplicate transaction id "${normalized.txId}".`,
      )
    }

    txRecords.set(normalized.txId, {
      ok: true,
      transaction: normalized.transaction,
      result: normalized,
    })
    acceptedResults.push(normalized)
    cursorToIndex.set(normalized.cursor, acceptedResults.length - 1)
  })
  sequence = baseSequence + acceptedResults.length

  function getHistory(): AuthoritativeGraphWriteHistory {
    return cloneAuthoritativeGraphWriteHistory({
      cursorPrefix,
      baseSequence,
      results: acceptedResults,
    })
  }

  function apply(transaction: GraphWriteTransaction): AuthoritativeGraphWriteResult {
    const prepared = prepareGraphWriteTransaction(transaction)
    if (!prepared.ok) throw new GraphValidationError(prepared.result)

    const existing = txRecords.get(prepared.value.id)
    if (existing) {
      if (!sameGraphWriteTransaction(existing.transaction, prepared.value)) {
        throw new GraphValidationError(
          invalidTransactionResult(prepared.value, [
            createTransactionValidationIssue(
              ["id"],
              "sync.tx.id.conflict",
              'Field "id" must not be reused for a different transaction.',
            ),
          ]),
        )
      }

      if (existing.ok) return buildAuthoritativeGraphWriteReplayResult(existing.result)
      throw new GraphValidationError(existing.result)
    }

    const materialized = materializeGraphWriteTransactionSnapshot(store, prepared.value)
    if (!materialized.ok) {
      txRecords.set(prepared.value.id, {
        ok: false,
        transaction: prepared.value,
        result: materialized.result,
      })
      throw new GraphValidationError(materialized.result)
    }

    const validation = validateAuthoritativeGraphWriteTransaction(prepared.value, store, namespace)
    if (!validation.ok) {
      txRecords.set(prepared.value.id, {
        ok: false,
        transaction: prepared.value,
        result: validation,
      })
      throw new GraphValidationError(validation)
    }

    store.replace(materialized.value)
    sequence += 1
    const storedResult: AuthoritativeGraphWriteResult = {
      txId: prepared.value.id,
      cursor: formatAuthoritativeGraphCursor(cursorPrefix, sequence),
      replayed: false,
      transaction: prepared.value,
    }
    txRecords.set(prepared.value.id, {
      ok: true,
      transaction: prepared.value,
      result: storedResult,
    })
    acceptedResults.push(storedResult)
    cursorToIndex.set(storedResult.cursor, acceptedResults.length - 1)
    return cloneAuthoritativeGraphWriteResult(storedResult)
  }

  return {
    apply,
    getBaseCursor: baseCursor,
    getChangesAfter,
    getIncrementalSyncResult,
    getCursor: currentCursor,
    getHistory,
  }
}

function cloneState(state: SyncState): SyncState {
  return {
    ...state,
    scope: graphSyncScope,
    pendingCount: state.pendingCount,
    recentActivities: state.recentActivities.map((activity) => cloneSyncActivity(activity)),
    lastSyncedAt: state.lastSyncedAt ? new Date(state.lastSyncedAt.getTime()) : undefined,
  }
}

const maxSyncActivities = 8

function cloneSyncActivity(activity: SyncActivity): SyncActivity {
  if (activity.kind === "incremental") {
    return {
      ...activity,
      txIds: [...activity.txIds],
      at: new Date(activity.at.getTime()),
    }
  }

  return {
    ...activity,
    at: new Date(activity.at.getTime()),
  }
}

function sameSyncActivity(left: SyncActivity, right: SyncActivity): boolean {
  if (left.kind !== right.kind) return false
  if (left.cursor !== right.cursor) return false
  if (left.freshness !== right.freshness) return false
  if (left.at.getTime() !== right.at.getTime()) return false

  if (left.kind === "total" && right.kind === "total") return true
  if (left.kind === "write" && right.kind === "write") {
    return left.txId === right.txId && left.replayed === right.replayed
  }
  if (left.kind === "fallback" && right.kind === "fallback") {
    return left.after === right.after && left.reason === right.reason
  }
  if (left.kind === "incremental" && right.kind === "incremental") {
    if (
      left.after !== right.after ||
      left.transactionCount !== right.transactionCount ||
      left.txIds.length !== right.txIds.length
    ) {
      return false
    }

    for (let index = 0; index < left.txIds.length; index += 1) {
      if (left.txIds[index] !== right.txIds[index]) return false
    }
    return true
  }

  return false
}

function appendSyncActivity(
  activities: readonly SyncActivity[],
  activity: SyncActivity,
): SyncActivity[] {
  const next = [...activities, cloneSyncActivity(activity)]
  return next.slice(-maxSyncActivities)
}

export function createTotalSyncSession(
  store: Store,
  options: {
    validate?: TotalSyncPayloadValidator
    validateWriteResult?: AuthoritativeGraphWriteResultValidator
    preserveSnapshot?: StoreSnapshot
  } = {},
): TotalSyncSession {
  let state: SyncState = {
    mode: "total",
    scope: graphSyncScope,
    status: "idle",
    completeness: "incomplete",
    freshness: "stale",
    pendingCount: 0,
    recentActivities: [],
  }
  const listeners = new Set<SyncStateListener>()

  function recordActivity(activity: SyncActivity): void {
    state = {
      ...state,
      recentActivities: appendSyncActivity(state.recentActivities, activity),
    }
  }

  function publish(next: SyncState): void {
    state = {
      ...next,
      recentActivities: state.recentActivities,
    }
    const snapshot = cloneState(state)
    for (const listener of new Set(listeners)) listener(snapshot)
  }

  function applyTotalPayload(payload: TotalSyncPayload): TotalSyncPayload {
    const prepared = prepareTotalSyncPayload(payload, options)
    if (!prepared.ok) throw new GraphValidationError(prepared.result)

    const materialized = prepared.value
    options.validate?.(materialized)
    store.replace(materialized.snapshot)
    const syncedAt = new Date()
    recordActivity({
      kind: "total",
      cursor: materialized.cursor,
      freshness: materialized.freshness,
      at: syncedAt,
    })
    publish({
      mode: materialized.mode,
      scope: materialized.scope,
      status: "ready",
      completeness: materialized.completeness,
      freshness: materialized.freshness,
      pendingCount: 0,
      recentActivities: state.recentActivities,
      cursor: materialized.cursor,
      lastSyncedAt: syncedAt,
    })
    return materialized
  }

  function applyIncrementalResult(result: IncrementalSyncResult): IncrementalSyncResult {
    if ("fallback" in result) {
      const validation = validateIncrementalSyncResult(result)
      if (validation.ok && "fallback" in validation.value) {
        recordActivity({
          kind: "fallback",
          after: validation.value.after,
          cursor: validation.value.cursor,
          freshness: validation.value.freshness,
          reason: validation.value.fallback,
          at: new Date(),
        })
      }
    }

    const prepared = prepareIncrementalSyncResultForApply(store, result, state.cursor, {
      validateWriteResult: options.validateWriteResult,
    })
    if (!prepared.ok) {
      throw new GraphValidationError<IncrementalSyncResult | AuthoritativeGraphWriteResult>(
        prepared.result as Extract<
          GraphValidationResult<IncrementalSyncResult | AuthoritativeGraphWriteResult>,
          { ok: false }
        >,
      )
    }

    if (prepared.snapshot) {
      store.replace(prepared.snapshot)
    }

    const syncedAt = new Date()
    recordActivity({
      kind: "incremental",
      after: prepared.value.after,
      cursor: prepared.value.cursor,
      freshness: prepared.value.freshness,
      transactionCount: prepared.value.transactions.length,
      txIds: prepared.value.transactions.map((transaction) => transaction.txId),
      at: syncedAt,
    })
    publish({
      ...state,
      status: "ready",
      completeness: prepared.value.completeness,
      freshness: prepared.value.freshness,
      recentActivities: state.recentActivities,
      cursor: prepared.value.cursor,
      lastSyncedAt: syncedAt,
      error: undefined,
    })
    return prepared.value
  }

  function apply(payload: SyncPayload): SyncPayload {
    return payload.mode === "incremental" ? applyIncrementalResult(payload) : applyTotalPayload(payload)
  }

  function applyWriteResult(result: AuthoritativeGraphWriteResult): AuthoritativeGraphWriteResult {
    const prepared = prepareAuthoritativeGraphWriteResult(result)
    if (!prepared.ok) throw new GraphValidationError(prepared.result)

    const materialized = prepared.value
    const candidateSnapshot = materializeGraphWriteTransactionSnapshot(store, materialized.transaction, {
      allowExistingAssertEdgeIds: true,
    })
    if (!candidateSnapshot.ok) {
      throw new GraphValidationError(
        invalidGraphWriteResult(materialized, prefixGraphWriteResultIssues(candidateSnapshot.result.issues)),
      )
    }
    options.validateWriteResult?.(materialized)
    applyGraphWriteTransaction(store, materialized.transaction)
    const syncedAt = new Date()
    recordActivity({
      kind: "write",
      txId: materialized.txId,
      cursor: materialized.cursor,
      freshness: "current",
      replayed: materialized.replayed,
      at: syncedAt,
    })
    publish({
      ...state,
      status: "ready",
      freshness: "current",
      recentActivities: state.recentActivities,
      cursor: materialized.cursor,
      lastSyncedAt: syncedAt,
      error: undefined,
    })
    return cloneAuthoritativeGraphWriteResult(materialized)
  }

  async function pull(source: SyncSource): Promise<SyncPayload> {
    const sourceState = cloneState(state)
    publish({
      ...state,
      status: "syncing",
      error: undefined,
    })

    try {
      return apply(await source(sourceState))
    } catch (error) {
      publish({
        ...state,
        status: "error",
        freshness: "stale",
        error,
      })
      throw error
    }
  }

  function getState(): SyncState {
    return cloneState(state)
  }

  function subscribe(listener: SyncStateListener): () => void {
    listeners.add(listener)

    return () => {
      listeners.delete(listener)
    }
  }

  return {
    apply,
    applyWriteResult,
    pull,
    getState,
    subscribe,
  }
}

export function createTotalSyncPayload(
  store: Store,
  options: {
    cursor?: string
    freshness?: SyncFreshness
  } = {},
): TotalSyncPayload {
  return {
    mode: "total",
    scope: graphSyncScope,
    snapshot: store.snapshot(),
    cursor: options.cursor ?? "full",
    completeness: "complete",
    freshness: options.freshness ?? "current",
  }
}

export function createTotalSyncController(
  store: Store,
  options: {
    pull: SyncSource
    validate?: TotalSyncPayloadValidator
    validateWriteResult?: AuthoritativeGraphWriteResultValidator
    preserveSnapshot?: StoreSnapshot
  },
): TotalSyncController {
  const session = createTotalSyncSession(store, {
    preserveSnapshot: options.preserveSnapshot,
    validate: options.validate,
    validateWriteResult: options.validateWriteResult,
  })

  return {
    apply: session.apply,
    applyWriteResult: session.applyWriteResult,
    sync() {
      return session.pull(options.pull)
    },
    getState: session.getState,
    subscribe: session.subscribe,
  }
}

export function createSyncedTypeClient<const T extends Record<string, AnyTypeOutput>>(
  namespace: T,
  options: {
    pull: SyncSource
    push?: GraphWriteSink
    createTxId?: () => string
  },
): SyncedTypeClient<T> {
  const store = createStore()
  bootstrap(store)
  bootstrap(store, namespace)
  const authoritativeStore = createStore()
  bootstrap(authoritativeStore)
  bootstrap(authoritativeStore, namespace)
  const preserveSnapshot = authoritativeStore.snapshot()
  const rawGraph = createTypeClient(store, namespace)
  const session = createTotalSyncSession(authoritativeStore, {
    preserveSnapshot,
    validate: createAuthoritativeTotalSyncValidator(namespace),
    validateWriteResult: createAuthoritativeGraphWriteResultValidator(authoritativeStore, namespace),
  })
  let txSequence = 0
  let pendingTransactions: GraphWriteTransaction[] = []
  let captureDepth = 0
  let captureSnapshot: StoreSnapshot | undefined
  let statusOverride: SyncStatus | undefined
  let freshnessOverride: SyncFreshness | undefined
  let errorOverride: unknown | undefined
  const listeners = new Set<SyncStateListener>()
  const typeHandleCache = new WeakMap<object, object>()
  const entityRefCache = new WeakMap<object, object>()
  const fieldGroupCache = new WeakMap<object, object>()
  const predicateRefCache = new WeakMap<object, object>()
  let lastPublishedState: SyncState | undefined

  function matchesLastPublishedState(state: SyncState): boolean {
    if (!lastPublishedState) return false
    if (lastPublishedState.recentActivities.length !== state.recentActivities.length) return false

    for (let index = 0; index < state.recentActivities.length; index += 1) {
      const left = lastPublishedState.recentActivities[index]
      const right = state.recentActivities[index]
      if (!left || !right || !sameSyncActivity(left, right)) return false
    }

    return (
      lastPublishedState.mode === state.mode &&
      lastPublishedState.scope.kind === state.scope.kind &&
      lastPublishedState.status === state.status &&
      lastPublishedState.completeness === state.completeness &&
      lastPublishedState.freshness === state.freshness &&
      lastPublishedState.pendingCount === state.pendingCount &&
      lastPublishedState.cursor === state.cursor &&
      lastPublishedState.error === state.error &&
      (lastPublishedState.lastSyncedAt?.getTime() ?? undefined) ===
        (state.lastSyncedAt?.getTime() ?? undefined)
    )
  }

  function clonePendingTransactions(): GraphWriteTransaction[] {
    return pendingTransactions.map((transaction) => cloneGraphWriteTransaction(transaction))
  }

  function nextTxId(): string {
    if (options.createTxId) return options.createTxId()
    txSequence += 1
    return `local:${txSequence}`
  }

  function currentState(): SyncState {
    const state = session.getState()
    return cloneState({
      ...state,
      status: statusOverride ?? state.status,
      freshness: freshnessOverride ?? state.freshness,
      pendingCount: pendingTransactions.length,
      error: errorOverride ?? state.error,
    })
  }

  function publishState(): void {
    const state = currentState()
    if (matchesLastPublishedState(state)) return
    lastPublishedState = state
    for (const listener of new Set(listeners)) listener(state)
  }

  function clearOverrides(): void {
    statusOverride = undefined
    freshnessOverride = undefined
    errorOverride = undefined
  }

  function materializeLocalSnapshot(): StoreSnapshot {
    const replayStore = createStore()
    replayStore.replace(authoritativeStore.snapshot())
    for (const transaction of pendingTransactions) {
      applyGraphWriteTransaction(replayStore, transaction)
    }
    const validation = validateGraphStore(replayStore, namespace)
    if (!validation.ok) throw new GraphValidationError(validation)
    return replayStore.snapshot()
  }

  function replaceLocalFromAuthority(): void {
    store.replace(materializeLocalSnapshot())
  }

  function recordCommittedMutation<TResult>(fn: () => TResult): TResult {
    const isRoot = captureDepth === 0
    if (isRoot) captureSnapshot = store.snapshot()
    captureDepth += 1
    let succeeded = false
    let before: StoreSnapshot | undefined
    let result!: TResult

    try {
      result = fn()
      succeeded = true
    } finally {
      captureDepth -= 1
      if (isRoot) {
        before = captureSnapshot
        captureSnapshot = undefined
      }
    }

    if (!isRoot || !succeeded || before === undefined) return result

    const committedBefore = before as StoreSnapshot
    const transaction = createGraphWriteTransactionFromSnapshots(
      committedBefore,
      store.snapshot(),
      nextTxId(),
    )
    if (transaction.ops.length === 0) return result
    pendingTransactions = [...pendingTransactions, transaction]
    publishState()
    return result
  }

  function reconcileWriteResult(
    result: AuthoritativeGraphWriteResult,
    options: {
      acknowledgePending?: boolean
    } = {},
  ): AuthoritativeGraphWriteResult {
    const applied = session.applyWriteResult(result)

    if (options.acknowledgePending && pendingTransactions[0]?.id === applied.txId) {
      pendingTransactions = pendingTransactions.slice(1)
    }

    replaceLocalFromAuthority()
    return applied
  }

  function wrapPredicateRef<TValue extends object>(predicateRef: TValue): TValue {
    const cached = predicateRefCache.get(predicateRef)
    if (cached) return cached as TValue

    const wrapped = new Proxy(predicateRef, {
      get(target, key, receiver) {
        const value = Reflect.get(target, key, receiver)
        if (typeof key !== "string") return value
        if (typeof value !== "function") return value

        if (
          key === "set" ||
          key === "clear" ||
          key === "replace" ||
          key === "add" ||
          key === "remove" ||
          key === "batch"
        ) {
          return (...args: unknown[]) => recordCommittedMutation(() => value.apply(target, args))
        }

        return value.bind(target)
      },
    })

    predicateRefCache.set(predicateRef, wrapped)
    return wrapped as TValue
  }

  function wrapFieldGroup<TValue extends object>(fieldGroup: TValue): TValue {
    const cached = fieldGroupCache.get(fieldGroup)
    if (cached) return cached as TValue

    const wrapped = new Proxy(fieldGroup, {
      get(target, key, receiver) {
        const value = Reflect.get(target, key, receiver)
        if (typeof key !== "string") return value
        if (!isObjectRecord(value)) return value
        if ("predicateId" in value && typeof value.predicateId === "string") {
          return wrapPredicateRef(value)
        }
        return wrapFieldGroup(value)
      },
    })

    fieldGroupCache.set(fieldGroup, wrapped)
    return wrapped as TValue
  }

  function wrapEntityRef<TValue extends object>(entityRef: TValue): TValue {
    const cached = entityRefCache.get(entityRef)
    if (cached) return cached as TValue

    const wrapped = new Proxy(entityRef, {
      get(target, key, receiver) {
        const value = Reflect.get(target, key, receiver)
        if (typeof key !== "string") return value
        if (key === "fields" && isObjectRecord(value)) return wrapFieldGroup(value)
        if (typeof value !== "function") return value

        if (key === "update" || key === "delete" || key === "batch") {
          return (...args: unknown[]) => recordCommittedMutation(() => value.apply(target, args))
        }

        return value.bind(target)
      },
    })

    entityRefCache.set(entityRef, wrapped)
    return wrapped as TValue
  }

  function wrapTypeHandle<TValue extends object>(typeHandle: TValue): TValue {
    const cached = typeHandleCache.get(typeHandle)
    if (cached) return cached as TValue

    const wrapped = new Proxy(typeHandle, {
      get(target, key, receiver) {
        const value = Reflect.get(target, key, receiver)
        if (typeof key !== "string") return value
        if (typeof value !== "function") return value

        if (key === "create" || key === "update" || key === "delete") {
          return (...args: unknown[]) => recordCommittedMutation(() => value.apply(target, args))
        }

        if (key === "ref" || key === "node") {
          return (...args: unknown[]) => wrapEntityRef(value.apply(target, args))
        }

        return value.bind(target)
      },
    })

    typeHandleCache.set(typeHandle, wrapped)
    return wrapped as TValue
  }

  const graph = new Proxy(rawGraph as object, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver)
      if (typeof key !== "string") return value
      if (!isObjectRecord(value)) return value
      return wrapTypeHandle(value)
    },
  }) as NamespaceClient<T>

  session.subscribe(() => {
    publishState()
  })

  return {
    store,
    graph,
    sync: {
      apply(payload) {
        clearOverrides()
        try {
          const applied = session.apply(payload)
          if (applied.mode === "total") pendingTransactions = []
          replaceLocalFromAuthority()
          publishState()
          return applied
        } catch (error) {
          publishState()
          throw error
        }
      },
      applyWriteResult(result) {
        clearOverrides()
        try {
          const applied = reconcileWriteResult(result, { acknowledgePending: true })
          publishState()
          return applied
        } catch (error) {
          publishState()
          throw error
        }
      },
      async flush() {
        if (pendingTransactions.length === 0) return []
        if (!options.push) {
          throw new Error("Synced client cannot flush pending writes without a push transport.")
        }

        const results: AuthoritativeGraphWriteResult[] = []
        statusOverride = "pushing"
        freshnessOverride = undefined
        errorOverride = undefined
        publishState()

        while (pendingTransactions[0]) {
          const transaction = pendingTransactions[0]
          if (!transaction) break

          try {
            const result = await options.push(transaction)
            results.push(reconcileWriteResult(result, { acknowledgePending: true }))
            if (pendingTransactions.length > 0) {
              statusOverride = "pushing"
              freshnessOverride = undefined
              errorOverride = undefined
              publishState()
            }
          } catch (cause) {
            const error =
              cause instanceof GraphSyncWriteError
                ? cause
                : new GraphSyncWriteError(transaction, cause)
            statusOverride = "error"
            freshnessOverride = "stale"
            errorOverride = error
            publishState()
            throw error
          }
        }

        clearOverrides()
        publishState()
        return results
      },
      async sync() {
        clearOverrides()
        try {
          const applied = await session.pull(options.pull)
          if (applied.mode === "total") pendingTransactions = []
          replaceLocalFromAuthority()
          publishState()
          return applied
        } catch (error) {
          publishState()
          throw error
        }
      },
      getPendingTransactions() {
        return clonePendingTransactions()
      },
      getState() {
        return currentState()
      },
      subscribe(listener) {
        listeners.add(listener)

        return () => {
          listeners.delete(listener)
        }
      },
    },
  }
}
