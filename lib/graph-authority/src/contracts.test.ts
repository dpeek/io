import { describe, expect, it } from "bun:test";

import {
  createShareGrantConstraints,
  defineAdmissionPolicy,
  defineInstalledModuleRecord,
  planInstalledModuleLifecycle,
  defineShareGrant,
  defineShareSurface,
  defineWebPrincipalBootstrapPayload,
  defineWebPrincipalSession,
  defineWebPrincipalSummary,
  validateInstalledModuleCompatibility,
  validateShareGrant,
  validateShareSurface,
  type ShareGrantCapabilityProjection,
} from "./index.js";

function createWorkflowTarget(overrides?: {
  readonly bundleDigest?: string;
  readonly compatibility?: Partial<{
    readonly graph: string;
    readonly runtime: string;
  }>;
  readonly moduleId?: string;
  readonly source?: Partial<{
    readonly exportName: string;
    readonly kind: "built-in" | "local";
    readonly specifier: string;
  }>;
  readonly version?: string;
}) {
  return {
    moduleId: overrides?.moduleId ?? "workflow",
    version: overrides?.version ?? "0.0.1",
    bundleDigest: overrides?.bundleDigest ?? "sha256:workflow-v1",
    source: {
      kind: overrides?.source?.kind ?? "built-in",
      specifier: overrides?.source?.specifier ?? "@io/graph-module-workflow",
      exportName: overrides?.source?.exportName ?? "workflowManifest",
    },
    compatibility: {
      graph: overrides?.compatibility?.graph ?? "graph-schema:v1",
      runtime: overrides?.compatibility?.runtime ?? "graph-runtime:v1",
    },
  } as const;
}

function createRuntimeExpectation(overrides?: {
  readonly graph?: string;
  readonly runtime?: string;
  readonly supportedSourceKinds?: readonly ("built-in" | "local")[];
}) {
  return {
    graph: overrides?.graph ?? "graph-schema:v1",
    runtime: overrides?.runtime ?? "graph-runtime:v1",
    ...(overrides?.supportedSourceKinds
      ? { supportedSourceKinds: overrides.supportedSourceKinds }
      : { supportedSourceKinds: ["built-in", "local"] as const }),
  } as const;
}

function createInstalledWorkflowRecord(overrides?: {
  readonly activation?: Record<string, unknown>;
  readonly bundleDigest?: string;
  readonly compatibility?: Partial<{
    readonly graph: string;
    readonly runtime: string;
  }>;
  readonly grantedPermissionKeys?: readonly string[];
  readonly installState?: "installing" | "installed" | "uninstalling" | "failed";
  readonly installedAt?: string;
  readonly lastSuccessfulMigrationVersion?: string;
  readonly source?: Partial<{
    readonly exportName: string;
    readonly kind: "built-in" | "local";
    readonly specifier: string;
  }>;
  readonly updatedAt?: string;
  readonly version?: string;
}) {
  return defineInstalledModuleRecord({
    moduleId: "workflow",
    version: overrides?.version ?? "0.0.1",
    bundleDigest: overrides?.bundleDigest ?? "sha256:workflow-v1",
    source: {
      kind: overrides?.source?.kind ?? "built-in",
      specifier: overrides?.source?.specifier ?? "@io/graph-module-workflow",
      exportName: overrides?.source?.exportName ?? "workflowManifest",
    },
    compatibility: {
      graph: overrides?.compatibility?.graph ?? "graph-schema:v1",
      runtime: overrides?.compatibility?.runtime ?? "graph-runtime:v1",
    },
    installState: overrides?.installState ?? "installed",
    activation: {
      desired: "active",
      status: "active",
      changedAt: "2026-04-02T00:00:00.000Z",
      ...overrides?.activation,
    },
    grantedPermissionKeys: overrides?.grantedPermissionKeys ?? ["workflow.document.read.summary"],
    ...(overrides?.installedAt === undefined
      ? { installedAt: "2026-04-02T00:00:00.000Z" }
      : overrides.installedAt
        ? { installedAt: overrides.installedAt }
        : {}),
    updatedAt: overrides?.updatedAt ?? "2026-04-02T00:00:00.000Z",
    ...(overrides?.lastSuccessfulMigrationVersion === undefined
      ? { lastSuccessfulMigrationVersion: overrides?.version ?? "0.0.1" }
      : overrides.lastSuccessfulMigrationVersion
        ? { lastSuccessfulMigrationVersion: overrides.lastSuccessfulMigrationVersion }
        : {}),
  });
}

describe("authority contracts", () => {
  it("freezes and validates admission policy domains and role keys", () => {
    const policy = defineAdmissionPolicy({
      graphId: "graph:global",
      bootstrapMode: "first-user",
      signupPolicy: "open",
      allowedEmailDomains: ["example.com"],
      firstUserProvisioning: {
        roleKeys: ["graph:owner", "graph:authority"],
      },
      signupProvisioning: {
        roleKeys: ["graph:member"],
      },
    });

    expect(policy.allowedEmailDomains).toEqual(["example.com"]);
    expect(() =>
      defineAdmissionPolicy({
        ...policy,
        allowedEmailDomains: ["Example.com"],
      }),
    ).toThrow("allowedEmailDomains must be lowercase.");
  });

  it("validates share surfaces against shareable predicate policy", () => {
    const surface = defineShareSurface({
      surfaceId: "share:topic-summary",
      kind: "entity-predicate-slice",
      rootEntityId: "topic:1",
      predicateIds: ["topic.name", "topic.summary"],
    });

    expect(
      validateShareSurface(surface, {
        "topic.name": {
          predicateId: "topic.name",
          shareable: true,
        },
        "topic.summary": {
          predicateId: "topic.summary",
          shareable: true,
        },
      }),
    ).toEqual({ ok: true });

    expect(
      validateShareSurface(surface, {
        "topic.name": {
          predicateId: "topic.name",
          shareable: true,
        },
        "topic.summary": {
          predicateId: "topic.summary",
          shareable: false,
        },
      }),
    ).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: "share.surface_invalid",
      }),
    });
  });

  it("keeps share grants aligned with their capability-grant projection", () => {
    const shareGrant = defineShareGrant({
      id: "share-grant:1",
      surface: {
        surfaceId: "share:topic-summary",
        kind: "entity-predicate-slice",
        rootEntityId: "topic:1",
        predicateIds: ["topic.name", "topic.summary"],
      },
      capabilityGrantId: "grant:1",
      status: "active",
    });

    const capabilityGrant = {
      id: "grant:1",
      resource: {
        kind: "share-surface",
        surfaceId: shareGrant.surface.surfaceId,
      },
      constraints: createShareGrantConstraints(shareGrant.surface),
      status: "active",
    } satisfies ShareGrantCapabilityProjection;

    expect(validateShareGrant(shareGrant, capabilityGrant)).toEqual({ ok: true });

    expect(
      validateShareGrant(shareGrant, {
        ...capabilityGrant,
        constraints: {
          ...capabilityGrant.constraints,
          predicateIds: ["topic.name"],
        },
      }),
    ).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: "grant.invalid",
      }),
    });
  });

  it("defines the minimal ready-session bootstrap payload for an authenticated principal", () => {
    const payload = defineWebPrincipalBootstrapPayload({
      session: {
        authState: "ready",
        sessionId: "session-1",
        principalId: "principal-1",
        capabilityVersion: 3,
        displayName: "Operator",
      },
      principal: {
        graphId: "graph:global",
        principalId: "principal-1",
        principalKind: "human",
        roleKeys: ["graph:member"],
        capabilityGrantIds: ["grant-1"],
        access: {
          authority: false,
          graphMember: true,
          sharedRead: false,
        },
        capabilityVersion: 3,
        policyVersion: 5,
      },
    });

    expect(payload).toEqual({
      session: {
        authState: "ready",
        sessionId: "session-1",
        principalId: "principal-1",
        capabilityVersion: 3,
        displayName: "Operator",
      },
      principal: {
        graphId: "graph:global",
        principalId: "principal-1",
        principalKind: "human",
        roleKeys: ["graph:member"],
        capabilityGrantIds: ["grant-1"],
        access: {
          authority: false,
          graphMember: true,
          sharedRead: false,
        },
        capabilityVersion: 3,
        policyVersion: 5,
      },
    });
    expect(Object.isFrozen(payload)).toBe(true);
    expect(Object.isFrozen(payload.session)).toBe(true);
    expect(Object.isFrozen(payload.principal)).toBe(true);
    expect(Object.isFrozen(payload.principal?.access)).toBe(true);
    expect(Object.isFrozen(payload.principal?.roleKeys)).toBe(true);
    expect(Object.isFrozen(payload.principal?.capabilityGrantIds)).toBe(true);
  });

  it("rejects malformed session and summary combinations", () => {
    expect(() =>
      defineWebPrincipalSession({
        authState: "signed-out",
        sessionId: "session-1",
        principalId: null,
        capabilityVersion: null,
      }),
    ).toThrow('sessionId must be null when authState is "signed-out".');

    expect(() =>
      defineWebPrincipalSummary({
        graphId: "graph:global",
        principalId: "principal-1",
        principalKind: "anonymous",
        roleKeys: [],
        capabilityGrantIds: [],
        access: {
          authority: false,
          graphMember: false,
          sharedRead: false,
        },
        capabilityVersion: 0,
        policyVersion: 0,
      }),
    ).toThrow('principalKind must not be "anonymous" in a web principal summary.');

    expect(() =>
      defineWebPrincipalBootstrapPayload({
        session: {
          authState: "ready",
          sessionId: "session-1",
          principalId: "principal-1",
          capabilityVersion: 2,
        },
        principal: {
          graphId: "graph:global",
          principalId: "principal-2",
          principalKind: "human",
          roleKeys: [],
          capabilityGrantIds: [],
          access: {
            authority: false,
            graphMember: false,
            sharedRead: false,
          },
          capabilityVersion: 2,
          policyVersion: 0,
        },
      }),
    ).toThrow("session.principalId must match principal.principalId.");
  });

  it("defines explicit install and activation state for built-in installed modules", () => {
    const record = defineInstalledModuleRecord({
      moduleId: "workflow",
      version: "0.0.1",
      bundleDigest: "sha256:workflow-v1",
      source: {
        kind: "built-in",
        specifier: "@io/graph-module-workflow",
        exportName: "workflowManifest",
      },
      compatibility: {
        graph: "graph-schema:v1",
        runtime: "graph-runtime:v1",
      },
      installState: "installed",
      activation: {
        desired: "active",
        status: "active",
        changedAt: "2026-04-02T00:00:00.000Z",
      },
      grantedPermissionKeys: ["workflow.document.read.summary"],
      installedAt: "2026-04-02T00:00:00.000Z",
      updatedAt: "2026-04-02T00:00:00.000Z",
      lastSuccessfulMigrationVersion: "0.0.1",
    });

    expect(record).toEqual({
      moduleId: "workflow",
      version: "0.0.1",
      bundleDigest: "sha256:workflow-v1",
      source: {
        kind: "built-in",
        specifier: "@io/graph-module-workflow",
        exportName: "workflowManifest",
      },
      compatibility: {
        graph: "graph-schema:v1",
        runtime: "graph-runtime:v1",
      },
      installState: "installed",
      activation: {
        desired: "active",
        status: "active",
        changedAt: "2026-04-02T00:00:00.000Z",
      },
      grantedPermissionKeys: ["workflow.document.read.summary"],
      installedAt: "2026-04-02T00:00:00.000Z",
      updatedAt: "2026-04-02T00:00:00.000Z",
      lastSuccessfulMigrationVersion: "0.0.1",
    });
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.source)).toBe(true);
    expect(Object.isFrozen(record.compatibility)).toBe(true);
    expect(Object.isFrozen(record.activation)).toBe(true);
    expect(Object.isFrozen(record.grantedPermissionKeys)).toBe(true);
  });

  it("captures failed local-module activation without collapsing install identity", () => {
    const failedLocalRecord = defineInstalledModuleRecord({
      moduleId: "customer.local",
      version: "0.3.0",
      bundleDigest: "sha256:customer-local-v3",
      source: {
        kind: "local",
        specifier: "./modules/customer-local.ts",
        exportName: "customerLocalManifest",
      },
      compatibility: {
        graph: "graph-schema:v1",
        runtime: "graph-runtime:v1",
      },
      installState: "failed",
      activation: {
        desired: "active",
        status: "failed",
        changedAt: "2026-04-02T01:00:00.000Z",
        failure: {
          stage: "rebuild",
          code: "bundle-unavailable",
          message: "The local module bundle could not be resolved during rebuild.",
          observedAt: "2026-04-02T01:00:00.000Z",
        },
      },
      grantedPermissionKeys: [],
      updatedAt: "2026-04-02T01:00:00.000Z",
    });

    expect(failedLocalRecord.activation).toEqual({
      desired: "active",
      status: "failed",
      changedAt: "2026-04-02T01:00:00.000Z",
      failure: {
        stage: "rebuild",
        code: "bundle-unavailable",
        message: "The local module bundle could not be resolved during rebuild.",
        observedAt: "2026-04-02T01:00:00.000Z",
      },
    });

    expect(() =>
      defineInstalledModuleRecord({
        ...failedLocalRecord,
        installState: "uninstalling",
        activation: {
          desired: "active",
          status: "active",
          changedAt: "2026-04-02T01:05:00.000Z",
        },
      }),
    ).toThrow('activation.desired must be "inactive" when installState is "uninstalling".');
  });

  it("validates module targets against runtime expectations and replacement drift", () => {
    const record = createInstalledWorkflowRecord();
    const compatibility = validateInstalledModuleCompatibility({
      target: createWorkflowTarget({
        version: "0.0.2",
        bundleDigest: "sha256:workflow-v2",
      }),
      record,
      runtime: createRuntimeExpectation({
        supportedSourceKinds: ["built-in"],
      }),
    });

    expect(compatibility).toEqual({
      ok: true,
      status: "replaces-record",
      target: {
        moduleId: "workflow",
        version: "0.0.2",
        bundleDigest: "sha256:workflow-v2",
        source: {
          kind: "built-in",
          specifier: "@io/graph-module-workflow",
          exportName: "workflowManifest",
        },
        compatibility: {
          graph: "graph-schema:v1",
          runtime: "graph-runtime:v1",
        },
      },
      record,
      runtime: {
        graph: "graph-schema:v1",
        runtime: "graph-runtime:v1",
        supportedSourceKinds: ["built-in"],
      },
      changes: {
        versionChanged: true,
        bundleDigestChanged: true,
        sourceChanged: false,
        compatibilityChanged: false,
      },
    });
  });

  it("fails closed when runtime expectations reject a module target", () => {
    expect(
      validateInstalledModuleCompatibility({
        target: createWorkflowTarget({
          source: {
            kind: "local",
            specifier: "./modules/workflow.ts",
            exportName: "workflowManifest",
          },
        }),
        runtime: createRuntimeExpectation({
          supportedSourceKinds: ["built-in"],
        }),
      }),
    ).toEqual({
      ok: false,
      code: "module.source_kind_unsupported",
      message:
        'Module target "workflow@0.0.1" uses source kind "local" but the runtime only accepts built-in.',
      recovery:
        "Choose a supported source kind or widen the runtime expectation before retrying this plan.",
    });
  });

  it("plans installs as explicit installing-to-active transitions", () => {
    const target = createWorkflowTarget();
    const runtime = createRuntimeExpectation();
    const plan = planInstalledModuleLifecycle({
      action: "install",
      target,
      runtime,
    });

    expect(plan).toEqual({
      ok: true,
      action: "install",
      disposition: "apply",
      target,
      record: null,
      compatibility: {
        ok: true,
        status: "new-install",
        target,
        record: null,
        runtime,
        changes: {
          versionChanged: false,
          bundleDigestChanged: false,
          sourceChanged: false,
          compatibilityChanged: false,
        },
      },
      pending: {
        installState: "installing",
        activation: {
          desired: "active",
          status: "activating",
        },
      },
      success: {
        installState: "installed",
        activation: {
          desired: "active",
          status: "active",
        },
      },
      failure: {
        installState: "failed",
        activation: {
          desired: "active",
          status: "failed",
        },
        failureStage: "install",
      },
      preserveCurrentRuntimeUntilSuccess: false,
      versionTransition: {
        fromVersion: null,
        toVersion: "0.0.1",
        requiresMigration: false,
      },
      recovery:
        "If install application fails, keep the failed row authoritative, repair the bundle or runtime mismatch, and retry the same install instead of creating a duplicate row.",
    });
  });

  it("plans activation only for the current stable installed bundle", () => {
    const record = createInstalledWorkflowRecord({
      activation: {
        desired: "inactive",
        status: "inactive",
        changedAt: "2026-04-02T00:10:00.000Z",
      },
    });
    const target = createWorkflowTarget();
    const runtime = createRuntimeExpectation();

    expect(
      planInstalledModuleLifecycle({
        action: "activate",
        record,
        target,
        runtime,
      }),
    ).toEqual({
      ok: true,
      action: "activate",
      disposition: "apply",
      target,
      record,
      compatibility: {
        ok: true,
        status: "matches-record",
        target,
        record,
        runtime,
        changes: {
          versionChanged: false,
          bundleDigestChanged: false,
          sourceChanged: false,
          compatibilityChanged: false,
        },
      },
      pending: {
        installState: "installed",
        activation: {
          desired: "active",
          status: "activating",
        },
      },
      success: {
        installState: "installed",
        activation: {
          desired: "active",
          status: "active",
        },
      },
      failure: {
        installState: "failed",
        activation: {
          desired: "active",
          status: "failed",
        },
        failureStage: "activate",
      },
      preserveCurrentRuntimeUntilSuccess: false,
      versionTransition: {
        fromVersion: "0.0.1",
        toVersion: "0.0.1",
        requiresMigration: false,
      },
      recovery:
        "If activation fails, keep the row failed, inspect the recorded activation or rebuild error, and retry activate or update after fixing the runtime blocker.",
    });

    expect(
      planInstalledModuleLifecycle({
        action: "activate",
        record,
        target: createWorkflowTarget({
          version: "0.0.2",
          bundleDigest: "sha256:workflow-v2",
        }),
        runtime,
      }),
    ).toEqual({
      ok: false,
      action: "activate",
      code: "module.state_incompatible",
      message:
        'Activate planning only applies to the current installed bundle for "workflow". Version, source, digest, or compatibility drift must use update planning.',
      recovery: "Plan an update for replacement bundles before attempting to activate them.",
    });
  });

  it("plans deactivation and update cutovers from stable or retryable records", () => {
    const activeRecord = createInstalledWorkflowRecord();
    expect(
      planInstalledModuleLifecycle({
        action: "deactivate",
        record: activeRecord,
      }),
    ).toEqual({
      ok: true,
      action: "deactivate",
      disposition: "apply",
      target: null,
      record: activeRecord,
      compatibility: null,
      pending: {
        installState: "installed",
        activation: {
          desired: "inactive",
          status: "deactivating",
        },
      },
      success: {
        installState: "installed",
        activation: {
          desired: "inactive",
          status: "inactive",
        },
      },
      failure: {
        installState: "failed",
        activation: {
          desired: "inactive",
          status: "failed",
        },
        failureStage: "deactivate",
      },
      preserveCurrentRuntimeUntilSuccess: false,
      versionTransition: {
        fromVersion: "0.0.1",
        toVersion: "0.0.1",
        requiresMigration: false,
      },
      recovery:
        "If deactivation fails, keep the row failed, inspect the runtime teardown error, and retry deactivation or plan an update after the blocker is fixed.",
    });

    const replacementTarget = createWorkflowTarget({
      version: "0.0.2",
      bundleDigest: "sha256:workflow-v2",
    });
    const runtime = createRuntimeExpectation();
    expect(
      planInstalledModuleLifecycle({
        action: "update",
        record: activeRecord,
        target: replacementTarget,
        runtime,
      }),
    ).toEqual({
      ok: true,
      action: "update",
      disposition: "apply",
      target: replacementTarget,
      record: activeRecord,
      compatibility: {
        ok: true,
        status: "replaces-record",
        target: replacementTarget,
        record: activeRecord,
        runtime,
        changes: {
          versionChanged: true,
          bundleDigestChanged: true,
          sourceChanged: false,
          compatibilityChanged: false,
        },
      },
      pending: {
        installState: "installing",
        activation: {
          desired: "active",
          status: "activating",
        },
      },
      success: {
        installState: "installed",
        activation: {
          desired: "active",
          status: "active",
        },
      },
      failure: {
        installState: "failed",
        activation: {
          desired: "active",
          status: "failed",
        },
        failureStage: "install",
      },
      preserveCurrentRuntimeUntilSuccess: true,
      versionTransition: {
        fromVersion: "0.0.1",
        toVersion: "0.0.2",
        requiresMigration: true,
      },
      recovery:
        "If update application fails, keep the current row authoritative, preserve any active runtime until cutover is safe, and retry the same update after fixing the bundle, migration, or runtime blocker.",
    });
  });

  it("fails closed on incomplete or install-failed rows instead of guessing recovery", () => {
    expect(
      planInstalledModuleLifecycle({
        action: "update",
        record: createInstalledWorkflowRecord({
          installState: "installing",
          activation: {
            desired: "active",
            status: "activating",
            changedAt: "2026-04-02T00:05:00.000Z",
          },
          installedAt: undefined,
          lastSuccessfulMigrationVersion: undefined,
          updatedAt: "2026-04-02T00:05:00.000Z",
        }),
        target: createWorkflowTarget({
          version: "0.0.2",
          bundleDigest: "sha256:workflow-v2",
        }),
        runtime: createRuntimeExpectation(),
      }),
    ).toEqual({
      ok: false,
      action: "update",
      code: "module.state_incompatible",
      message:
        'Module "workflow" is already mid-transition (installing, activating). Update planning fails closed until the row reaches a stable state.',
      recovery:
        "Wait for the current transition to finish or repair the row into a stable active, inactive, or failed state before retrying.",
    });

    expect(
      planInstalledModuleLifecycle({
        action: "deactivate",
        record: createInstalledWorkflowRecord({
          installState: "failed",
          activation: {
            desired: "active",
            status: "failed",
            changedAt: "2026-04-02T00:06:00.000Z",
            failure: {
              stage: "install",
              code: "schema-apply-failed",
              message: "Schema apply failed.",
              observedAt: "2026-04-02T00:06:00.000Z",
            },
          },
          installedAt: undefined,
          lastSuccessfulMigrationVersion: undefined,
          updatedAt: "2026-04-02T00:06:00.000Z",
        }),
      }),
    ).toEqual({
      ok: false,
      action: "deactivate",
      code: "module.state_incompatible",
      message:
        'Module "workflow" failed during install and cannot be deactivated because no stable installed bundle is available.',
      recovery:
        "Repair the install failure first, or plan an update that replaces the failed bundle before retrying deactivation.",
    });
  });
});
