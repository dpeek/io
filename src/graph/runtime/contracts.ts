import type { PolicyCapabilityKey, PredicatePolicyDescriptor } from "./schema";

/**
 * Stable graph-owned principal kinds. These match the canonical
 * `core:principalKind` options.
 */
export type PrincipalKind = "human" | "service" | "agent" | "anonymous" | "remoteGraph";

/**
 * Monotonic principal-scoped capability snapshot version.
 */
export type CapabilityVersion = number;

/**
 * Monotonic graph-scoped authorization policy snapshot version. Authority-owned
 * write and command paths are expected to fail closed with
 * `policy.stale_context` when a request-bound context does not match the
 * authority's current policy version.
 */
export type PolicyVersion = number;

/**
 * Stable provider-neutral auth subject tuple mirrored by
 * `core:authSubjectProjection`. Host-specific request/session parsing remains
 * provisional.
 */
export type AuthSubjectRef = {
  readonly issuer: string;
  readonly provider: string;
  readonly providerAccountId: string;
  readonly authUserId: string;
};

/**
 * Stable minimal authenticated session shape consumed by request-time
 * projection seams. Better Auth-specific session payload details stay in host
 * code.
 */
export type AuthenticatedSession = {
  readonly sessionId: string;
  readonly subject: AuthSubjectRef;
  readonly email?: string;
};

/**
 * Stable request-bound authorization snapshot consumed by authority, sync,
 * commands, and future module/runtime policy surfaces.
 */
export type AuthorizationContext = {
  readonly graphId: string;
  readonly principalId: string | null;
  readonly principalKind: PrincipalKind | null;
  readonly sessionId: string | null;
  readonly roleKeys: readonly string[];
  readonly capabilityGrantIds: readonly string[];
  readonly capabilityVersion: CapabilityVersion;
  readonly policyVersion: PolicyVersion;
};

/**
 * Stable browser-visible shell session states. `booting` is client-local while
 * the shell is still resolving whether it can fetch a principal summary.
 * `expired` is the reauthentication-required state and must not be treated as
 * fresh authorization evidence.
 */
export type WebPrincipalSessionState = "booting" | "signed-out" | "ready" | "expired";

/**
 * Stable minimal browser-visible session contract shared by app shells and
 * tools. It intentionally stops at auth and principal-summary bootstrap
 * concerns; richer account/profile presentation stays provisional.
 */
export type WebPrincipalSession = {
  readonly authState: WebPrincipalSessionState;
  readonly sessionId: string | null;
  readonly principalId: string | null;
  readonly capabilityVersion: CapabilityVersion | null;
  readonly displayName?: string;
};

/**
 * Stable graph-backed principal summary derived from the request-bound
 * authorization context. This is the durable part of the web bootstrap
 * boundary; route/module/bootstrap decorations stay provisional.
 */
export type WebPrincipalSummary = {
  readonly graphId: string;
  readonly principalId: string;
  readonly principalKind: PrincipalKind;
  readonly roleKeys: readonly string[];
  readonly capabilityGrantIds: readonly string[];
  readonly access: {
    readonly authority: boolean;
    readonly graphMember: boolean;
    readonly sharedRead: boolean;
  };
  readonly capabilityVersion: CapabilityVersion;
  readonly policyVersion: PolicyVersion;
};

/**
 * Stable minimal bootstrap payload for anonymous and authenticated callers.
 * App-shell route/module discovery can layer on top of this payload later, but
 * should not redefine these identity fields.
 */
export type WebPrincipalBootstrapPayload = {
  readonly session: WebPrincipalSession;
  readonly principal: WebPrincipalSummary | null;
};

/**
 * Stable delegated-capability vocabulary shared by graph schema, authority
 * lookup, and future policy/runtime consumers.
 */
export type CapabilityGrantResource =
  | {
      readonly kind: "predicate-read";
      readonly predicateId: string;
    }
  | {
      readonly kind: "predicate-write";
      readonly predicateId: string;
    }
  | {
      readonly kind: "command-execute";
      readonly commandKey: string;
    }
  | {
      readonly kind: "module-permission";
      readonly permissionKey: string;
    }
  | {
      readonly kind: "share-surface";
      readonly surfaceId: string;
    };

/**
 * `principal` targets are stable for the first Branch 2 cut. `graph` and
 * `bearer` targets are published as provisional shared vocabulary only.
 */
export type CapabilityGrantTarget =
  | {
      readonly kind: "principal";
      readonly principalId: string;
    }
  | {
      readonly kind: "graph";
      readonly graphId: string;
    }
  | {
      readonly kind: "bearer";
      readonly tokenHash: string;
    };

export type CapabilityGrantConstraints = {
  readonly rootEntityId?: string;
  readonly predicateIds?: readonly string[];
  readonly expiresAt?: string;
  readonly delegatedFromGrantId?: string;
};

export type CapabilityGrantStatus = "active" | "expired" | "revoked";

export type CapabilityGrant = {
  readonly id: string;
  readonly resource: CapabilityGrantResource;
  readonly target: CapabilityGrantTarget;
  readonly grantedByPrincipalId: string;
  readonly constraints?: CapabilityGrantConstraints;
  readonly status: CapabilityGrantStatus;
  readonly issuedAt: string;
  readonly revokedAt?: string;
};

export const shareSurfaceKinds = ["entity-predicate-slice"] as const;

/**
 * Explicit policy-contract epoch for share-surface validation and lowering.
 *
 * Bump this when share-surface shape, validation, or linked capability-grant
 * lowering changes in a way that affects whether the same stored graph state
 * is readable or valid.
 */
export const shareSurfaceContractVersion = 0;

export type ShareSurfaceKind = (typeof shareSurfaceKinds)[number];

/**
 * First-cut durable share surface for the single-graph proof. The selector is
 * intentionally narrow: one rooted entity plus one explicit predicate set.
 *
 * `surfaceId` is the durable reference that capability grants lower through
 * today and that later named or federated share surfaces can continue to reuse.
 */
export type ShareSurface = {
  readonly surfaceId: string;
  readonly kind: "entity-predicate-slice";
  readonly rootEntityId: string;
  readonly predicateIds: readonly string[];
};

export type ShareGrantStatus = CapabilityGrantStatus;

/**
 * Durable sharing wrapper over a delegated capability grant. The share grant
 * keeps the explicit share surface selector alongside the linked capability
 * grant so later read paths can audit the exact shared slice.
 */
export type ShareGrant = {
  readonly id: string;
  readonly surface: ShareSurface;
  readonly capabilityGrantId: string;
  readonly status: ShareGrantStatus;
};

export type ShareSurfacePolicy = Pick<PredicatePolicyDescriptor, "predicateId" | "shareable">;

export type ShareSurfacePolicyLookup =
  | ReadonlyMap<string, ShareSurfacePolicy | null | undefined>
  | Readonly<Record<string, ShareSurfacePolicy | null | undefined>>;

export type ShareGrantCapabilityProjection = Pick<
  CapabilityGrant,
  "id" | "resource" | "constraints" | "status"
>;

export type AdmissionBootstrapMode = "manual" | "first-user";

export type AdmissionSignupPolicy = "closed" | "open";

export type AdmissionProvisioning = {
  readonly roleKeys: readonly string[];
};

/**
 * Graph-owned admission policy for the current single-graph proof.
 *
 * This contract intentionally stops at durable authorization inputs the graph
 * can own and the authority can enforce: bootstrap posture, self-signup
 * posture, email-domain gating, and the role keys granted during first-use
 * provisioning. Better Auth runtime secrets, provider callbacks, mount paths,
 * and other host bootstrap settings remain outside this graph contract.
 */
export type AdmissionPolicy = {
  readonly graphId: string;
  readonly bootstrapMode: AdmissionBootstrapMode;
  readonly signupPolicy: AdmissionSignupPolicy;
  readonly allowedEmailDomains: readonly string[];
  readonly firstUserProvisioning: AdmissionProvisioning;
  readonly signupProvisioning: AdmissionProvisioning;
};

export type PrincipalRoleBindingStatus = "active" | "revoked";

export type PrincipalRoleBinding = {
  readonly id: string;
  readonly principalId: string;
  readonly roleKey: string;
  readonly status: PrincipalRoleBindingStatus;
};

export type PolicyErrorCode =
  | "auth.unauthenticated"
  | "auth.principal_missing"
  | "policy.read.forbidden"
  | "policy.write.forbidden"
  | "policy.command.forbidden"
  | "policy.stale_context"
  | "grant.invalid"
  | "share.surface_invalid";

export type PolicyError = {
  readonly code: PolicyErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  /**
   * When true, callers should refresh their request-bound authorization context
   * before retrying because the current policy snapshot is no longer current.
   */
  readonly refreshRequired?: boolean;
};

export type ShareValidationResult =
  | {
      readonly ok: true;
    }
  | {
      readonly ok: false;
      readonly error: PolicyError;
    };

export type AuthorizationDecision =
  | {
      readonly allowed: true;
    }
  | {
      readonly allowed: false;
      readonly error: PolicyError;
    };

function shareValidationFailure(
  code: Extract<PolicyErrorCode, "grant.invalid" | "share.surface_invalid">,
  message: string,
): ShareValidationResult {
  return {
    ok: false,
    error: {
      code,
      message,
      retryable: false,
    },
  };
}

function asErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertNonEmptyContractString(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new TypeError(`${label} must not be empty.`);
  }
}

function assertUniqueContractStrings(values: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    assertNonEmptyContractString(value, label);
    if (seen.has(value)) {
      throw new TypeError(`${label} must not contain duplicate values.`);
    }
    seen.add(value);
  }
}

function freezeStringValues(values: readonly string[]): readonly string[] {
  return Object.freeze([...values]);
}

function assertDomainName(value: string, label: string): void {
  assertNonEmptyContractString(value, label);
  if (value !== value.toLowerCase()) {
    throw new TypeError(`${label} must be lowercase.`);
  }
  if (value.includes("@")) {
    throw new TypeError(`${label} must contain only the domain, not an email address.`);
  }
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(value)) {
    throw new TypeError(`${label} must be a valid domain name.`);
  }
}

function isShareSurfacePolicyMap(
  policies: ShareSurfacePolicyLookup,
): policies is ReadonlyMap<string, ShareSurfacePolicy | null | undefined> {
  return policies instanceof Map;
}

function getShareSurfacePolicy(
  policies: ShareSurfacePolicyLookup,
  predicateId: string,
): ShareSurfacePolicy | null | undefined {
  return isShareSurfacePolicyMap(policies) ? policies.get(predicateId) : policies[predicateId];
}

function matchesStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;

  const rightValues = new Set(right);
  return left.every((value) => rightValues.has(value));
}

export function defineAdmissionPolicy<const T extends AdmissionPolicy>(policy: T): Readonly<T> {
  assertNonEmptyContractString(policy.graphId, "graphId");
  assertUniqueContractStrings(
    policy.firstUserProvisioning.roleKeys,
    "firstUserProvisioning.roleKeys",
  );
  assertUniqueContractStrings(policy.signupProvisioning.roleKeys, "signupProvisioning.roleKeys");

  const allowedEmailDomains = [...policy.allowedEmailDomains];
  assertUniqueContractStrings(allowedEmailDomains, "allowedEmailDomains");
  for (const domain of allowedEmailDomains) {
    assertDomainName(domain, "allowedEmailDomains");
  }

  if (policy.bootstrapMode === "first-user" && policy.firstUserProvisioning.roleKeys.length === 0) {
    throw new TypeError(
      'firstUserProvisioning.roleKeys must not be empty when bootstrapMode is "first-user".',
    );
  }

  if (policy.signupPolicy === "open" && policy.signupProvisioning.roleKeys.length === 0) {
    throw new TypeError(
      'signupProvisioning.roleKeys must not be empty when signupPolicy is "open".',
    );
  }

  return Object.freeze({
    ...policy,
    allowedEmailDomains: freezeStringValues(allowedEmailDomains),
    firstUserProvisioning: Object.freeze({
      ...policy.firstUserProvisioning,
      roleKeys: freezeStringValues(policy.firstUserProvisioning.roleKeys),
    }),
    signupProvisioning: Object.freeze({
      ...policy.signupProvisioning,
      roleKeys: freezeStringValues(policy.signupProvisioning.roleKeys),
    }),
  }) as Readonly<T>;
}

export function defineWebPrincipalSession<const T extends WebPrincipalSession>(
  session: T,
): Readonly<T> {
  if (session.sessionId !== null) {
    assertNonEmptyContractString(session.sessionId, "sessionId");
  }

  if (session.principalId !== null) {
    assertNonEmptyContractString(session.principalId, "principalId");
  }

  if (session.displayName != null) {
    assertNonEmptyContractString(session.displayName, "displayName");
  }

  if (session.capabilityVersion !== null && session.capabilityVersion < 0) {
    throw new TypeError("capabilityVersion must not be negative.");
  }

  switch (session.authState) {
    case "booting":
    case "signed-out":
      if (session.sessionId !== null) {
        throw new TypeError(`sessionId must be null when authState is "${session.authState}".`);
      }
      if (session.principalId !== null) {
        throw new TypeError(`principalId must be null when authState is "${session.authState}".`);
      }
      if (session.capabilityVersion !== null) {
        throw new TypeError(
          `capabilityVersion must be null when authState is "${session.authState}".`,
        );
      }
      break;
    case "ready":
      if (session.sessionId === null) {
        throw new TypeError('sessionId must be present when authState is "ready".');
      }
      if ((session.principalId === null) !== (session.capabilityVersion === null)) {
        throw new TypeError(
          'principalId and capabilityVersion must either both be present or both be null when authState is "ready".',
        );
      }
      break;
    case "expired":
      if (session.principalId !== null) {
        throw new TypeError('principalId must be null when authState is "expired".');
      }
      if (session.capabilityVersion !== null) {
        throw new TypeError('capabilityVersion must be null when authState is "expired".');
      }
      break;
    default: {
      const exhaustive: never = session.authState;
      return exhaustive;
    }
  }

  return Object.freeze({
    ...session,
  }) as Readonly<T>;
}

export function defineWebPrincipalSummary<const T extends WebPrincipalSummary>(
  summary: T,
): Readonly<T> {
  assertNonEmptyContractString(summary.graphId, "graphId");
  assertNonEmptyContractString(summary.principalId, "principalId");
  assertUniqueContractStrings(summary.roleKeys, "roleKeys");
  assertUniqueContractStrings(summary.capabilityGrantIds, "capabilityGrantIds");

  if (summary.principalKind === "anonymous") {
    throw new TypeError('principalKind must not be "anonymous" in a web principal summary.');
  }

  if (summary.capabilityVersion < 0) {
    throw new TypeError("capabilityVersion must not be negative.");
  }

  if (summary.policyVersion < 0) {
    throw new TypeError("policyVersion must not be negative.");
  }
  if (typeof summary.access.authority !== "boolean") {
    throw new TypeError("access.authority must be a boolean.");
  }
  if (typeof summary.access.graphMember !== "boolean") {
    throw new TypeError("access.graphMember must be a boolean.");
  }
  if (typeof summary.access.sharedRead !== "boolean") {
    throw new TypeError("access.sharedRead must be a boolean.");
  }

  return Object.freeze({
    ...summary,
    access: Object.freeze({
      authority: summary.access.authority,
      graphMember: summary.access.graphMember,
      sharedRead: summary.access.sharedRead,
    }),
    roleKeys: freezeStringValues(summary.roleKeys),
    capabilityGrantIds: freezeStringValues(summary.capabilityGrantIds),
  }) as Readonly<T>;
}

export function defineWebPrincipalBootstrapPayload<const T extends WebPrincipalBootstrapPayload>(
  payload: T,
): Readonly<T> {
  const session = defineWebPrincipalSession(payload.session);
  const principal = payload.principal ? defineWebPrincipalSummary(payload.principal) : null;

  if (session.authState !== "ready" && principal !== null) {
    throw new TypeError('principal must be null unless session.authState is "ready".');
  }

  if (principal) {
    if (session.principalId === null) {
      throw new TypeError("session.principalId must be present when principal is provided.");
    }
    if (session.principalId !== principal.principalId) {
      throw new TypeError("session.principalId must match principal.principalId.");
    }
    if (session.capabilityVersion === null) {
      throw new TypeError("session.capabilityVersion must be present when principal is provided.");
    }
    if (session.capabilityVersion !== principal.capabilityVersion) {
      throw new TypeError("session.capabilityVersion must match principal.capabilityVersion.");
    }
  }

  return Object.freeze({
    ...payload,
    session,
    principal,
  }) as Readonly<T>;
}

export function defineShareSurface<const T extends ShareSurface>(surface: T): Readonly<T> {
  assertNonEmptyContractString(surface.surfaceId, "surfaceId");
  assertNonEmptyContractString(surface.rootEntityId, "rootEntityId");

  switch (surface.kind) {
    case "entity-predicate-slice":
      if (surface.predicateIds.length === 0) {
        throw new TypeError("predicateIds must not be empty.");
      }
      assertUniqueContractStrings(surface.predicateIds, "predicateIds");
      break;
    default: {
      const exhaustive: never = surface.kind;
      return exhaustive;
    }
  }

  return Object.freeze({
    ...surface,
    predicateIds: freezeStringValues(surface.predicateIds),
  }) as Readonly<T>;
}

export function createShareGrantConstraints(
  surface: ShareSurface,
): Required<Pick<CapabilityGrantConstraints, "rootEntityId" | "predicateIds">> {
  const definedSurface = defineShareSurface(surface);
  return Object.freeze({
    rootEntityId: definedSurface.rootEntityId,
    predicateIds: freezeStringValues(definedSurface.predicateIds),
  });
}

export function defineShareGrant<const T extends ShareGrant>(shareGrant: T): Readonly<T> {
  assertNonEmptyContractString(shareGrant.id, "id");
  assertNonEmptyContractString(shareGrant.capabilityGrantId, "capabilityGrantId");

  return Object.freeze({
    ...shareGrant,
    surface: defineShareSurface(shareGrant.surface),
  }) as Readonly<T>;
}

export function validateShareSurface(
  surface: ShareSurface,
  predicatePolicies: ShareSurfacePolicyLookup,
): ShareValidationResult {
  let definedSurface: Readonly<ShareSurface>;
  try {
    definedSurface = defineShareSurface(surface);
  } catch (error) {
    return shareValidationFailure("share.surface_invalid", asErrorMessage(error));
  }

  for (const predicateId of definedSurface.predicateIds) {
    const policy = getShareSurfacePolicy(predicatePolicies, predicateId);
    if (!policy) {
      return shareValidationFailure(
        "share.surface_invalid",
        `Share surface "${definedSurface.surfaceId}" cannot include predicate "${predicateId}" because no predicate policy was provided.`,
      );
    }
    if (policy.predicateId !== predicateId) {
      return shareValidationFailure(
        "share.surface_invalid",
        `Share surface "${definedSurface.surfaceId}" cannot include predicate "${predicateId}" because the provided policy targeted "${policy.predicateId}".`,
      );
    }
    if (!policy.shareable) {
      return shareValidationFailure(
        "share.surface_invalid",
        `Share surface "${definedSurface.surfaceId}" cannot include predicate "${predicateId}" because it is not shareable.`,
      );
    }
  }

  return { ok: true };
}

export function validateShareGrant(
  shareGrant: ShareGrant,
  capabilityGrant: ShareGrantCapabilityProjection,
): ShareValidationResult {
  let definedSurface: Readonly<ShareSurface>;
  try {
    definedSurface = defineShareSurface(shareGrant.surface);
  } catch (error) {
    return shareValidationFailure("share.surface_invalid", asErrorMessage(error));
  }

  try {
    assertNonEmptyContractString(shareGrant.id, "id");
    assertNonEmptyContractString(shareGrant.capabilityGrantId, "capabilityGrantId");
  } catch (error) {
    return shareValidationFailure("grant.invalid", asErrorMessage(error));
  }

  const definedShareGrant = Object.freeze({
    ...shareGrant,
    surface: definedSurface,
  }) as Readonly<ShareGrant>;

  if (capabilityGrant.id !== definedShareGrant.capabilityGrantId) {
    return shareValidationFailure(
      "grant.invalid",
      `Share grant "${definedShareGrant.id}" must reference capability grant "${capabilityGrant.id}".`,
    );
  }

  if (capabilityGrant.resource.kind !== "share-surface") {
    return shareValidationFailure(
      "grant.invalid",
      `Capability grant "${capabilityGrant.id}" must target a share-surface resource.`,
    );
  }

  if (capabilityGrant.resource.surfaceId !== definedShareGrant.surface.surfaceId) {
    return shareValidationFailure(
      "grant.invalid",
      `Capability grant "${capabilityGrant.id}" must target share surface "${definedShareGrant.surface.surfaceId}".`,
    );
  }

  if (capabilityGrant.status !== definedShareGrant.status) {
    return shareValidationFailure(
      "grant.invalid",
      `Share grant "${definedShareGrant.id}" must match capability grant "${capabilityGrant.id}" status "${capabilityGrant.status}".`,
    );
  }

  const constraints = capabilityGrant.constraints;
  if (!constraints?.rootEntityId) {
    return shareValidationFailure(
      "grant.invalid",
      `Capability grant "${capabilityGrant.id}" must constrain the shared root entity.`,
    );
  }
  if (constraints.rootEntityId !== definedShareGrant.surface.rootEntityId) {
    return shareValidationFailure(
      "grant.invalid",
      `Capability grant "${capabilityGrant.id}" must constrain root entity "${definedShareGrant.surface.rootEntityId}".`,
    );
  }
  if (!constraints.predicateIds || constraints.predicateIds.length === 0) {
    return shareValidationFailure(
      "grant.invalid",
      `Capability grant "${capabilityGrant.id}" must constrain the shared predicate set.`,
    );
  }

  try {
    assertUniqueContractStrings(
      constraints.predicateIds,
      "capabilityGrant.constraints.predicateIds",
    );
  } catch (error) {
    return shareValidationFailure("grant.invalid", asErrorMessage(error));
  }

  if (!matchesStringSet(constraints.predicateIds, definedShareGrant.surface.predicateIds)) {
    return shareValidationFailure(
      "grant.invalid",
      `Capability grant "${capabilityGrant.id}" must constrain the same predicate set as share grant "${definedShareGrant.id}".`,
    );
  }

  return { ok: true };
}

export type AuthorizationSubject = {
  readonly subjectId: string;
  readonly ownerPrincipalId?: string | null;
};

export type AuthorizationPredicateTarget = AuthorizationSubject & {
  readonly predicateId: string;
  readonly policy?: PredicatePolicyDescriptor | null;
};

export type AuthorizeReadInput = {
  readonly authorization: AuthorizationContext;
  readonly target: AuthorizationPredicateTarget;
  readonly capabilityKeys?: readonly PolicyCapabilityKey[];
  readonly sharedRead?: boolean;
};

export type AuthorizeWriteIntent = "transaction" | "command";

export type AuthorizeWriteInput = AuthorizeReadInput & {
  readonly writeScope: PredicatePolicyDescriptor["requiredWriteScope"];
  readonly intent?: AuthorizeWriteIntent;
};

export type AuthorizationCommandTouchedPredicate = AuthorizationPredicateTarget;

export type AuthorizeCommandInput = {
  readonly authorization: AuthorizationContext;
  readonly commandKey: string;
  readonly commandPolicy?: GraphCommandPolicy | null;
  readonly touchedPredicates?: readonly AuthorizationCommandTouchedPredicate[];
  readonly capabilityKeys?: readonly PolicyCapabilityKey[];
  readonly writeScope?: PredicatePolicyDescriptor["requiredWriteScope"];
};

/**
 * Stable manifest-facing permission identifier. Module approval, grant,
 * revocation, and install-plan surfaces all key off this value.
 */
export type ModulePermissionKey = string;

type ModulePermissionRequestBase = {
  readonly key: ModulePermissionKey;
  readonly reason: string;
  readonly required: boolean;
};

/**
 * Canonical install-time module permission request surface shared across
 * manifest loading, planning, and Branch 2 authorization lowering.
 */
export type ModulePermissionRequest =
  | (ModulePermissionRequestBase & {
      readonly kind: "predicate-read";
      readonly predicateIds: readonly string[];
    })
  | (ModulePermissionRequestBase & {
      readonly kind: "predicate-write";
      readonly predicateIds: readonly string[];
      readonly writeScope: PredicatePolicyDescriptor["requiredWriteScope"];
    })
  | (ModulePermissionRequestBase & {
      readonly kind: "command-execute";
      readonly commandKeys: readonly string[];
      readonly touchesPredicates?: readonly PredicatePolicyDescriptor["predicateId"][];
    })
  | (ModulePermissionRequestBase & {
      readonly kind: "secret-use";
      readonly capabilityKeys: readonly PolicyCapabilityKey[];
    })
  | (ModulePermissionRequestBase & {
      readonly kind: "share-admin";
      readonly surfaceIds?: readonly string[];
    })
  | (ModulePermissionRequestBase & {
      readonly kind: "external-service";
      readonly serviceKeys: readonly string[];
    })
  | (ModulePermissionRequestBase & {
      readonly kind: "background-job";
      readonly jobKeys: readonly string[];
    })
  | (ModulePermissionRequestBase & {
      readonly kind: "blob-class";
      readonly blobClassKeys: readonly string[];
    });

export type ModulePermissionGrantResource = Extract<
  CapabilityGrantResource,
  {
    readonly kind: "module-permission";
  }
>;

export type ModulePermissionCapabilityGrant = CapabilityGrant & {
  readonly resource: ModulePermissionGrantResource;
};

export type ModulePermissionLowering =
  | {
      readonly kind: "capability-grant";
      readonly grant: ModulePermissionCapabilityGrant;
    }
  | {
      readonly kind: "role-binding";
      readonly binding: PrincipalRoleBinding;
    };

export type ModulePermissionApprovalStatus = "approved" | "denied" | "revoked";

type ModulePermissionApprovalRecordBase = {
  readonly moduleId: string;
  readonly permissionKey: ModulePermissionKey;
  readonly request: ModulePermissionRequest;
  readonly decidedAt: string;
  readonly decidedByPrincipalId: string;
  readonly note?: string;
};

type ModulePermissionApprovalLowerings = readonly [
  ModulePermissionLowering,
  ...ModulePermissionLowering[],
];

/**
 * Durable authority-owned decision record for one declared module permission.
 * Approved permissions must lower to explicit grants or role bindings; denials
 * retain the reviewed request without creating ambient rights; revocation keeps
 * the original lowering references and records who revoked them.
 */
export type ModulePermissionApprovalRecord =
  | (ModulePermissionApprovalRecordBase & {
      readonly status: "approved";
      readonly lowerings: ModulePermissionApprovalLowerings;
      readonly revokedAt?: never;
      readonly revokedByPrincipalId?: never;
      readonly revocationNote?: never;
    })
  | (ModulePermissionApprovalRecordBase & {
      readonly status: "denied";
      readonly lowerings: readonly [];
      readonly revokedAt?: never;
      readonly revokedByPrincipalId?: never;
      readonly revocationNote?: never;
    })
  | (ModulePermissionApprovalRecordBase & {
      readonly status: "revoked";
      readonly lowerings: ModulePermissionApprovalLowerings;
      readonly revokedAt: string;
      readonly revokedByPrincipalId: string;
      readonly revocationNote?: string;
    });

export type ObjectViewFieldSpec = {
  readonly path: string;
  readonly label?: string;
  readonly description?: string;
  readonly span?: 1 | 2;
};

export type ObjectViewSectionSpec = {
  readonly key: string;
  readonly title: string;
  readonly description?: string;
  readonly fields: readonly ObjectViewFieldSpec[];
};

export type ObjectViewRelatedSpec = {
  readonly key: string;
  readonly title: string;
  readonly relationPath: string;
  readonly presentation: "list" | "table" | "board";
};

export type ObjectViewSpec = {
  readonly key: string;
  readonly entity: string;
  readonly titleField?: string;
  readonly subtitleField?: string;
  readonly sections: readonly ObjectViewSectionSpec[];
  readonly related?: readonly ObjectViewRelatedSpec[];
  readonly commands?: readonly string[];
};

export type WorkflowStepSpec = {
  readonly key: string;
  readonly title: string;
  readonly description?: string;
  readonly objectView?: string;
  readonly command?: string;
};

export type WorkflowSpec = {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly subjects: readonly string[];
  readonly steps: readonly WorkflowStepSpec[];
  readonly commands?: readonly string[];
};

export type GraphCommandExecution = "localOnly" | "optimisticVerify" | "serverOnly";

export type GraphCommandTouchedPredicate = Pick<PredicatePolicyDescriptor, "predicateId">;

export type GraphCommandPolicy = {
  readonly capabilities?: readonly PolicyCapabilityKey[];
  readonly touchesPredicates?: readonly GraphCommandTouchedPredicate[];
};

export type GraphCommandSpec<Input = unknown, Output = unknown> = {
  readonly key: string;
  readonly label: string;
  readonly subject?: string;
  readonly execution: GraphCommandExecution;
  readonly input: Input;
  readonly output: Output;
  readonly policy?: GraphCommandPolicy;
};
