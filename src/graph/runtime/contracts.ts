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

export type AuthorizationDecision =
  | {
      readonly allowed: true;
    }
  | {
      readonly allowed: false;
      readonly error: PolicyError;
    };

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
