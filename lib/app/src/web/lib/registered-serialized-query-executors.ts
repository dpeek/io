import {
  createCoreQueryExecutorRegistrations,
  coreModuleId,
  type CoreQueryExecutorDependencies,
} from "@io/graph-module-core";
import {
  createWorkflowQueryExecutorRegistrations,
  workflowModuleId,
  type WorkflowQueryExecutorDependencies,
} from "@io/graph-module-workflow";
import {
  createQueryExecutorRegistry,
  type RegisteredSerializedQueryExecutor,
  type SerializedQueryExecutorRegistry,
} from "@io/graph-query";

import type {
  InstalledModuleQuerySurface,
  InstalledModuleQuerySurfaceRegistry,
} from "./query-surface-registry.js";
import { getInstalledModuleQuerySurfaceRegistry } from "./query-surface-registry.js";

export type WebAppSerializedQueryExecutorDependencies<ReadOptions> =
  CoreQueryExecutorDependencies<ReadOptions> & WorkflowQueryExecutorDependencies<ReadOptions>;

type InstalledModuleSerializedQueryExecutorContributor<ReadOptions> = {
  readonly createRegistrations: (input: {
    readonly dependencies: WebAppSerializedQueryExecutorDependencies<ReadOptions>;
    readonly surfaces: readonly InstalledModuleQuerySurface[];
  }) => readonly RegisteredSerializedQueryExecutor<ReadOptions>[];
  readonly moduleId: string;
};

export type WebAppSerializedQueryExecutorRegistryOptions = {
  readonly surfaceRegistry?: InstalledModuleQuerySurfaceRegistry;
};

function createInstalledModuleSerializedQueryExecutorContributors<
  ReadOptions,
>(): readonly InstalledModuleSerializedQueryExecutorContributor<ReadOptions>[] {
  return [
    {
      moduleId: workflowModuleId,
      createRegistrations({ dependencies, surfaces }) {
        return createWorkflowQueryExecutorRegistrations(dependencies, surfaces);
      },
    },
    {
      moduleId: coreModuleId,
      createRegistrations({ dependencies, surfaces }) {
        return createCoreQueryExecutorRegistrations(dependencies, surfaces);
      },
    },
  ];
}

function createInstalledModuleSerializedQueryExecutors<ReadOptions>(
  surfaceRegistry: InstalledModuleQuerySurfaceRegistry,
  dependencies: WebAppSerializedQueryExecutorDependencies<ReadOptions>,
): readonly RegisteredSerializedQueryExecutor<ReadOptions>[] {
  const contributorsByModuleId = new Map(
    createInstalledModuleSerializedQueryExecutorContributors<ReadOptions>().map((contributor) => [
      contributor.moduleId,
      contributor,
    ]),
  );
  const installedSurfacesByModuleId = new Map<string, InstalledModuleQuerySurface[]>();

  for (const surface of surfaceRegistry.surfaces) {
    const moduleSurfaces = installedSurfacesByModuleId.get(surface.moduleId);
    if (moduleSurfaces) {
      moduleSurfaces.push(surface);
      continue;
    }
    installedSurfacesByModuleId.set(surface.moduleId, [surface]);
  }

  const executors: RegisteredSerializedQueryExecutor<ReadOptions>[] = [];
  for (const catalog of surfaceRegistry.catalogs) {
    const contributor = contributorsByModuleId.get(catalog.moduleId);
    if (!contributor) {
      continue;
    }
    const moduleSurfaces = installedSurfacesByModuleId.get(catalog.moduleId);
    if (!moduleSurfaces) {
      continue;
    }

    executors.push(
      ...contributor.createRegistrations({
        dependencies,
        surfaces: moduleSurfaces,
      }),
    );
    installedSurfacesByModuleId.delete(catalog.moduleId);
  }

  return executors;
}

export function createWebAppSerializedQueryExecutorRegistry<ReadOptions>(
  dependencies: WebAppSerializedQueryExecutorDependencies<ReadOptions>,
  options?: WebAppSerializedQueryExecutorRegistryOptions,
): SerializedQueryExecutorRegistry<ReadOptions> {
  const surfaceRegistry = options?.surfaceRegistry ?? getInstalledModuleQuerySurfaceRegistry();
  const executors = createInstalledModuleSerializedQueryExecutors(surfaceRegistry, dependencies);

  return createQueryExecutorRegistry(surfaceRegistry, executors);
}
