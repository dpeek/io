import {
  type AnyTypeOutput,
  createIncrementalSyncFallback,
  createIncrementalSyncPayload,
  createLiveSyncActiveScopeId,
  type AuthorizationContext,
  type PersistedAuthoritativeGraph,
  type PolicyError,
  type Store,
  type StoreSnapshot,
} from "@io/core/graph";
import {
  compileWorkflowReviewScopeDependencyKeys,
  createWorkflowProjectionIndexFromRetainedState,
  type CommitQueueScopeQuery,
  type ProjectBranchScopeQuery,
  type RetainedWorkflowProjectionState,
  type WorkflowProjectionIndex,
  workflowReviewModuleReadScope,
} from "@io/core/graph/modules/ops/workflow";

import {
  assertCurrentAuthorizationVersion,
  assertWorkflowProjectionReadable,
  createReadableReplicationAuthorizer,
} from "./authority-authorization-services.js";
import type { CompiledFieldDefinition } from "./authority-compiled-fields.js";
import {
  filterModuleScopedSnapshot,
  filterModuleScopedWriteResult,
  formatScopedModuleCursor,
  formatScopedSyncDiagnostics,
  parseScopedModuleCursor,
  planRequestedSyncScope,
} from "./authority-sync-scope-planning.js";
import type { WorkflowReviewLiveRegistrationTarget } from "./workflow-live-transport.js";

type ScopedAuthority = PersistedAuthoritativeGraph<Record<string, AnyTypeOutput>>;
type ScopedSyncFreshness = NonNullable<
  Parameters<ScopedAuthority["createSyncPayload"]>[0]
>["freshness"];

function requireWorkflowLiveRegistrationPrincipal(
  authorization: AuthorizationContext,
  createWorkflowLiveScopeError: (
    status: number,
    message: string,
    code?: "auth.unauthenticated" | "policy-changed" | "scope-changed",
  ) => Error,
): {
  readonly principalId: string;
  readonly sessionId: string;
} {
  if (!authorization.principalId || !authorization.sessionId) {
    throw createWorkflowLiveScopeError(
      401,
      "Workflow live registrations require an authenticated session principal.",
      "auth.unauthenticated",
    );
  }

  return {
    principalId: authorization.principalId,
    sessionId: authorization.sessionId,
  };
}

export function createScopedSyncServices(input: {
  readonly authority: ScopedAuthority;
  readonly compiledFieldIndex: ReadonlyMap<string, CompiledFieldDefinition>;
  readonly createReadPolicyError: (error: PolicyError) => Error;
  readonly createScopeNotFoundError: (scopeId: string, moduleId: string) => Error;
  readonly createWorkflowProjectionPolicyError: (error: PolicyError) => Error;
  readonly createWorkflowLiveScopeError: (
    status: number,
    message: string,
    code?: "auth.unauthenticated" | "policy-changed" | "scope-changed",
  ) => Error;
  readonly getCurrentProjectionState: () => RetainedWorkflowProjectionState | null;
  readonly isVisibilityResetRequired: (
    snapshot: StoreSnapshot,
    changes: ReturnType<ScopedAuthority["getChangesAfter"]>,
    authorization: AuthorizationContext,
  ) => boolean;
  readonly listWorkflowProjectionSubjectIds: (store: Store) => readonly string[];
  readonly rebuildProjectionState: () => RetainedWorkflowProjectionState;
  readonly setProjectionState: (projection: RetainedWorkflowProjectionState) => void;
  readonly typePredicateId: string;
  readonly workflowModuleEntityTypeIds: ReadonlySet<string>;
}) {
  function createAuthorizedWorkflowProjection(
    authorization: AuthorizationContext,
  ): WorkflowProjectionIndex {
    const readabilityError = assertWorkflowProjectionReadable({
      store: input.authority.store,
      authorization,
      compiledFieldIndex: input.compiledFieldIndex,
      subjectIds: input.listWorkflowProjectionSubjectIds(input.authority.store),
    });
    if (readabilityError) {
      throw input.createWorkflowProjectionPolicyError(readabilityError);
    }

    const retainedProjection = input.getCurrentProjectionState();
    if (retainedProjection) {
      try {
        return createWorkflowProjectionIndexFromRetainedState(retainedProjection);
      } catch {
        input.setProjectionState(input.rebuildProjectionState());
      }
    }

    const rebuiltProjection = input.rebuildProjectionState();
    input.setProjectionState(rebuiltProjection);
    return createWorkflowProjectionIndexFromRetainedState(rebuiltProjection);
  }

  function createReadableOrThrow(authorization: AuthorizationContext) {
    const readable = createReadableReplicationAuthorizer({
      store: input.authority.store,
      authorization,
      compiledFieldIndex: input.compiledFieldIndex,
    });
    if (readable.authorizeRead) {
      return readable.authorizeRead;
    }

    throw input.createReadPolicyError(
      readable.error ?? {
        code: "policy.read.forbidden",
        message: "Readable replication authorization could not be created.",
        retryable: false,
        refreshRequired: false,
      },
    );
  }

  return {
    createSyncPayload(options: {
      readonly authorization: AuthorizationContext;
      readonly freshness?: ScopedSyncFreshness;
      readonly scope?:
        | {
            readonly kind?: "graph";
          }
        | {
            readonly kind: "module";
            readonly moduleId: string;
            readonly scopeId: string;
          };
    }) {
      const authorizeRead = createReadableOrThrow(options.authorization);
      const plannedScope = planRequestedSyncScope(
        options.scope,
        options.authorization,
        input.workflowModuleEntityTypeIds,
        input.createScopeNotFoundError,
      );
      const payload = input.authority.createSyncPayload({
        authorizeRead,
        freshness: options.freshness,
      });
      if (!plannedScope) {
        return payload;
      }

      return {
        ...payload,
        scope: plannedScope.scope,
        snapshot: filterModuleScopedSnapshot(
          payload.snapshot,
          input.authority.store,
          input.typePredicateId,
          plannedScope,
        ),
        cursor: formatScopedModuleCursor(plannedScope.scope, payload.cursor),
        diagnostics: formatScopedSyncDiagnostics(plannedScope.scope, payload.diagnostics),
      };
    },

    getIncrementalSyncResult(
      after: string | undefined,
      options: {
        readonly authorization: AuthorizationContext;
        readonly freshness?: ScopedSyncFreshness;
        readonly scope?:
          | {
              readonly kind?: "graph";
            }
          | {
              readonly kind: "module";
              readonly moduleId: string;
              readonly scopeId: string;
            };
      },
    ) {
      const requestedAfter = after;
      const snapshot = input.authority.store.snapshot();
      const authorizeRead = createReadableOrThrow(options.authorization);
      const plannedScope = planRequestedSyncScope(
        options.scope,
        options.authorization,
        input.workflowModuleEntityTypeIds,
        input.createScopeNotFoundError,
      );

      if (after && plannedScope) {
        const currentPayload = input.authority.createSyncPayload({
          authorizeRead,
          freshness: options.freshness,
        });
        const currentScopedCursor = formatScopedModuleCursor(
          plannedScope.scope,
          currentPayload.cursor,
        );
        const currentDiagnostics = formatScopedSyncDiagnostics(
          plannedScope.scope,
          currentPayload.diagnostics,
        );
        const parsedAfter = parseScopedModuleCursor(after);
        if (!parsedAfter) {
          return createIncrementalSyncFallback("scope-changed", {
            after,
            cursor: currentScopedCursor,
            freshness: options.freshness,
            scope: plannedScope.scope,
            diagnostics: currentDiagnostics,
          });
        }
        if (
          parsedAfter.moduleId !== plannedScope.scope.moduleId ||
          parsedAfter.scopeId !== plannedScope.scope.scopeId ||
          parsedAfter.definitionHash !== plannedScope.scope.definitionHash
        ) {
          return createIncrementalSyncFallback("scope-changed", {
            after,
            cursor: currentScopedCursor,
            freshness: options.freshness,
            scope: plannedScope.scope,
            diagnostics: currentDiagnostics,
          });
        }
        if (parsedAfter.policyFilterVersion !== plannedScope.scope.policyFilterVersion) {
          return createIncrementalSyncFallback("policy-changed", {
            after,
            cursor: currentScopedCursor,
            freshness: options.freshness,
            scope: plannedScope.scope,
            diagnostics: currentDiagnostics,
          });
        }
        after = parsedAfter.cursor;
      }

      if (after) {
        const changes = input.authority.getChangesAfter(after);
        if (input.isVisibilityResetRequired(snapshot, changes, options.authorization)) {
          const cursor = plannedScope
            ? formatScopedModuleCursor(plannedScope.scope, changes.cursor)
            : changes.cursor;

          return createIncrementalSyncFallback(plannedScope ? "policy-changed" : "reset", {
            after: requestedAfter ?? after,
            cursor,
            freshness: options.freshness,
            ...(plannedScope ? { scope: plannedScope.scope } : {}),
          });
        }
      }

      const result = input.authority.getIncrementalSyncResult(after, {
        authorizeRead,
        freshness: options.freshness,
      });
      if (!plannedScope) {
        return result;
      }

      const resultAfter = formatScopedModuleCursor(plannedScope.scope, result.after);
      const resultCursor = formatScopedModuleCursor(plannedScope.scope, result.cursor);
      if ("fallback" in result) {
        return createIncrementalSyncFallback(result.fallback, {
          after: resultAfter,
          cursor: resultCursor,
          freshness: result.freshness,
          scope: plannedScope.scope,
          diagnostics: formatScopedSyncDiagnostics(plannedScope.scope, result.diagnostics),
        });
      }

      const edgeById = new Map(
        input.authority.store.snapshot().edges.map((edge) => [edge.id, edge]),
      );
      const transactions = result.transactions.flatMap((transaction) => {
        const scoped = filterModuleScopedWriteResult(
          transaction,
          input.authority.store,
          edgeById,
          input.typePredicateId,
          plannedScope,
        );
        return scoped ? [scoped] : [];
      });

      return createIncrementalSyncPayload(transactions, {
        after: resultAfter,
        cursor: resultCursor,
        freshness: result.freshness,
        scope: plannedScope.scope,
        diagnostics: formatScopedSyncDiagnostics(plannedScope.scope, result.diagnostics),
      });
    },

    planWorkflowReviewLiveRegistration(
      cursor: string,
      authorization: AuthorizationContext,
    ): WorkflowReviewLiveRegistrationTarget {
      const staleContextError = assertCurrentAuthorizationVersion(
        input.authority.store,
        authorization,
      );
      if (staleContextError) {
        throw input.createReadPolicyError(staleContextError);
      }

      const parsedCursor = parseScopedModuleCursor(cursor);
      if (!parsedCursor) {
        throw input.createWorkflowLiveScopeError(
          400,
          "Workflow live registration requires the current scoped workflow-review cursor.",
        );
      }

      const plannedScope = planRequestedSyncScope(
        workflowReviewModuleReadScope,
        authorization,
        input.workflowModuleEntityTypeIds,
        input.createScopeNotFoundError,
      );
      if (!plannedScope) {
        throw input.createWorkflowLiveScopeError(
          500,
          "Workflow live registration planning requires the shipped workflow review scope.",
        );
      }

      if (
        parsedCursor.moduleId !== plannedScope.scope.moduleId ||
        parsedCursor.scopeId !== plannedScope.scope.scopeId ||
        parsedCursor.definitionHash !== plannedScope.scope.definitionHash
      ) {
        throw input.createWorkflowLiveScopeError(
          409,
          `Workflow live registration cursor no longer matches scope "${plannedScope.scope.scopeId}". Re-sync and register again.`,
          "scope-changed",
        );
      }
      if (parsedCursor.policyFilterVersion !== plannedScope.scope.policyFilterVersion) {
        throw input.createWorkflowLiveScopeError(
          409,
          `Workflow live registration cursor policy "${parsedCursor.policyFilterVersion}" does not match the current workflow review policy filter "${plannedScope.scope.policyFilterVersion}". Re-sync and register again.`,
          "policy-changed",
        );
      }

      const principal = requireWorkflowLiveRegistrationPrincipal(
        authorization,
        input.createWorkflowLiveScopeError,
      );

      return Object.freeze({
        activeScopeId: createLiveSyncActiveScopeId({
          scopeId: plannedScope.scope.scopeId,
          definitionHash: plannedScope.scope.definitionHash,
          policyFilterVersion: plannedScope.scope.policyFilterVersion,
        }),
        sessionId: principal.sessionId,
        principalId: principal.principalId,
        scopeId: plannedScope.scope.scopeId,
        definitionHash: plannedScope.scope.definitionHash,
        policyFilterVersion: plannedScope.scope.policyFilterVersion,
        dependencyKeys: Object.freeze([...compileWorkflowReviewScopeDependencyKeys()]),
      });
    },

    readProjectBranchScope(query: ProjectBranchScopeQuery, authorization: AuthorizationContext) {
      return createAuthorizedWorkflowProjection(authorization).readProjectBranchScope(query);
    },

    readCommitQueueScope(query: CommitQueueScopeQuery, authorization: AuthorizationContext) {
      return createAuthorizedWorkflowProjection(authorization).readCommitQueueScope(query);
    },
  };
}
