import {
  defineLiveSyncRegistration,
  isInvalidationEventCompatibleWithTarget,
  type DependencyKey,
} from "@io/core/graph";

import type {
  WorkflowReviewLiveInvalidation,
  WorkflowReviewLiveRegistration,
  WorkflowReviewPullLiveResult,
  WorkflowReviewLiveRegistrationTarget,
} from "./workflow-live-transport.js";

const defaultWorkflowReviewLiveRegistrationTtlMs = 60_000;

export type WorkflowReviewLiveScopeRouterOptions = {
  readonly now?: () => Date;
  readonly registrationTtlMs?: number;
};

export type WorkflowReviewLiveInvalidationDelivery = (input: {
  readonly invalidation: WorkflowReviewLiveInvalidation;
  readonly registration: WorkflowReviewLiveRegistration;
}) => void;

export type WorkflowReviewLiveScopeRouter = {
  attachInvalidationDelivery(input: {
    readonly deliver: WorkflowReviewLiveInvalidationDelivery;
    readonly scopeId: string;
    readonly sessionId: string;
  }): () => void;
  register(input: WorkflowReviewLiveRegistrationTarget): WorkflowReviewLiveRegistration;
  publish(invalidation: WorkflowReviewLiveInvalidation): readonly WorkflowReviewLiveRegistration[];
  pull(input: {
    readonly scopeId: string;
    readonly sessionId: string;
  }): WorkflowReviewPullLiveResult;
  remove(input: { readonly scopeId: string; readonly sessionId: string }): boolean;
  expire(): readonly WorkflowReviewLiveRegistration[];
  registrationsForDependencyKey(
    dependencyKey: DependencyKey,
  ): readonly WorkflowReviewLiveRegistration[];
  registrationsForScope(scopeId: string): readonly WorkflowReviewLiveRegistration[];
  registrationsForSession(sessionId: string): readonly WorkflowReviewLiveRegistration[];
};

function createRegistrationId(sessionId: string, activeScopeId: string): string {
  return `workflow-review:${sessionId}:${activeScopeId}`;
}

function createSessionScopeKey(sessionId: string, scopeId: string): string {
  return `${sessionId}\u0000${scopeId}`;
}

function createFrozenRegistration(
  registrationId: string,
  input: WorkflowReviewLiveRegistrationTarget,
  expiresAt: string,
): WorkflowReviewLiveRegistration {
  return defineLiveSyncRegistration({
    ...input,
    registrationId,
    expiresAt,
  });
}

function sortRegistrations(
  registrations: Iterable<WorkflowReviewLiveRegistration>,
): readonly WorkflowReviewLiveRegistration[] {
  return [...registrations].sort((left, right) =>
    left.registrationId.localeCompare(right.registrationId),
  );
}

function addIndexedRegistration(
  index: Map<string, Set<string>>,
  key: string,
  registrationId: string,
): void {
  const existing = index.get(key);
  if (existing) {
    existing.add(registrationId);
    return;
  }

  index.set(key, new Set([registrationId]));
}

function removeIndexedRegistration(
  index: Map<string, Set<string>>,
  key: string,
  registrationId: string,
): void {
  const registrations = index.get(key);
  if (!registrations) return;

  registrations.delete(registrationId);
  if (registrations.size === 0) {
    index.delete(key);
  }
}

export function createWorkflowReviewLiveScopeRouter(
  options: WorkflowReviewLiveScopeRouterOptions = {},
): WorkflowReviewLiveScopeRouter {
  const now = options.now ?? (() => new Date());
  const registrationTtlMs = options.registrationTtlMs ?? defaultWorkflowReviewLiveRegistrationTtlMs;

  if (!Number.isInteger(registrationTtlMs) || registrationTtlMs < 1) {
    throw new Error("Workflow live registration TTL must be a positive integer.");
  }

  const registrationsById = new Map<string, WorkflowReviewLiveRegistration>();
  const registrationIdBySessionScope = new Map<string, string>();
  const registrationIdsByDependencyKey = new Map<string, Set<string>>();
  const registrationIdsByScope = new Map<string, Set<string>>();
  const registrationIdsBySession = new Map<string, Set<string>>();
  const invalidationDeliveriesBySessionScope = new Map<
    string,
    WorkflowReviewLiveInvalidationDelivery
  >();
  const invalidationsBySessionScope = new Map<string, readonly WorkflowReviewLiveInvalidation[]>();

  function unregisterById(registrationId: string): WorkflowReviewLiveRegistration | undefined {
    const registration = registrationsById.get(registrationId);
    if (!registration) {
      return undefined;
    }

    registrationsById.delete(registrationId);
    const sessionScopeKey = createSessionScopeKey(registration.sessionId, registration.scopeId);
    registrationIdBySessionScope.delete(sessionScopeKey);
    invalidationDeliveriesBySessionScope.delete(sessionScopeKey);
    invalidationsBySessionScope.delete(sessionScopeKey);
    removeIndexedRegistration(registrationIdsBySession, registration.sessionId, registrationId);
    removeIndexedRegistration(registrationIdsByScope, registration.scopeId, registrationId);
    for (const dependencyKey of registration.dependencyKeys) {
      removeIndexedRegistration(registrationIdsByDependencyKey, dependencyKey, registrationId);
    }

    return registration;
  }

  function expire(): readonly WorkflowReviewLiveRegistration[] {
    const expired: WorkflowReviewLiveRegistration[] = [];
    const nowMs = now().getTime();
    for (const registration of registrationsById.values()) {
      if (Date.parse(registration.expiresAt) > nowMs) {
        continue;
      }

      const removed = unregisterById(registration.registrationId);
      if (removed) {
        expired.push(removed);
      }
    }

    return sortRegistrations(expired);
  }

  function activeRegistrationsForIds(
    registrationIds: readonly string[] | Set<string> | undefined,
  ): readonly WorkflowReviewLiveRegistration[] {
    expire();
    if (!registrationIds) {
      return [];
    }

    const ids = Array.isArray(registrationIds) ? registrationIds : [...registrationIds];
    if (ids.length === 0) {
      return [];
    }

    return sortRegistrations(
      ids
        .map((registrationId) => registrationsById.get(registrationId))
        .filter(
          (registration): registration is WorkflowReviewLiveRegistration =>
            registration !== undefined,
        ),
    );
  }

  return {
    attachInvalidationDelivery(input) {
      const sessionScopeKey = createSessionScopeKey(input.sessionId, input.scopeId);
      invalidationDeliveriesBySessionScope.set(sessionScopeKey, input.deliver);
      invalidationsBySessionScope.delete(sessionScopeKey);
      return () => {
        const current = invalidationDeliveriesBySessionScope.get(sessionScopeKey);
        if (current === input.deliver) {
          invalidationDeliveriesBySessionScope.delete(sessionScopeKey);
        }
      };
    },
    register(input) {
      expire();

      const sessionScopeKey = createSessionScopeKey(input.sessionId, input.scopeId);
      const existingRegistrationId = registrationIdBySessionScope.get(sessionScopeKey);
      if (existingRegistrationId) {
        unregisterById(existingRegistrationId);
      }

      const registrationId =
        existingRegistrationId ?? createRegistrationId(input.sessionId, input.activeScopeId);
      invalidationsBySessionScope.delete(sessionScopeKey);
      const registration = createFrozenRegistration(
        registrationId,
        input,
        new Date(now().getTime() + registrationTtlMs).toISOString(),
      );

      registrationsById.set(registration.registrationId, registration);
      registrationIdBySessionScope.set(sessionScopeKey, registration.registrationId);
      addIndexedRegistration(
        registrationIdsBySession,
        registration.sessionId,
        registration.registrationId,
      );
      addIndexedRegistration(
        registrationIdsByScope,
        registration.scopeId,
        registration.registrationId,
      );
      for (const dependencyKey of registration.dependencyKeys) {
        addIndexedRegistration(
          registrationIdsByDependencyKey,
          dependencyKey,
          registration.registrationId,
        );
      }

      return registration;
    },
    publish(invalidation) {
      expire();

      const candidateRegistrationIds = new Set<string>();
      for (const dependencyKey of invalidation.dependencyKeys) {
        for (const registrationId of registrationIdsByDependencyKey.get(dependencyKey) ?? []) {
          candidateRegistrationIds.add(registrationId);
        }
      }
      for (const scopeId of invalidation.affectedScopeIds ?? []) {
        for (const registrationId of registrationIdsByScope.get(scopeId) ?? []) {
          candidateRegistrationIds.add(registrationId);
        }
      }

      const matchedRegistrations: WorkflowReviewLiveRegistration[] = [];
      for (const registrationId of candidateRegistrationIds) {
        const registration = registrationsById.get(registrationId);
        if (!registration) {
          continue;
        }
        if (
          !isInvalidationEventCompatibleWithTarget(invalidation, {
            scopeId: registration.scopeId,
            dependencyKeys: registration.dependencyKeys,
          })
        ) {
          continue;
        }

        const sessionScopeKey = createSessionScopeKey(registration.sessionId, registration.scopeId);
        const deliver = invalidationDeliveriesBySessionScope.get(sessionScopeKey);
        if (deliver) {
          try {
            deliver({
              invalidation,
              registration,
            });
            invalidationsBySessionScope.delete(sessionScopeKey);
          } catch {
            unregisterById(registration.registrationId);
            continue;
          }
        } else {
          const pending = invalidationsBySessionScope.get(sessionScopeKey) ?? [];
          invalidationsBySessionScope.set(sessionScopeKey, [...pending, invalidation]);
        }
        matchedRegistrations.push(registration);
      }

      return sortRegistrations(matchedRegistrations);
    },
    pull(input) {
      expire();
      const sessionScopeKey = createSessionScopeKey(input.sessionId, input.scopeId);
      const invalidations = invalidationsBySessionScope.get(sessionScopeKey) ?? [];
      invalidationsBySessionScope.delete(sessionScopeKey);

      return Object.freeze({
        active: registrationIdBySessionScope.has(sessionScopeKey),
        invalidations: Object.freeze([...invalidations]),
        scopeId: input.scopeId,
        sessionId: input.sessionId,
      });
    },
    remove(input) {
      expire();
      return (
        unregisterById(
          registrationIdBySessionScope.get(createSessionScopeKey(input.sessionId, input.scopeId)) ??
            "",
        ) !== undefined
      );
    },
    expire,
    registrationsForDependencyKey(dependencyKey) {
      return activeRegistrationsForIds(registrationIdsByDependencyKey.get(dependencyKey));
    },
    registrationsForScope(scopeId) {
      return activeRegistrationsForIds(registrationIdsByScope.get(scopeId));
    },
    registrationsForSession(sessionId) {
      return activeRegistrationsForIds(registrationIdsBySession.get(sessionId));
    },
  };
}
