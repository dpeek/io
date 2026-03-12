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

export type SyncState = {
  readonly mode: "total"
  readonly scope: SyncScope
  readonly status: SyncStatus
  readonly completeness: SyncCompleteness
  readonly freshness: SyncFreshness
  readonly pendingCount: number
  readonly cursor?: string
  readonly lastSyncedAt?: Date
  readonly error?: unknown
}

export type SyncStateListener = (state: SyncState) => void
export type TotalSyncSource = () => TotalSyncPayload | Promise<TotalSyncPayload>
export type TotalSyncPayloadValidator = (payload: TotalSyncPayload) => void
export type AuthoritativeGraphWriteResultValidator = (
  result: AuthoritativeGraphWriteResult,
) => void

export interface TotalSyncController {
  apply(payload: TotalSyncPayload): TotalSyncPayload
  applyWriteResult(result: AuthoritativeGraphWriteResult): AuthoritativeGraphWriteResult
  sync(): Promise<TotalSyncPayload>
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
  apply(payload: TotalSyncPayload): TotalSyncPayload
  applyWriteResult(result: AuthoritativeGraphWriteResult): AuthoritativeGraphWriteResult
  pull(source: TotalSyncSource): Promise<TotalSyncPayload>
  getState(): SyncState
  subscribe(listener: SyncStateListener): () => void
}

export interface AuthoritativeGraphWriteSession {
  apply(transaction: GraphWriteTransaction): AuthoritativeGraphWriteResult
  getCursor(): string | undefined
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
  return (result) => {
    const validation = validateAuthoritativeGraphWriteResult(result, store, namespace)
    if (!validation.ok) throw new GraphValidationError(validation)
  }
}

function buildAuthoritativeGraphWriteReplayResult(
  result: AuthoritativeGraphWriteResult,
): AuthoritativeGraphWriteResult {
  return cloneAuthoritativeGraphWriteResult(result, { replayed: true })
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
  } = {},
): AuthoritativeGraphWriteSession {
  const cursorPrefix = options.cursorPrefix ?? "tx:"
  const txRecords = new Map<string, AuthoritativeGraphWriteRecord>()
  let sequence = options.initialSequence ?? 0

  function currentCursor(): string | undefined {
    return sequence > 0 ? `${cursorPrefix}${sequence}` : undefined
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
    const result: AuthoritativeGraphWriteResult = {
      txId: prepared.value.id,
      cursor: `${cursorPrefix}${sequence}`,
      replayed: false,
      transaction: prepared.value,
    }
    txRecords.set(prepared.value.id, {
      ok: true,
      transaction: prepared.value,
      result,
    })
    return cloneAuthoritativeGraphWriteResult(result)
  }

  return {
    apply,
    getCursor: currentCursor,
  }
}

function cloneState(state: SyncState): SyncState {
  return {
    ...state,
    scope: graphSyncScope,
    pendingCount: state.pendingCount,
    lastSyncedAt: state.lastSyncedAt ? new Date(state.lastSyncedAt.getTime()) : undefined,
  }
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
  }
  const listeners = new Set<SyncStateListener>()

  function publish(next: SyncState): void {
    state = next
    const snapshot = cloneState(state)
    for (const listener of new Set(listeners)) listener(snapshot)
  }

  function apply(payload: TotalSyncPayload): TotalSyncPayload {
    const prepared = prepareTotalSyncPayload(payload, options)
    if (!prepared.ok) throw new GraphValidationError(prepared.result)

    const materialized = prepared.value
    options.validate?.(materialized)
    store.replace(materialized.snapshot)
    publish({
      mode: materialized.mode,
      scope: materialized.scope,
      status: "ready",
      completeness: materialized.completeness,
      freshness: materialized.freshness,
      pendingCount: 0,
      cursor: materialized.cursor,
      lastSyncedAt: new Date(),
    })
    return materialized
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
    publish({
      ...state,
      status: "ready",
      freshness: "current",
      cursor: materialized.cursor,
      lastSyncedAt: new Date(),
      error: undefined,
    })
    return cloneAuthoritativeGraphWriteResult(materialized)
  }

  async function pull(source: TotalSyncSource): Promise<TotalSyncPayload> {
    publish({
      ...state,
      status: "syncing",
      error: undefined,
    })

    try {
      return apply(await source())
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
    pull: TotalSyncSource
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
    pull: TotalSyncSource
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
          pendingTransactions = []
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
          pendingTransactions = []
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
