import type { PolicyCapabilityKey, PredicatePolicyDescriptor } from "@io/graph-kernel";

/**
 * Stable graph-owned principal kinds.
 */
export type PrincipalKind = "human" | "service" | "agent" | "anonymous" | "remoteGraph";

/**
 * Monotonic principal-scoped capability snapshot version.
 */
export type CapabilityVersion = number;

/**
 * Monotonic graph-scoped authorization policy snapshot version.
 */
export type PolicyVersion = number;

/**
 * Stable request-bound authorization snapshot consumed by authority read,
 * write, command, and replication filtering paths.
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
 * Stable delegated-capability vocabulary shared by graph schema and authority
 * runtime consumers.
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
 */
export const shareSurfaceContractVersion = 0;

export type ShareSurfaceKind = (typeof shareSurfaceKinds)[number];

/**
 * First-cut durable share surface for one rooted entity plus one predicate set.
 */
export type ShareSurface = {
  readonly surfaceId: string;
  readonly kind: "entity-predicate-slice";
  readonly rootEntityId: string;
  readonly predicateIds: readonly string[];
};

export type ShareGrantStatus = CapabilityGrantStatus;

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
 * Graph-owned admission policy enforced by the authority boundary.
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

function assertKnownContractValue<const T extends readonly string[]>(
  values: T,
  value: string,
  label: string,
): asserts value is T[number] {
  if (!(values as readonly string[]).includes(value)) {
    throw new TypeError(`${label} must be one of ${values.join(", ")}.`);
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
 * Stable browser-visible shell session states. `booting` is client-local while
 * the shell is still resolving whether it can fetch a principal summary.
 */
export type WebPrincipalSessionState = "booting" | "signed-out" | "ready" | "expired";

/**
 * Stable minimal browser-visible session contract shared by app shells and
 * tools.
 */
export type WebPrincipalSession = {
  readonly authState: WebPrincipalSessionState;
  readonly sessionId: string | null;
  readonly principalId: string | null;
  readonly capabilityVersion: CapabilityVersion | null;
  readonly displayName?: string;
};

/**
 * Stable graph-backed principal summary derived from request-bound authority
 * state for browser/bootstrap consumers.
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
 */
export type WebPrincipalBootstrapPayload = {
  readonly session: WebPrincipalSession;
  readonly principal: WebPrincipalSummary | null;
};

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
 * manifest loading, planning, and module-install flows.
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
      readonly touchesPredicates?: readonly GraphCommandTouchedPredicate["predicateId"][];
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
 * Durable authority decision record for one declared module permission.
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

export const installedModuleSourceKinds = ["built-in", "local"] as const;

/**
 * First authoritative installed-module source vocabulary shared by built-in and
 * local module ledgers.
 */
export type InstalledModuleSourceKind = (typeof installedModuleSourceKinds)[number];

/**
 * Stable source linkage persisted with one installed-module ledger row.
 *
 * `specifier` and `exportName` mirror the authored manifest identity so later
 * rebuild work can resolve the intended bundle without repo-local hidden
 * wiring.
 */
export type InstalledModuleSource = {
  readonly kind: InstalledModuleSourceKind;
  readonly specifier: string;
  readonly exportName: string;
};

/**
 * Snapshot of the compatibility channels the authority accepted for the
 * installed module version.
 */
export type InstalledModuleCompatibility = {
  readonly graph: string;
  readonly runtime: string;
};

/**
 * Planner-facing bundle identity for one candidate installed-module target.
 *
 * Callers derive this from the authored manifest plus the concrete bundle
 * digest they intend to activate.
 */
export type InstalledModuleTarget = {
  readonly moduleId: string;
  readonly version: string;
  readonly bundleDigest: string;
  readonly source: InstalledModuleSource;
  readonly compatibility: InstalledModuleCompatibility;
};

/**
 * Runtime channels a planner must recognize before it can accept a module
 * target. Unknown or unsupported channels fail closed instead of being
 * guessed.
 */
export type InstalledModuleRuntimeExpectation = {
  readonly graph: string;
  readonly runtime: string;
  readonly supportedSourceKinds?: readonly InstalledModuleSourceKind[];
};

/**
 * Change summary between the planner target and the currently installed row.
 */
export type InstalledModuleCompatibilityChangeSet = {
  readonly versionChanged: boolean;
  readonly bundleDigestChanged: boolean;
  readonly sourceChanged: boolean;
  readonly compatibilityChanged: boolean;
};

export type InstalledModuleCompatibilityStatus =
  | "new-install"
  | "matches-record"
  | "replaces-record";

export type InstalledModuleCompatibilityErrorCode =
  | "module.target_invalid"
  | "module.record_invalid"
  | "module.runtime_invalid"
  | "module.identity_mismatch"
  | "module.graph_incompatible"
  | "module.runtime_incompatible"
  | "module.source_kind_unsupported";

export type InstalledModuleCompatibilityResult =
  | {
      readonly ok: true;
      readonly status: InstalledModuleCompatibilityStatus;
      readonly target: Readonly<InstalledModuleTarget>;
      readonly record: Readonly<InstalledModuleRecord> | null;
      readonly runtime: Readonly<InstalledModuleRuntimeExpectation> | null;
      readonly changes: Readonly<InstalledModuleCompatibilityChangeSet>;
    }
  | {
      readonly ok: false;
      readonly code: InstalledModuleCompatibilityErrorCode;
      readonly message: string;
      readonly recovery: string;
    };

export const installedModuleInstallStates = [
  "installing",
  "installed",
  "uninstalling",
  "failed",
] as const;

/**
 * Authoritative ledger lifecycle for one installed module row.
 *
 * Activation remains a separate nested contract so a module can stay installed
 * while inactive or activation-failed.
 */
export type InstalledModuleInstallState = (typeof installedModuleInstallStates)[number];

export const installedModuleDesiredStates = ["active", "inactive"] as const;

/**
 * Operator-intended activation target for one installed module.
 */
export type InstalledModuleDesiredState = (typeof installedModuleDesiredStates)[number];

export const installedModuleActivationStatuses = [
  "activating",
  "active",
  "deactivating",
  "inactive",
  "failed",
] as const;

/**
 * Observed activation status derived from the authoritative ledger plus the
 * latest runtime rebuild or activation attempt.
 */
export type InstalledModuleActivationStatus = (typeof installedModuleActivationStatuses)[number];

export const installedModuleFailureStages = [
  "install",
  "activate",
  "deactivate",
  "rebuild",
  "uninstall",
] as const;

export type InstalledModuleFailureStage = (typeof installedModuleFailureStages)[number];

/**
 * Stable failure metadata attached to the latest failed install or activation
 * attempt.
 */
export type InstalledModuleFailure = {
  readonly stage: InstalledModuleFailureStage;
  readonly code: string;
  readonly message: string;
  readonly observedAt: string;
};

export const installedModulePlanActions = ["install", "activate", "deactivate", "update"] as const;

export type InstalledModulePlanAction = (typeof installedModulePlanActions)[number];

export const installedModulePlanNoopReasons = [
  "already-active",
  "already-inactive",
  "no-change",
] as const;

export type InstalledModulePlanNoopReason = (typeof installedModulePlanNoopReasons)[number];

export type InstalledModulePlanErrorCode =
  | InstalledModuleCompatibilityErrorCode
  | "module.target_missing"
  | "module.record_missing"
  | "module.record_unexpected"
  | "module.runtime_missing"
  | "module.state_incompatible";

export type InstalledModulePlanState = {
  readonly installState: InstalledModuleInstallState;
  readonly activation: {
    readonly desired: InstalledModuleDesiredState;
    readonly status: InstalledModuleActivationStatus;
  };
};

export type InstalledModulePlannedFailureState = {
  readonly installState: "failed";
  readonly activation: {
    readonly desired: InstalledModuleDesiredState;
    readonly status: "failed";
  };
  readonly failureStage: InstalledModuleFailureStage;
};

export type InstalledModuleVersionTransition = {
  readonly fromVersion: string | null;
  readonly toVersion: string | null;
  readonly requiresMigration: boolean;
};

export type InstalledModuleLifecyclePlanInput = {
  readonly action: InstalledModulePlanAction;
  readonly target?: InstalledModuleTarget | null;
  readonly record?: InstalledModuleRecord | null;
  readonly runtime?: InstalledModuleRuntimeExpectation | null;
};

export type InstalledModulePlanResult =
  | {
      readonly ok: true;
      readonly action: InstalledModulePlanAction;
      readonly disposition: "apply";
      readonly target: Readonly<InstalledModuleTarget> | null;
      readonly record: Readonly<InstalledModuleRecord> | null;
      readonly compatibility: Extract<
        InstalledModuleCompatibilityResult,
        { readonly ok: true }
      > | null;
      readonly pending: Readonly<InstalledModulePlanState>;
      readonly success: Readonly<InstalledModulePlanState>;
      readonly failure: Readonly<InstalledModulePlannedFailureState>;
      readonly preserveCurrentRuntimeUntilSuccess: boolean;
      readonly versionTransition: Readonly<InstalledModuleVersionTransition>;
      readonly recovery: string;
    }
  | {
      readonly ok: true;
      readonly action: InstalledModulePlanAction;
      readonly disposition: "noop";
      readonly target: Readonly<InstalledModuleTarget> | null;
      readonly record: Readonly<InstalledModuleRecord> | null;
      readonly compatibility: Extract<
        InstalledModuleCompatibilityResult,
        { readonly ok: true }
      > | null;
      readonly reason: InstalledModulePlanNoopReason;
      readonly recovery: string;
    }
  | {
      readonly ok: false;
      readonly action: InstalledModulePlanAction;
      readonly code: InstalledModulePlanErrorCode;
      readonly message: string;
      readonly recovery: string;
    };

type InstalledModuleActivationStateBase = {
  readonly desired: InstalledModuleDesiredState;
  readonly status: InstalledModuleActivationStatus;
  readonly changedAt: string;
};

/**
 * Explicit activation-state contract stored beside one installed module row.
 */
export type InstalledModuleActivationState =
  | (InstalledModuleActivationStateBase & {
      readonly desired: "active";
      readonly status: "activating" | "active";
      readonly failure?: never;
    })
  | (InstalledModuleActivationStateBase & {
      readonly desired: "inactive";
      readonly status: "deactivating" | "inactive";
      readonly failure?: never;
    })
  | (InstalledModuleActivationStateBase & {
      readonly desired: InstalledModuleDesiredState;
      readonly status: "failed";
      readonly failure: InstalledModuleFailure;
    });

/**
 * Authoritative installed-module ledger row suitable for rebuildable runtime
 * activation.
 */
export type InstalledModuleRecord = {
  readonly moduleId: string;
  readonly version: string;
  readonly bundleDigest: string;
  readonly source: InstalledModuleSource;
  readonly compatibility: InstalledModuleCompatibility;
  readonly installState: InstalledModuleInstallState;
  readonly activation: InstalledModuleActivationState;
  readonly grantedPermissionKeys: readonly ModulePermissionKey[];
  readonly installedAt?: string;
  readonly updatedAt: string;
  readonly lastSuccessfulMigrationVersion?: string;
};

function defineInstalledModuleFailure<const T extends InstalledModuleFailure>(
  failure: T,
): Readonly<T> {
  assertKnownContractValue(installedModuleFailureStages, failure.stage, "failure.stage");
  assertNonEmptyContractString(failure.code, "failure.code");
  assertNonEmptyContractString(failure.message, "failure.message");
  assertNonEmptyContractString(failure.observedAt, "failure.observedAt");
  return Object.freeze({ ...failure }) as Readonly<T>;
}

function defineInstalledModuleSource<const T extends InstalledModuleSource>(
  source: T,
): Readonly<T> {
  assertKnownContractValue(installedModuleSourceKinds, source.kind, "source.kind");
  assertNonEmptyContractString(source.specifier, "source.specifier");
  assertNonEmptyContractString(source.exportName, "source.exportName");
  return Object.freeze({ ...source }) as Readonly<T>;
}

function defineInstalledModuleCompatibility<const T extends InstalledModuleCompatibility>(
  compatibility: T,
): Readonly<T> {
  assertNonEmptyContractString(compatibility.graph, "compatibility.graph");
  assertNonEmptyContractString(compatibility.runtime, "compatibility.runtime");
  return Object.freeze({ ...compatibility }) as Readonly<T>;
}

export function defineInstalledModuleTarget<const T extends InstalledModuleTarget>(
  target: T,
): Readonly<T> {
  assertNonEmptyContractString(target.moduleId, "moduleId");
  assertNonEmptyContractString(target.version, "version");
  assertNonEmptyContractString(target.bundleDigest, "bundleDigest");

  return Object.freeze({
    ...target,
    source: defineInstalledModuleSource(target.source),
    compatibility: defineInstalledModuleCompatibility(target.compatibility),
  }) as Readonly<T>;
}

export function defineInstalledModuleRuntimeExpectation<
  const T extends InstalledModuleRuntimeExpectation,
>(runtime: T): Readonly<T> {
  assertNonEmptyContractString(runtime.graph, "graph");
  assertNonEmptyContractString(runtime.runtime, "runtime");
  const supportedSourceKinds = runtime.supportedSourceKinds;
  if (supportedSourceKinds !== undefined) {
    assertUniqueContractStrings(supportedSourceKinds, "supportedSourceKinds");
    for (const sourceKind of supportedSourceKinds) {
      assertKnownContractValue(installedModuleSourceKinds, sourceKind, "supportedSourceKinds");
    }
  }

  return Object.freeze({
    ...runtime,
    ...(supportedSourceKinds
      ? { supportedSourceKinds: freezeStringValues(supportedSourceKinds) }
      : {}),
  }) as Readonly<T>;
}

export function defineInstalledModuleActivationState<
  const T extends InstalledModuleActivationState,
>(activation: T): Readonly<T> {
  assertKnownContractValue(installedModuleDesiredStates, activation.desired, "activation.desired");
  assertKnownContractValue(
    installedModuleActivationStatuses,
    activation.status,
    "activation.status",
  );
  assertNonEmptyContractString(activation.changedAt, "activation.changedAt");

  const status = activation.status;
  const failure =
    "failure" in activation && activation.failure
      ? defineInstalledModuleFailure(activation.failure)
      : undefined;

  switch (status) {
    case "activating":
    case "active":
      if (activation.desired !== "active") {
        throw new TypeError(
          `activation.desired must be "active" when activation.status is "${status}".`,
        );
      }
      if (failure) {
        throw new TypeError(
          `activation.failure must be omitted when activation.status is "${status}".`,
        );
      }
      break;
    case "deactivating":
    case "inactive":
      if (activation.desired !== "inactive") {
        throw new TypeError(
          `activation.desired must be "inactive" when activation.status is "${status}".`,
        );
      }
      if (failure) {
        throw new TypeError(
          `activation.failure must be omitted when activation.status is "${status}".`,
        );
      }
      break;
    case "failed":
      if (!failure) {
        throw new TypeError(
          'activation.failure must be present when activation.status is "failed".',
        );
      }
      break;
  }

  return Object.freeze({
    ...activation,
    ...(failure ? { failure } : {}),
  }) as Readonly<T>;
}

export function defineInstalledModuleRecord<const T extends InstalledModuleRecord>(
  record: T,
): Readonly<T> {
  assertNonEmptyContractString(record.moduleId, "moduleId");
  assertNonEmptyContractString(record.version, "version");
  assertNonEmptyContractString(record.bundleDigest, "bundleDigest");
  assertKnownContractValue(installedModuleInstallStates, record.installState, "installState");
  assertNonEmptyContractString(record.updatedAt, "updatedAt");
  if (record.installedAt !== undefined) {
    assertNonEmptyContractString(record.installedAt, "installedAt");
  }
  if (record.lastSuccessfulMigrationVersion !== undefined) {
    assertNonEmptyContractString(
      record.lastSuccessfulMigrationVersion,
      "lastSuccessfulMigrationVersion",
    );
  }
  assertUniqueContractStrings(record.grantedPermissionKeys, "grantedPermissionKeys");

  const source = defineInstalledModuleSource(record.source);
  const compatibility = defineInstalledModuleCompatibility(record.compatibility);
  const activation = defineInstalledModuleActivationState(record.activation);

  if (record.installState === "failed" && activation.status !== "failed") {
    throw new TypeError('activation.status must be "failed" when installState is "failed".');
  }
  if (record.installState === "uninstalling" && activation.desired !== "inactive") {
    throw new TypeError(
      'activation.desired must be "inactive" when installState is "uninstalling".',
    );
  }

  return Object.freeze({
    ...record,
    source,
    compatibility,
    activation,
    grantedPermissionKeys: freezeStringValues(record.grantedPermissionKeys),
  }) as Readonly<T>;
}

function installedModuleCompatibilityFailure(
  code: InstalledModuleCompatibilityErrorCode,
  message: string,
  recovery: string,
): InstalledModuleCompatibilityResult {
  return {
    ok: false,
    code,
    message,
    recovery,
  };
}

function planInstalledModuleFailure(
  action: InstalledModulePlanAction,
  code: InstalledModulePlanErrorCode,
  message: string,
  recovery: string,
): InstalledModulePlanResult {
  return {
    ok: false,
    action,
    code,
    message,
    recovery,
  };
}

function createInstalledModulePlanState(
  installState: InstalledModuleInstallState,
  desired: InstalledModuleDesiredState,
  status: InstalledModuleActivationStatus,
): Readonly<InstalledModulePlanState> {
  return Object.freeze({
    installState,
    activation: Object.freeze({
      desired,
      status,
    }),
  });
}

function createInstalledModulePlannedFailureState(
  desired: InstalledModuleDesiredState,
  failureStage: InstalledModuleFailureStage,
): Readonly<InstalledModulePlannedFailureState> {
  return Object.freeze({
    installState: "failed",
    activation: Object.freeze({
      desired,
      status: "failed",
    }),
    failureStage,
  });
}

function createInstalledModuleVersionTransition(
  fromVersion: string | null,
  toVersion: string | null,
  requiresMigration: boolean,
): Readonly<InstalledModuleVersionTransition> {
  return Object.freeze({
    fromVersion,
    toVersion,
    requiresMigration,
  });
}

function createInstalledModuleApplyPlan(input: {
  readonly action: InstalledModulePlanAction;
  readonly target: Readonly<InstalledModuleTarget> | null;
  readonly record: Readonly<InstalledModuleRecord> | null;
  readonly compatibility: Extract<InstalledModuleCompatibilityResult, { readonly ok: true }> | null;
  readonly pending: Readonly<InstalledModulePlanState>;
  readonly success: Readonly<InstalledModulePlanState>;
  readonly failure: Readonly<InstalledModulePlannedFailureState>;
  readonly preserveCurrentRuntimeUntilSuccess: boolean;
  readonly versionTransition: Readonly<InstalledModuleVersionTransition>;
  readonly recovery: string;
}): InstalledModulePlanResult {
  return Object.freeze({
    ok: true,
    action: input.action,
    disposition: "apply",
    target: input.target,
    record: input.record,
    compatibility: input.compatibility,
    pending: input.pending,
    success: input.success,
    failure: input.failure,
    preserveCurrentRuntimeUntilSuccess: input.preserveCurrentRuntimeUntilSuccess,
    versionTransition: input.versionTransition,
    recovery: input.recovery,
  });
}

function createInstalledModuleNoopPlan(input: {
  readonly action: InstalledModulePlanAction;
  readonly target: Readonly<InstalledModuleTarget> | null;
  readonly record: Readonly<InstalledModuleRecord> | null;
  readonly compatibility: Extract<InstalledModuleCompatibilityResult, { readonly ok: true }> | null;
  readonly reason: InstalledModulePlanNoopReason;
  readonly recovery: string;
}): InstalledModulePlanResult {
  return Object.freeze({
    ok: true,
    action: input.action,
    disposition: "noop",
    target: input.target,
    record: input.record,
    compatibility: input.compatibility,
    reason: input.reason,
    recovery: input.recovery,
  });
}

function matchesInstalledModuleSource(
  left: InstalledModuleSource,
  right: InstalledModuleSource,
): boolean {
  return (
    left.kind === right.kind &&
    left.specifier === right.specifier &&
    left.exportName === right.exportName
  );
}

function matchesInstalledModuleCompatibility(
  left: InstalledModuleCompatibility,
  right: InstalledModuleCompatibility,
): boolean {
  return left.graph === right.graph && left.runtime === right.runtime;
}

function isInstalledModuleTransitionInFlight(record: Readonly<InstalledModuleRecord>): boolean {
  return (
    record.installState === "installing" ||
    record.installState === "uninstalling" ||
    record.activation.status === "activating" ||
    record.activation.status === "deactivating"
  );
}

function canRetryInstalledModuleWithoutReplacement(
  record: Readonly<InstalledModuleRecord>,
): boolean {
  return record.activation.status === "failed" && record.activation.failure.stage !== "install";
}

function requireRuntimeExpectation(
  action: InstalledModulePlanAction,
  runtime: InstalledModuleRuntimeExpectation | null | undefined,
): InstalledModulePlanResult | null {
  if (runtime !== undefined && runtime !== null) {
    return null;
  }

  return planInstalledModuleFailure(
    action,
    "module.runtime_missing",
    `Planning "${action}" requires an explicit runtime expectation.`,
    "Load the current runtime compatibility channels before retrying this plan.",
  );
}

export function validateInstalledModuleCompatibility(input: {
  readonly target: InstalledModuleTarget;
  readonly record?: InstalledModuleRecord | null;
  readonly runtime?: InstalledModuleRuntimeExpectation | null;
}): InstalledModuleCompatibilityResult {
  let target: Readonly<InstalledModuleTarget>;
  try {
    target = defineInstalledModuleTarget(input.target);
  } catch (error) {
    return installedModuleCompatibilityFailure(
      "module.target_invalid",
      asErrorMessage(error),
      "Repair the module manifest or bundle metadata and retry compatibility validation.",
    );
  }

  let record: Readonly<InstalledModuleRecord> | null = null;
  if (input.record !== undefined && input.record !== null) {
    try {
      record = defineInstalledModuleRecord(input.record);
    } catch (error) {
      return installedModuleCompatibilityFailure(
        "module.record_invalid",
        asErrorMessage(error),
        "Repair the installed-module ledger row before planning module lifecycle changes.",
      );
    }
  }

  let runtime: Readonly<InstalledModuleRuntimeExpectation> | null = null;
  if (input.runtime !== undefined && input.runtime !== null) {
    try {
      runtime = defineInstalledModuleRuntimeExpectation(input.runtime);
    } catch (error) {
      return installedModuleCompatibilityFailure(
        "module.runtime_invalid",
        asErrorMessage(error),
        "Repair the runtime expectation contract before validating module compatibility.",
      );
    }
  }

  if (record && record.moduleId !== target.moduleId) {
    return installedModuleCompatibilityFailure(
      "module.identity_mismatch",
      `Installed module record "${record.moduleId}" does not match target module "${target.moduleId}".`,
      "Load the installed row for the same module id or plan a different module lifecycle action.",
    );
  }

  if (runtime?.supportedSourceKinds && !runtime.supportedSourceKinds.includes(target.source.kind)) {
    return installedModuleCompatibilityFailure(
      "module.source_kind_unsupported",
      `Module target "${target.moduleId}@${target.version}" uses source kind "${target.source.kind}" but the runtime only accepts ${runtime.supportedSourceKinds.join(", ")}.`,
      "Choose a supported source kind or widen the runtime expectation before retrying this plan.",
    );
  }

  if (runtime && target.compatibility.graph !== runtime.graph) {
    return installedModuleCompatibilityFailure(
      "module.graph_incompatible",
      `Module target "${target.moduleId}@${target.version}" declares graph compatibility "${target.compatibility.graph}" but the runtime expects "${runtime.graph}".`,
      "Load a module bundle that matches the current graph contract or upgrade the runtime before retrying.",
    );
  }

  if (runtime && target.compatibility.runtime !== runtime.runtime) {
    return installedModuleCompatibilityFailure(
      "module.runtime_incompatible",
      `Module target "${target.moduleId}@${target.version}" declares runtime compatibility "${target.compatibility.runtime}" but the runtime expects "${runtime.runtime}".`,
      "Load a module bundle that matches the current runtime contract or upgrade the runtime before retrying.",
    );
  }

  const changes = Object.freeze({
    versionChanged: record ? target.version !== record.version : false,
    bundleDigestChanged: record ? target.bundleDigest !== record.bundleDigest : false,
    sourceChanged: record ? !matchesInstalledModuleSource(target.source, record.source) : false,
    compatibilityChanged: record
      ? !matchesInstalledModuleCompatibility(target.compatibility, record.compatibility)
      : false,
  });

  return {
    ok: true,
    status:
      record === null
        ? "new-install"
        : changes.versionChanged ||
            changes.bundleDigestChanged ||
            changes.sourceChanged ||
            changes.compatibilityChanged
          ? "replaces-record"
          : "matches-record",
    target,
    record,
    runtime,
    changes,
  };
}

export function planInstalledModuleLifecycle(
  input: InstalledModuleLifecyclePlanInput,
): InstalledModulePlanResult {
  assertKnownContractValue(installedModulePlanActions, input.action, "action");

  switch (input.action) {
    case "install": {
      if (!input.target) {
        return planInstalledModuleFailure(
          "install",
          "module.target_missing",
          'Planning "install" requires a target module manifest and bundle digest.',
          "Load the module manifest plus bundle digest before retrying the install plan.",
        );
      }
      const runtimeMissing = requireRuntimeExpectation("install", input.runtime);
      if (runtimeMissing) {
        return runtimeMissing;
      }
      if (input.record) {
        return planInstalledModuleFailure(
          "install",
          "module.record_unexpected",
          `Module "${input.record.moduleId}" already has an installed-module row. Install planning does not overwrite existing rows.`,
          "Use activate, deactivate, or update against the existing row instead of planning a second install.",
        );
      }
      const compatibility = validateInstalledModuleCompatibility({
        target: input.target,
        runtime: input.runtime ?? null,
      });
      if (!compatibility.ok) {
        return planInstalledModuleFailure(
          "install",
          compatibility.code,
          compatibility.message,
          compatibility.recovery,
        );
      }
      return createInstalledModuleApplyPlan({
        action: "install",
        target: compatibility.target,
        record: null,
        compatibility,
        pending: createInstalledModulePlanState("installing", "active", "activating"),
        success: createInstalledModulePlanState("installed", "active", "active"),
        failure: createInstalledModulePlannedFailureState("active", "install"),
        preserveCurrentRuntimeUntilSuccess: false,
        versionTransition: createInstalledModuleVersionTransition(
          null,
          compatibility.target.version,
          false,
        ),
        recovery:
          "If install application fails, keep the failed row authoritative, repair the bundle or runtime mismatch, and retry the same install instead of creating a duplicate row.",
      });
    }

    case "activate": {
      if (!input.record) {
        return planInstalledModuleFailure(
          "activate",
          "module.record_missing",
          'Planning "activate" requires an existing installed-module row.',
          "Load the installed-module row for the target module before retrying activation planning.",
        );
      }
      if (!input.target) {
        return planInstalledModuleFailure(
          "activate",
          "module.target_missing",
          'Planning "activate" requires the target manifest and bundle digest for the installed module.',
          "Load the current manifest plus bundle digest before retrying activation planning.",
        );
      }
      const runtimeMissing = requireRuntimeExpectation("activate", input.runtime);
      if (runtimeMissing) {
        return runtimeMissing;
      }
      const compatibility = validateInstalledModuleCompatibility({
        target: input.target,
        record: input.record,
        runtime: input.runtime ?? null,
      });
      if (!compatibility.ok) {
        return planInstalledModuleFailure(
          "activate",
          compatibility.code,
          compatibility.message,
          compatibility.recovery,
        );
      }
      const record = compatibility.record;
      if (record === null) {
        return planInstalledModuleFailure(
          "activate",
          "module.record_missing",
          'Planning "activate" requires an existing installed-module row.',
          "Load the installed-module row for the target module before retrying activation planning.",
        );
      }
      if (compatibility.status !== "matches-record") {
        return planInstalledModuleFailure(
          "activate",
          "module.state_incompatible",
          `Activate planning only applies to the current installed bundle for "${record.moduleId}". Version, source, digest, or compatibility drift must use update planning.`,
          "Plan an update for replacement bundles before attempting to activate them.",
        );
      }
      if (isInstalledModuleTransitionInFlight(record)) {
        return planInstalledModuleFailure(
          "activate",
          "module.state_incompatible",
          `Module "${record.moduleId}" is already mid-transition (${record.installState}, ${record.activation.status}). Activation planning fails closed until the row reaches a stable state.`,
          "Wait for the current transition to finish or repair the row into a stable active, inactive, or failed state before retrying.",
        );
      }
      if (record.installState === "failed" && !canRetryInstalledModuleWithoutReplacement(record)) {
        return planInstalledModuleFailure(
          "activate",
          "module.state_incompatible",
          `Module "${record.moduleId}" failed during install and cannot be activated without a successful replacement or recovery install.`,
          "Repair the install failure first, or plan an update that replaces the failed bundle before retrying activation.",
        );
      }
      if (
        record.installState === "installed" &&
        record.activation.desired === "active" &&
        record.activation.status === "active"
      ) {
        return createInstalledModuleNoopPlan({
          action: "activate",
          target: compatibility.target,
          record,
          compatibility,
          reason: "already-active",
          recovery:
            "No further action is required unless the module target changes or the installed row later falls out of a stable active state.",
        });
      }
      return createInstalledModuleApplyPlan({
        action: "activate",
        target: compatibility.target,
        record,
        compatibility,
        pending: createInstalledModulePlanState("installed", "active", "activating"),
        success: createInstalledModulePlanState("installed", "active", "active"),
        failure: createInstalledModulePlannedFailureState("active", "activate"),
        preserveCurrentRuntimeUntilSuccess: false,
        versionTransition: createInstalledModuleVersionTransition(
          record.version,
          record.version,
          false,
        ),
        recovery:
          "If activation fails, keep the row failed, inspect the recorded activation or rebuild error, and retry activate or update after fixing the runtime blocker.",
      });
    }

    case "deactivate": {
      if (!input.record) {
        return planInstalledModuleFailure(
          "deactivate",
          "module.record_missing",
          'Planning "deactivate" requires an existing installed-module row.',
          "Load the installed-module row for the target module before retrying deactivation planning.",
        );
      }
      let compatibility: Extract<InstalledModuleCompatibilityResult, { readonly ok: true }> | null =
        null;
      if (input.target) {
        const compatibilityResult = validateInstalledModuleCompatibility({
          target: input.target,
          record: input.record,
        });
        if (!compatibilityResult.ok) {
          return planInstalledModuleFailure(
            "deactivate",
            compatibilityResult.code,
            compatibilityResult.message,
            compatibilityResult.recovery,
          );
        }
        if (compatibilityResult.status !== "matches-record") {
          return planInstalledModuleFailure(
            "deactivate",
            "module.state_incompatible",
            `Deactivate planning only applies to the currently installed bundle for "${compatibilityResult.record?.moduleId ?? input.record.moduleId}".`,
            "Plan an update for replacement bundles instead of trying to deactivate a different target.",
          );
        }
        compatibility = compatibilityResult;
      }
      const record = defineInstalledModuleRecord(input.record);
      if (isInstalledModuleTransitionInFlight(record)) {
        return planInstalledModuleFailure(
          "deactivate",
          "module.state_incompatible",
          `Module "${record.moduleId}" is already mid-transition (${record.installState}, ${record.activation.status}). Deactivation planning fails closed until the row reaches a stable state.`,
          "Wait for the current transition to finish or repair the row into a stable active, inactive, or failed state before retrying.",
        );
      }
      if (record.installState === "failed" && !canRetryInstalledModuleWithoutReplacement(record)) {
        return planInstalledModuleFailure(
          "deactivate",
          "module.state_incompatible",
          `Module "${record.moduleId}" failed during install and cannot be deactivated because no stable installed bundle is available.`,
          "Repair the install failure first, or plan an update that replaces the failed bundle before retrying deactivation.",
        );
      }
      if (
        record.installState === "installed" &&
        record.activation.desired === "inactive" &&
        record.activation.status === "inactive"
      ) {
        return createInstalledModuleNoopPlan({
          action: "deactivate",
          target: compatibility?.target ?? null,
          record,
          compatibility,
          reason: "already-inactive",
          recovery:
            "No further action is required unless the module is reactivated or replaced by an update.",
        });
      }
      return createInstalledModuleApplyPlan({
        action: "deactivate",
        target: compatibility?.target ?? null,
        record,
        compatibility,
        pending: createInstalledModulePlanState("installed", "inactive", "deactivating"),
        success: createInstalledModulePlanState("installed", "inactive", "inactive"),
        failure: createInstalledModulePlannedFailureState("inactive", "deactivate"),
        preserveCurrentRuntimeUntilSuccess: false,
        versionTransition: createInstalledModuleVersionTransition(
          record.version,
          record.version,
          false,
        ),
        recovery:
          "If deactivation fails, keep the row failed, inspect the runtime teardown error, and retry deactivation or plan an update after the blocker is fixed.",
      });
    }

    case "update": {
      if (!input.record) {
        return planInstalledModuleFailure(
          "update",
          "module.record_missing",
          'Planning "update" requires an existing installed-module row.',
          "Load the installed-module row for the target module before retrying update planning.",
        );
      }
      if (!input.target) {
        return planInstalledModuleFailure(
          "update",
          "module.target_missing",
          'Planning "update" requires the replacement manifest and bundle digest.',
          "Load the replacement manifest plus bundle digest before retrying update planning.",
        );
      }
      const runtimeMissing = requireRuntimeExpectation("update", input.runtime);
      if (runtimeMissing) {
        return runtimeMissing;
      }
      const compatibility = validateInstalledModuleCompatibility({
        target: input.target,
        record: input.record,
        runtime: input.runtime ?? null,
      });
      if (!compatibility.ok) {
        return planInstalledModuleFailure(
          "update",
          compatibility.code,
          compatibility.message,
          compatibility.recovery,
        );
      }
      const record = compatibility.record;
      if (record === null) {
        return planInstalledModuleFailure(
          "update",
          "module.record_missing",
          'Planning "update" requires an existing installed-module row.',
          "Load the installed-module row for the target module before retrying update planning.",
        );
      }
      if (isInstalledModuleTransitionInFlight(record)) {
        return planInstalledModuleFailure(
          "update",
          "module.state_incompatible",
          `Module "${record.moduleId}" is already mid-transition (${record.installState}, ${record.activation.status}). Update planning fails closed until the row reaches a stable state.`,
          "Wait for the current transition to finish or repair the row into a stable active, inactive, or failed state before retrying.",
        );
      }
      if (
        compatibility.status === "matches-record" &&
        record.installState === "installed" &&
        record.activation.status !== "failed"
      ) {
        return createInstalledModuleNoopPlan({
          action: "update",
          target: compatibility.target,
          record,
          compatibility,
          reason: "no-change",
          recovery:
            "No further action is required unless the replacement target changes or the installed row later enters a failed state.",
        });
      }
      const desired = record.activation.desired;
      return createInstalledModuleApplyPlan({
        action: "update",
        target: compatibility.target,
        record,
        compatibility,
        pending: createInstalledModulePlanState(
          "installing",
          desired,
          desired === "active" ? "activating" : "inactive",
        ),
        success: createInstalledModulePlanState(
          "installed",
          desired,
          desired === "active" ? "active" : "inactive",
        ),
        failure: createInstalledModulePlannedFailureState(desired, "install"),
        preserveCurrentRuntimeUntilSuccess:
          record.installState === "installed" &&
          record.activation.desired === "active" &&
          record.activation.status === "active",
        versionTransition: createInstalledModuleVersionTransition(
          record.version,
          compatibility.target.version,
          record.version !== compatibility.target.version,
        ),
        recovery:
          "If update application fails, keep the current row authoritative, preserve any active runtime until cutover is safe, and retry the same update after fixing the bundle, migration, or runtime blocker.",
      });
    }

    default: {
      const exhaustive: never = input.action;
      return exhaustive;
    }
  }
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

export type GraphCommandTouchedPredicate = Pick<PredicatePolicyDescriptor, "predicateId">;

export type GraphCommandPolicy = {
  readonly capabilities?: readonly PolicyCapabilityKey[];
  readonly touchesPredicates?: readonly GraphCommandTouchedPredicate[];
};

export type AuthorizeCommandInput = {
  readonly authorization: AuthorizationContext;
  readonly commandKey: string;
  readonly commandPolicy?: GraphCommandPolicy | null;
  readonly touchedPredicates?: readonly AuthorizationCommandTouchedPredicate[];
  readonly capabilityKeys?: readonly PolicyCapabilityKey[];
  readonly writeScope?: PredicatePolicyDescriptor["requiredWriteScope"];
};
