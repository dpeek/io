import type { QueryResultPage } from "@io/graph-client";

import { coreBuiltInQuerySurfaces, type CoreBuiltInQuerySurfaceSpec } from "./query.js";

export type CoreQueryExecutorDependencies<_ReadOptions> = {
  readonly executeModuleScopeQuery: (context: any) => QueryResultPage;
  readonly unsupported: (message: string) => Error;
};

type CoreInstalledQuerySurface = Pick<
  CoreBuiltInQuerySurfaceSpec,
  "queryKind" | "surfaceId" | "surfaceVersion"
>;

type CoreQueryExecutorRegistration<_ReadOptions> = {
  readonly execute: (context: any) => QueryResultPage;
  readonly queryKind: "scope";
  readonly surfaceId: string;
  readonly surfaceVersion: string;
};

const defaultCoreInstalledQuerySurfaces = Object.freeze([
  coreBuiltInQuerySurfaces.catalogScope,
  coreBuiltInQuerySurfaces.savedQueryLibrary,
] satisfies readonly CoreInstalledQuerySurface[]);

function getInstalledCoreScopeSurface(
  surfaces: readonly CoreInstalledQuerySurface[],
  surfaceId: string,
): Pick<CoreQueryExecutorRegistration<never>, "surfaceId" | "surfaceVersion"> | undefined {
  const surface = surfaces.find(
    (candidate) => candidate.queryKind === "scope" && candidate.surfaceId === surfaceId,
  );
  return surface
    ? {
        surfaceId: surface.surfaceId,
        surfaceVersion: surface.surfaceVersion,
      }
    : undefined;
}

function createCoreModuleScopeExecutor<ReadOptions>(
  surface: Pick<CoreQueryExecutorRegistration<ReadOptions>, "surfaceId" | "surfaceVersion">,
  dependencies: CoreQueryExecutorDependencies<ReadOptions>,
): CoreQueryExecutorRegistration<ReadOptions> {
  return {
    queryKind: "scope",
    surfaceId: surface.surfaceId,
    surfaceVersion: surface.surfaceVersion,
    execute(context) {
      if (context.normalizedRequest.query.window) {
        throw dependencies.unsupported(
          `Scope query "${context.normalizedRequest.query.scopeId ?? "inline"}" does not support windowed pagination.`,
        );
      }

      return dependencies.executeModuleScopeQuery(context);
    },
  };
}

export function createCoreQueryExecutorRegistrations<ReadOptions>(
  dependencies: CoreQueryExecutorDependencies<ReadOptions>,
  installedSurfaces: readonly CoreInstalledQuerySurface[] = defaultCoreInstalledQuerySurfaces,
): readonly CoreQueryExecutorRegistration<ReadOptions>[] {
  const catalogScope = getInstalledCoreScopeSurface(
    installedSurfaces,
    coreBuiltInQuerySurfaces.catalogScope.surfaceId,
  );

  return catalogScope ? [createCoreModuleScopeExecutor(catalogScope, dependencies)] : [];
}
