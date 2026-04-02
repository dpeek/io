import { describe, expect, it } from "bun:test";

import {
  defineInstalledModuleRecord,
  defineInstalledModuleRuntimeExpectation,
  defineInstalledModuleTarget,
  planInstalledModuleLifecycle,
  validateInstalledModuleCompatibility,
  type InstalledModuleActivationState,
  type InstalledModuleRecord,
  type InstalledModuleRuntimeExpectation,
  type InstalledModuleTarget,
} from "@io/graph-authority";
import { defineGraphModuleManifest, type GraphModuleManifest } from "@io/graph-module";
import { core, coreManifest } from "@io/graph-module-core";

const installedAt = "2026-04-02T00:00:00.000Z";
const updatedAt = "2026-04-02T00:00:00.000Z";
const changedAt = "2026-04-02T00:00:00.000Z";

function createTargetFromManifest(
  manifest: Pick<GraphModuleManifest, "moduleId" | "version" | "source" | "compatibility">,
  overrides?: {
    readonly bundleDigest?: string;
    readonly compatibility?: Partial<{
      readonly graph: string;
      readonly runtime: string;
    }>;
    readonly source?: Partial<{
      readonly exportName: string;
      readonly kind: "built-in" | "local";
      readonly specifier: string;
    }>;
    readonly version?: string;
  },
): Readonly<InstalledModuleTarget> {
  const version = overrides?.version ?? manifest.version;

  return defineInstalledModuleTarget({
    moduleId: manifest.moduleId,
    version,
    bundleDigest: overrides?.bundleDigest ?? `sha256:${manifest.moduleId}:${version}`,
    source: {
      kind: overrides?.source?.kind ?? manifest.source.kind,
      specifier: overrides?.source?.specifier ?? manifest.source.specifier,
      exportName: overrides?.source?.exportName ?? manifest.source.exportName,
    },
    compatibility: {
      graph: overrides?.compatibility?.graph ?? manifest.compatibility.graph,
      runtime: overrides?.compatibility?.runtime ?? manifest.compatibility.runtime,
    },
  });
}

function createRuntimeExpectationFromManifest(
  manifest: Pick<GraphModuleManifest, "compatibility" | "source">,
  overrides?: {
    readonly graph?: string;
    readonly runtime?: string;
    readonly supportedSourceKinds?: readonly ("built-in" | "local")[];
  },
): Readonly<InstalledModuleRuntimeExpectation> {
  return defineInstalledModuleRuntimeExpectation({
    graph: overrides?.graph ?? manifest.compatibility.graph,
    runtime: overrides?.runtime ?? manifest.compatibility.runtime,
    supportedSourceKinds: overrides?.supportedSourceKinds ?? [manifest.source.kind],
  });
}

function createInstalledRecord(
  target: Readonly<InstalledModuleTarget>,
  overrides?: {
    readonly activation?: InstalledModuleActivationState;
    readonly grantedPermissionKeys?: readonly string[];
    readonly installState?: InstalledModuleRecord["installState"];
    readonly installedAt?: string | undefined;
    readonly lastSuccessfulMigrationVersion?: string | undefined;
    readonly updatedAt?: string;
  },
): Readonly<InstalledModuleRecord> {
  return defineInstalledModuleRecord({
    moduleId: target.moduleId,
    version: target.version,
    bundleDigest: target.bundleDigest,
    source: target.source,
    compatibility: target.compatibility,
    installState: overrides?.installState ?? "installed",
    activation:
      overrides?.activation ??
      ({
        desired: "active",
        status: "active",
        changedAt,
      } satisfies InstalledModuleActivationState),
    grantedPermissionKeys: overrides?.grantedPermissionKeys ?? [],
    ...(overrides?.installedAt === undefined
      ? { installedAt }
      : overrides.installedAt
        ? { installedAt: overrides.installedAt }
        : {}),
    updatedAt: overrides?.updatedAt ?? updatedAt,
    ...(overrides?.lastSuccessfulMigrationVersion === undefined
      ? { lastSuccessfulMigrationVersion: target.version }
      : overrides.lastSuccessfulMigrationVersion
        ? { lastSuccessfulMigrationVersion: overrides.lastSuccessfulMigrationVersion }
        : {}),
  });
}

describe("installed-module contract", () => {
  it("proves a shipped manifest can drive the installed-module lifecycle end to end", () => {
    expect(coreManifest.runtime.querySurfaceCatalogs?.length).toBeGreaterThan(0);
    expect(coreManifest.runtime.readScopes?.length).toBeGreaterThan(0);

    const target = createTargetFromManifest(coreManifest, {
      bundleDigest: "sha256:core:0.0.1",
    });
    const runtime = createRuntimeExpectationFromManifest(coreManifest, {
      supportedSourceKinds: ["built-in"],
    });

    const installPlan = planInstalledModuleLifecycle({
      action: "install",
      target,
      runtime,
    });

    expect(installPlan).toMatchObject({
      ok: true,
      action: "install",
      disposition: "apply",
      target,
      compatibility: {
        ok: true,
        status: "new-install",
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
    });

    const record = createInstalledRecord(target);

    expect(
      validateInstalledModuleCompatibility({
        target,
        record,
        runtime,
      }),
    ).toMatchObject({
      ok: true,
      status: "matches-record",
      changes: {
        versionChanged: false,
        bundleDigestChanged: false,
        sourceChanged: false,
        compatibilityChanged: false,
      },
    });

    expect(
      planInstalledModuleLifecycle({
        action: "activate",
        target,
        record,
        runtime,
      }),
    ).toMatchObject({
      ok: true,
      action: "activate",
      disposition: "noop",
      reason: "already-active",
    });

    expect(
      planInstalledModuleLifecycle({
        action: "deactivate",
        target,
        record,
      }),
    ).toMatchObject({
      ok: true,
      action: "deactivate",
      disposition: "apply",
      success: {
        installState: "installed",
        activation: {
          desired: "inactive",
          status: "inactive",
        },
      },
    });

    expect(
      planInstalledModuleLifecycle({
        action: "update",
        target: createTargetFromManifest(coreManifest, {
          version: "0.0.2",
          bundleDigest: "sha256:core:0.0.2",
        }),
        record,
        runtime,
      }),
    ).toMatchObject({
      ok: true,
      action: "update",
      disposition: "apply",
      preserveCurrentRuntimeUntilSuccess: true,
      versionTransition: {
        fromVersion: "0.0.1",
        toVersion: "0.0.2",
        requiresMigration: true,
      },
    });
  });

  it("fails closed when authored manifests or installed rows are malformed", () => {
    expect(() =>
      defineGraphModuleManifest({
        moduleId: "probe.invalid",
        version: "0.0.1",
        source: {
          kind: "local",
          specifier: "./modules/probe-invalid.ts",
          exportName: "manifest",
        },
        compatibility: {
          graph: "graph-schema:v1",
          runtime: "graph-runtime:v1",
        },
        runtime: {},
      }),
    ).toThrow("runtime must declare at least one contribution.");

    const target = createTargetFromManifest(coreManifest, {
      bundleDigest: "sha256:core:0.0.1",
    });
    const runtime = createRuntimeExpectationFromManifest(coreManifest);
    const record = createInstalledRecord(target);

    expect(
      validateInstalledModuleCompatibility({
        target,
        record: {
          ...record,
          installState: "failed",
          activation: {
            desired: "active",
            status: "active",
            changedAt,
          },
        },
        runtime,
      }),
    ).toEqual({
      ok: false,
      code: "module.record_invalid",
      message: 'activation.status must be "failed" when installState is "failed".',
      recovery: "Repair the installed-module ledger row before planning module lifecycle changes.",
    });
  });

  it("fails closed on compatibility drift and in-flight lifecycle state", () => {
    const target = createTargetFromManifest(coreManifest, {
      bundleDigest: "sha256:core:0.0.1",
    });

    expect(
      validateInstalledModuleCompatibility({
        target: createTargetFromManifest(coreManifest, {
          bundleDigest: "sha256:core:0.0.1",
          compatibility: {
            runtime: "graph-runtime:v2",
          },
        }),
        runtime: createRuntimeExpectationFromManifest(coreManifest),
      }),
    ).toEqual({
      ok: false,
      code: "module.runtime_incompatible",
      message:
        'Module target "core@0.0.1" declares runtime compatibility "graph-runtime:v2" but the runtime expects "graph-runtime:v1".',
      recovery:
        "Load a module bundle that matches the current runtime contract or upgrade the runtime before retrying.",
    });

    expect(
      planInstalledModuleLifecycle({
        action: "update",
        target: createTargetFromManifest(coreManifest, {
          version: "0.0.2",
          bundleDigest: "sha256:core:0.0.2",
        }),
        record: createInstalledRecord(target, {
          installState: "installing",
          activation: {
            desired: "active",
            status: "activating",
            changedAt,
          },
          installedAt: undefined,
          lastSuccessfulMigrationVersion: undefined,
        }),
        runtime: createRuntimeExpectationFromManifest(coreManifest),
      }),
    ).toEqual({
      ok: false,
      action: "update",
      code: "module.state_incompatible",
      message:
        'Module "core" is already mid-transition (installing, activating). Update planning fails closed until the row reaches a stable state.',
      recovery:
        "Wait for the current transition to finish or repair the row into a stable active, inactive, or failed state before retrying.",
    });
  });

  it("uses the same contract surface for newly authored manifests", () => {
    const localManifest = defineGraphModuleManifest({
      moduleId: "probe.local",
      version: "0.0.1",
      source: {
        kind: "local",
        specifier: "./modules/probe-local.ts",
        exportName: "manifest",
      },
      compatibility: {
        graph: "graph-schema:v1",
        runtime: "graph-runtime:v1",
      },
      runtime: {
        schemas: [
          {
            key: "probe.local",
            namespace: {
              node: core.node,
            },
          },
        ],
      },
    });

    const target = createTargetFromManifest(localManifest, {
      bundleDigest: "sha256:probe.local:0.0.1",
    });
    const runtime = createRuntimeExpectationFromManifest(localManifest, {
      supportedSourceKinds: ["built-in", "local"],
    });
    const record = createInstalledRecord(target, {
      grantedPermissionKeys: ["probe.local.read"],
    });

    expect(
      validateInstalledModuleCompatibility({
        target,
        record,
        runtime,
      }),
    ).toMatchObject({
      ok: true,
      status: "matches-record",
      target: {
        source: {
          kind: "local",
          specifier: "./modules/probe-local.ts",
          exportName: "manifest",
        },
      },
      record: {
        grantedPermissionKeys: ["probe.local.read"],
      },
    });
  });
});
