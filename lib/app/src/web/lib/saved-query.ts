import {
  normalizeSerializedQueryRequest,
  validateSerializedQueryRequest,
  type NormalizedQueryRequest,
  type QueryIdentityExecutionContext,
  type QueryLiteral,
  type SerializedQueryRequest,
} from "@io/graph-client";
import {
  createSavedQueryDefinition,
  createSavedViewDefinition,
  readSavedQueryDefinition,
  readSavedViewDefinition,
  updateSavedQueryDefinition,
  updateSavedViewDefinition,
  type SavedQueryDefinition,
  type SavedQueryDefinitionInput,
  type SavedQueryGraphClient,
  type SavedQuerySurfaceBinding,
  type SavedViewDefinition,
  type SavedViewDefinitionInput,
} from "@io/graph-module-core";
import {
  describeQueryEditorSurfaceAuthoringExclusions,
  getQueryEditorSurface,
  serializeQueryEditorDraft,
  validateQueryEditorDraft,
  type QueryEditorCatalog,
  type QueryEditorDraft,
  type QueryEditorSurfaceSpec,
} from "@io/graph-module-core/react-dom/query-editor";

import {
  validateQueryContainerSpec,
  type QueryContainerSourceResolver,
  type QueryContainerSpec,
  type QuerySurfaceRendererCompatibility,
} from "./query-container.js";
import type { QueryRendererCapability } from "./query-container.js";

export type SavedQueryRecord = {
  readonly catalogId: string;
  readonly catalogVersion: string;
  readonly id: string;
  readonly name: string;
  readonly parameterDefinitions: SavedQueryDefinition["parameterDefinitions"];
  readonly request: SavedQueryDefinition["request"];
  readonly surfaceId: string;
  readonly surfaceVersion: string;
  readonly updatedAt: string;
};

export type SavedViewRecord = {
  readonly catalogId: string;
  readonly catalogVersion: string;
  readonly id: string;
  readonly name: string;
  readonly queryId: string;
  readonly spec: Omit<QueryContainerSpec, "query"> & {
    readonly query: {
      readonly kind: "saved";
      readonly params?: Readonly<Record<string, QueryLiteral>>;
      readonly queryId: string;
    };
  };
  readonly surfaceId: string;
  readonly surfaceVersion: string;
  readonly updatedAt: string;
};

export type SavedQueryRecordInput = Omit<SavedQueryRecord, "id" | "updatedAt"> & {
  readonly id?: string;
};

export type SavedViewRecordInput = Omit<SavedViewRecord, "id" | "updatedAt"> & {
  readonly id?: string;
};

export type SavedQueryUpsertInput = Omit<SavedQueryDefinitionInput, "ownerId"> & {
  readonly id?: string;
  readonly ownerId?: string;
};

export type SavedViewUpsertInput = Omit<SavedViewDefinitionInput, "ownerId"> & {
  readonly id?: string;
  readonly ownerId?: string;
};

export type SavedQueryRecordLookup = {
  getSavedQuery(id: string): SavedQueryRecord | Promise<SavedQueryRecord | undefined> | undefined;
};

export type SavedQueryRepository = {
  deleteSavedQuery(id: string): Promise<void>;
  deleteSavedView(id: string): Promise<void>;
  getSavedQuery(id: string): Promise<SavedQueryDefinition | undefined>;
  getSavedView(id: string): Promise<SavedViewDefinition | undefined>;
  listSavedQueries(): Promise<readonly SavedQueryDefinition[]>;
  listSavedViews(): Promise<readonly SavedViewDefinition[]>;
  saveSavedQuery(input: SavedQueryUpsertInput): Promise<SavedQueryDefinition>;
  saveSavedView(input: SavedViewUpsertInput): Promise<SavedViewDefinition>;
};

export type SavedQueryResolution = {
  readonly normalizedRequest: NormalizedQueryRequest;
  readonly query: SavedQueryDefinition;
  readonly request: SerializedQueryRequest;
  readonly surface: QueryEditorSurfaceSpec;
};

export type SavedViewResolution = SavedQueryResolution & {
  readonly view: SavedViewDefinition;
};

export type SavedQueryCompatibilityResult =
  | {
      readonly ok: true;
      readonly surface: QueryEditorSurfaceSpec;
    }
  | {
      readonly code: "incompatible-query" | "stale-query";
      readonly message: string;
      readonly ok: false;
    };

export type SavedViewCompatibilityResult =
  | {
      readonly ok: true;
      readonly surface: QueryEditorSurfaceSpec;
    }
  | {
      readonly code: "incompatible-view" | "stale-view";
      readonly message: string;
      readonly ok: false;
    };

export class SavedQuerySaveError extends Error {
  readonly code: string;
  readonly issues?: readonly {
    readonly code: string;
    readonly message: string;
    readonly path: string;
  }[];

  constructor(
    code: string,
    message: string,
    options: {
      readonly issues?: readonly {
        readonly code: string;
        readonly message: string;
        readonly path: string;
      }[];
    } = {},
  ) {
    super(message);
    this.code = code;
    this.issues = options.issues;
    this.name = "SavedQuerySaveError";
  }
}

export function createGraphBackedSavedQueryRepository(
  graph: SavedQueryGraphClient,
  options:
    | {
        readonly ownerId?: string;
      }
    | string = {},
): SavedQueryRepository {
  const ownerId = typeof options === "string" ? options : options.ownerId;

  return {
    async deleteSavedQuery(id) {
      const query = await readOwnedSavedQuery(graph, id, ownerId);
      if (!query) return;
      for (const view of graph.savedView.list()) {
        if (view.query === id) {
          graph.savedView.delete(view.id);
        }
      }
      for (const parameter of graph.savedQueryParameter.list()) {
        if (parameter.query === id) {
          graph.savedQueryParameter.delete(parameter.id);
        }
      }
      graph.savedQuery.delete(id);
    },
    async deleteSavedView(id) {
      const view = await readOwnedSavedView(graph, id, ownerId);
      if (!view) return;
      graph.savedView.delete(view.id);
    },
    async getSavedQuery(id) {
      return readOwnedSavedQuery(graph, id, ownerId);
    },
    async getSavedView(id) {
      return readOwnedSavedView(graph, id, ownerId);
    },
    async listSavedQueries() {
      const queries = await Promise.all(
        graph.savedQuery.list().map((entry) => readSavedQueryDefinition(graph, entry.id)),
      );
      return queries
        .filter((query) => matchesOwner(query.ownerId, ownerId))
        .sort(compareSavedEntries);
    },
    async listSavedViews() {
      return graph.savedView
        .list()
        .map((entry) => readSavedViewDefinition(graph, entry.id))
        .filter((view) => matchesOwner(view.ownerId, ownerId))
        .sort(compareSavedEntries);
    },
    async saveSavedQuery(input) {
      const resolvedOwnerId = resolveOwnerId("Saved query", input.ownerId, ownerId);
      const existing = input.id ? await readRawSavedQuery(graph, input.id) : undefined;
      if (existing && !matchesOwner(existing.ownerId, ownerId)) {
        throw new SavedQuerySaveError(
          "saved-query-owner-mismatch",
          `Saved query "${input.id}" belongs to another owner.`,
        );
      }
      if (existing) {
        return updateSavedQueryDefinition(graph, existing.id, {
          ...input,
          ownerId: resolvedOwnerId,
        });
      }
      const { id: _ignoredId, ownerId: _ignoredOwnerId, ...createInput } = input;
      return createSavedQueryDefinition(graph, {
        ...createInput,
        ownerId: resolvedOwnerId,
      });
    },
    async saveSavedView(input) {
      const resolvedOwnerId = resolveOwnerId("Saved view", input.ownerId, ownerId);
      const existing = input.id ? await readRawSavedView(graph, input.id) : undefined;
      if (existing && !matchesOwner(existing.ownerId, ownerId)) {
        throw new SavedQuerySaveError(
          "saved-view-owner-mismatch",
          `Saved view "${input.id}" belongs to another owner.`,
        );
      }
      const query = await readOwnedSavedQuery(graph, input.queryId, resolvedOwnerId);
      if (!query) {
        throw new SavedQuerySaveError(
          "missing-query",
          `Saved view "${input.id ?? (input.name.trim() || "Untitled view")}" references missing saved query "${input.queryId}".`,
        );
      }
      if (query.ownerId !== resolvedOwnerId) {
        throw new SavedQuerySaveError(
          "saved-view-owner-mismatch",
          `Saved view owner "${resolvedOwnerId}" does not match saved query owner "${query.ownerId}".`,
        );
      }
      if (existing) {
        return updateSavedViewDefinition(graph, existing.id, {
          ...input,
          ownerId: resolvedOwnerId,
        });
      }
      const { id: _ignoredId, ownerId: _ignoredOwnerId, ...createInput } = input;
      return createSavedViewDefinition(graph, {
        ...createInput,
        ownerId: resolvedOwnerId,
      });
    },
  };
}

export function createSavedQueryDefinitionInputFromDraft(input: {
  readonly catalog: QueryEditorCatalog;
  readonly draft: QueryEditorDraft;
  readonly name: string;
  readonly ownerId?: string;
}): SavedQueryUpsertInput {
  const validation = validateQueryEditorDraft(input.draft, input.catalog);
  if (!validation.ok) {
    throw new SavedQuerySaveError(
      validation.issues[0]?.code ?? "invalid-draft",
      validation.issues[0]?.message ?? "Query draft is invalid.",
      {
        issues: validation.issues,
      },
    );
  }
  const serialized = serializeQueryEditorDraft(input.draft, input.catalog);
  const surfaceRef = requireInstalledSurfaceRef(serialized.surface);
  return {
    name: input.name.trim() || "Untitled query",
    ownerId: input.ownerId,
    parameterDefinitions: serialized.parameterDefinitions,
    request: serialized.request,
    surface: surfaceRef,
  };
}

export function createSavedQueryRecordInputFromDraft(input: {
  readonly catalog: QueryEditorCatalog;
  readonly draft: QueryEditorDraft;
  readonly name: string;
}): SavedQueryRecordInput {
  const validation = validateQueryEditorDraft(input.draft, input.catalog);
  if (!validation.ok) {
    throw new SavedQuerySaveError(
      validation.issues[0]?.code ?? "invalid-draft",
      validation.issues[0]?.message ?? "Query draft is invalid.",
      {
        issues: validation.issues,
      },
    );
  }
  const serialized = serializeQueryEditorDraft(input.draft, input.catalog);
  const surfaceRef = requireInstalledSurfaceRef(serialized.surface);
  return {
    catalogId: surfaceRef.catalogId,
    catalogVersion: surfaceRef.catalogVersion,
    name: input.name.trim() || "Untitled query",
    parameterDefinitions: serialized.parameterDefinitions,
    request: serialized.request,
    surfaceId: surfaceRef.surfaceId,
    surfaceVersion: surfaceRef.surfaceVersion,
  };
}

export function createSavedViewDefinitionInput(input: {
  readonly name: string;
  readonly ownerId?: string;
  readonly queryId: string;
  readonly rendererCapabilities: Readonly<Record<string, QueryRendererCapability>>;
  readonly spec: Omit<QueryContainerSpec, "query">;
  readonly surface: QuerySurfaceRendererCompatibility;
}): SavedViewUpsertInput {
  const validation = validateQueryContainerSpec(
    {
      ...input.spec,
      query: {
        kind: "saved",
        queryId: input.queryId,
      },
    },
    {
      rendererCapabilities: input.rendererCapabilities,
      surface: input.surface,
    },
  );
  if (!validation.ok) {
    const issue = validation.issues[0];
    throw new SavedQuerySaveError(
      issue?.code ?? "invalid-view",
      issue ? formatValidationIssue(issue) : "Saved view is invalid.",
      {
        issues: validation.issues,
      },
    );
  }
  return {
    containerId: input.spec.containerId,
    ...(input.spec.pagination || input.spec.refresh
      ? {
          containerDefaults: {
            ...(input.spec.pagination ? { pagination: input.spec.pagination } : {}),
            ...(input.spec.refresh ? { refresh: input.spec.refresh } : {}),
          },
        }
      : {}),
    name: input.name.trim() || "Untitled view",
    ownerId: input.ownerId,
    queryId: input.queryId,
    ...(input.spec.renderer.definition
      ? { rendererDefinition: input.spec.renderer.definition }
      : {}),
    rendererId: input.spec.renderer.rendererId,
  };
}

export function createSavedViewRecordInput(input: {
  readonly name: string;
  readonly query: SavedQueryRecord;
  readonly rendererCapabilities: Readonly<Record<string, QueryRendererCapability>>;
  readonly spec: Omit<QueryContainerSpec, "query">;
  readonly surface: QuerySurfaceRendererCompatibility;
}): SavedViewRecordInput {
  const definition = createSavedViewDefinitionInput({
    name: input.name,
    queryId: input.query.id,
    rendererCapabilities: input.rendererCapabilities,
    spec: input.spec,
    surface: input.surface,
  });
  return {
    catalogId: input.query.catalogId,
    catalogVersion: input.query.catalogVersion,
    name: definition.name,
    queryId: input.query.id,
    spec: {
      containerId: definition.containerId,
      ...(definition.containerDefaults?.pagination
        ? { pagination: definition.containerDefaults.pagination }
        : {}),
      query: {
        kind: "saved",
        ...(definition.queryParams ? { params: definition.queryParams } : {}),
        queryId: input.query.id,
      },
      ...(definition.containerDefaults?.refresh
        ? { refresh: definition.containerDefaults.refresh }
        : {}),
      renderer: {
        ...(definition.rendererDefinition ? { definition: definition.rendererDefinition } : {}),
        rendererId: definition.rendererId,
      },
    },
    surfaceId: input.query.surfaceId,
    surfaceVersion: input.query.surfaceVersion,
  };
}

export function deriveSavedQueryRecord(query: SavedQueryDefinition): SavedQueryRecord {
  if (!query.surface) {
    throw new SavedQuerySaveError(
      "missing-surface",
      `Saved query "${query.id}" does not include surface compatibility metadata.`,
    );
  }
  return {
    catalogId: query.surface.catalogId,
    catalogVersion: query.surface.catalogVersion,
    id: query.id,
    name: query.name,
    parameterDefinitions: query.parameterDefinitions,
    request: query.request,
    surfaceId: query.surface.surfaceId,
    surfaceVersion: query.surface.surfaceVersion,
    updatedAt: query.updatedAt.toISOString(),
  };
}

export function deriveSavedViewRecord(input: {
  readonly query: SavedQueryDefinition;
  readonly view: SavedViewDefinition;
}): SavedViewRecord {
  const query = deriveSavedQueryRecord(input.query);
  return {
    catalogId: query.catalogId,
    catalogVersion: query.catalogVersion,
    id: input.view.id,
    name: input.view.name,
    queryId: input.view.queryId,
    spec: {
      containerId: input.view.containerId,
      ...(input.view.containerDefaults?.pagination
        ? { pagination: input.view.containerDefaults.pagination }
        : {}),
      query: {
        kind: "saved",
        ...(input.view.queryParams ? { params: input.view.queryParams } : {}),
        queryId: input.view.queryId,
      },
      ...(input.view.containerDefaults?.refresh
        ? { refresh: input.view.containerDefaults.refresh }
        : {}),
      renderer: {
        ...(input.view.rendererDefinition ? { definition: input.view.rendererDefinition } : {}),
        rendererId: input.view.rendererId,
      },
    },
    surfaceId: query.surfaceId,
    surfaceVersion: query.surfaceVersion,
    updatedAt: input.view.updatedAt.toISOString(),
  };
}

export function toSavedQueryDefinitionInput(
  input: SavedQueryRecordInput,
  ownerId: string,
  moduleId: string,
): SavedQueryDefinitionInput {
  return {
    name: input.name,
    ownerId,
    parameterDefinitions: input.parameterDefinitions,
    request: input.request,
    surface: {
      moduleId,
      catalogId: input.catalogId,
      catalogVersion: input.catalogVersion,
      surfaceId: input.surfaceId,
      surfaceVersion: input.surfaceVersion,
    },
  };
}

export function toSavedViewDefinitionInput(
  input: SavedViewRecordInput,
  ownerId: string,
): SavedViewDefinitionInput {
  return {
    containerId: input.spec.containerId,
    ...(input.spec.pagination || input.spec.refresh
      ? {
          containerDefaults: {
            ...(input.spec.pagination ? { pagination: input.spec.pagination } : {}),
            ...(input.spec.refresh ? { refresh: input.spec.refresh } : {}),
          },
        }
      : {}),
    name: input.name,
    ownerId,
    queryId: input.queryId,
    ...(input.spec.query.params ? { queryParams: input.spec.query.params } : {}),
    ...(input.spec.renderer.definition
      ? { rendererDefinition: input.spec.renderer.definition }
      : {}),
    rendererId: input.spec.renderer.rendererId,
  };
}

export async function resolveSavedQueryDefinition(input: {
  readonly catalog: QueryEditorCatalog;
  readonly executionContext?: QueryIdentityExecutionContext;
  readonly params?: Readonly<Record<string, QueryLiteral>>;
  readonly query: SavedQueryDefinition;
}): Promise<SavedQueryResolution> {
  const compatibility = validateSavedQueryCompatibility(
    deriveSavedQueryRecord(input.query),
    input.catalog,
  );
  if (!compatibility.ok) {
    const error = new Error(compatibility.message);
    (error as Error & { code: string }).code = compatibility.code;
    throw error;
  }
  const request = mergeQueryParams(input.query.request, input.params);
  validateSerializedQueryRequest(request, {
    parameterDefinitions: input.query.parameterDefinitions,
  });
  const normalizedRequest = await normalizeSerializedQueryRequest(request, {
    executionContext: input.executionContext,
    parameterDefinitions: input.query.parameterDefinitions,
  });
  return {
    normalizedRequest,
    query: input.query,
    request,
    surface: compatibility.surface,
  };
}

export async function resolveSavedViewDefinition(input: {
  readonly catalog: QueryEditorCatalog;
  readonly executionContext?: QueryIdentityExecutionContext;
  readonly params?: Readonly<Record<string, QueryLiteral>>;
  readonly query: SavedQueryDefinition;
  readonly rendererCapabilities?: Readonly<Record<string, QueryRendererCapability>>;
  readonly resolveSurfaceCompatibility?: (
    surfaceId: string,
  ) => QuerySurfaceRendererCompatibility | undefined;
  readonly view: SavedViewDefinition;
}): Promise<SavedViewResolution> {
  const compatibility = validateSavedViewCompatibility({
    catalog: input.catalog,
    query: deriveSavedQueryRecord(input.query),
    rendererCapabilities: input.rendererCapabilities,
    resolveSurfaceCompatibility: input.resolveSurfaceCompatibility,
    view: deriveSavedViewRecord({
      query: input.query,
      view: input.view,
    }),
  });
  if (!compatibility.ok) {
    const error = new Error(compatibility.message);
    (error as Error & { code: string }).code = compatibility.code;
    throw error;
  }
  const resolvedQuery = await resolveSavedQueryDefinition({
    catalog: input.catalog,
    executionContext: input.executionContext,
    params: input.params ?? input.view.queryParams,
    query: input.query,
  });
  return {
    ...resolvedQuery,
    view: input.view,
  };
}

export async function resolveSavedViewRecord(input: {
  readonly catalog: QueryEditorCatalog;
  readonly executionContext?: QueryIdentityExecutionContext;
  readonly params?: Readonly<Record<string, QueryLiteral>>;
  readonly query: SavedQueryRecord;
  readonly rendererCapabilities?: Readonly<Record<string, QueryRendererCapability>>;
  readonly resolveSurfaceCompatibility?: (
    surfaceId: string,
  ) => QuerySurfaceRendererCompatibility | undefined;
  readonly view: SavedViewRecord;
}): Promise<SavedViewResolution> {
  return resolveSavedViewDefinition({
    catalog: input.catalog,
    executionContext: input.executionContext,
    params: input.params,
    query: createDerivedSavedQueryDefinition(input.query),
    rendererCapabilities: input.rendererCapabilities,
    resolveSurfaceCompatibility: input.resolveSurfaceCompatibility,
    view: createDerivedSavedViewDefinition(input.view),
  });
}

export function createSavedQueryRecordSourceResolver(
  store: SavedQueryRecordLookup,
  options: {
    readonly catalog?: QueryEditorCatalog;
  } = {},
): QueryContainerSourceResolver {
  return async (source) => {
    if (source.kind === "inline") {
      return { request: source.request };
    }
    const saved = await store.getSavedQuery(source.queryId);
    if (!saved) {
      const error = new Error(`Saved query "${source.queryId}" is no longer available.`);
      (error as Error & { code: string }).code = "saved-query-stale";
      throw error;
    }
    if (options.catalog) {
      const compatibility = validateSavedQueryCompatibility(saved, options.catalog);
      if (!compatibility.ok) {
        const error = new Error(compatibility.message);
        (error as Error & { code: string }).code =
          compatibility.code === "stale-query" ? "saved-query-stale" : "saved-query-incompatible";
        throw error;
      }
    }
    const request = mergeQueryParams(saved.request, source.params);
    validateSerializedQueryRequest(request, {
      parameterDefinitions: saved.parameterDefinitions,
    });
    return {
      request,
      sourceCacheKey: `saved:${saved.id}`,
    };
  };
}

export function validateSavedQueryCompatibility(
  query: SavedQueryRecord,
  catalog: QueryEditorCatalog,
): SavedQueryCompatibilityResult {
  const requestSurfaceId = resolveSerializedSurfaceId(query.request);
  if (!requestSurfaceId) {
    return {
      code: "incompatible-query",
      message: `Saved query "${query.id}" uses unsupported query kind "${query.request.query.kind}".`,
      ok: false,
    };
  }
  if (requestSurfaceId !== query.surfaceId) {
    return {
      code: "incompatible-query",
      message:
        `Saved query "${query.id}" references surface "${query.surfaceId}" ` +
        `but serializes "${requestSurfaceId}".`,
      ok: false,
    };
  }
  const surface = getQueryEditorSurface(catalog, query.surfaceId);
  if (!surface) {
    return {
      code: "stale-query",
      message: `Saved query "${query.id}" references removed query surface "${query.surfaceId}".`,
      ok: false,
    };
  }
  const currentRef = readInstalledSurfaceRef(surface);
  if (!currentRef) {
    return {
      code: "incompatible-query",
      message:
        `Saved query "${query.id}" cannot be validated because query surface ` +
        `"${query.surfaceId}" does not expose installed catalog metadata.`,
      ok: false,
    };
  }
  if (currentRef.catalogId !== query.catalogId) {
    return {
      code: "stale-query",
      message: `Saved query "${query.id}" references removed query catalog "${query.catalogId}".`,
      ok: false,
    };
  }
  if (currentRef.catalogVersion !== query.catalogVersion) {
    return {
      code: "incompatible-query",
      message:
        `Saved query "${query.id}" references incompatible query catalog ` +
        `"${query.catalogId}@${query.catalogVersion}".`,
      ok: false,
    };
  }
  if (currentRef.surfaceVersion !== query.surfaceVersion) {
    return {
      code: "incompatible-query",
      message:
        `Saved query "${query.id}" references incompatible surface version ` +
        `"${query.surfaceVersion}".`,
      ok: false,
    };
  }
  const surfaceExclusionMessage = describeQueryEditorSurfaceAuthoringExclusions(surface);
  if (surfaceExclusionMessage) {
    return {
      code: "incompatible-query",
      message:
        `Saved query "${query.id}" can no longer be authored against surface "${query.surfaceId}": ` +
        surfaceExclusionMessage,
      ok: false,
    };
  }
  return {
    ok: true,
    surface,
  };
}

export function validateSavedViewCompatibility(input: {
  readonly catalog: QueryEditorCatalog;
  readonly query: SavedQueryRecord;
  readonly rendererCapabilities?: Readonly<Record<string, QueryRendererCapability>>;
  readonly resolveSurfaceCompatibility?: (
    surfaceId: string,
  ) => QuerySurfaceRendererCompatibility | undefined;
  readonly view: SavedViewRecord;
}): SavedViewCompatibilityResult {
  const { catalog, query, rendererCapabilities, resolveSurfaceCompatibility, view } = input;
  const queryCompatibility = validateSavedQueryCompatibility(query, catalog);
  if (!queryCompatibility.ok) {
    return {
      code: queryCompatibility.code === "stale-query" ? "stale-view" : "incompatible-view",
      message:
        `Saved view "${view.id}" references saved query "${query.id}" ` +
        `that is no longer valid: ${queryCompatibility.message}`,
      ok: false,
    };
  }
  if (view.spec.query.queryId !== view.queryId) {
    return {
      code: "incompatible-view",
      message:
        `Saved view "${view.id}" references saved query "${view.spec.query.queryId}" ` +
        `in its container binding but is stored against "${view.queryId}".`,
      ok: false,
    };
  }
  if (view.surfaceId !== query.surfaceId) {
    return {
      code: "incompatible-view",
      message:
        `Saved view "${view.id}" references surface "${view.surfaceId}" ` +
        `but saved query "${query.id}" uses "${query.surfaceId}".`,
      ok: false,
    };
  }
  if (view.catalogId !== query.catalogId || view.catalogVersion !== query.catalogVersion) {
    return {
      code: "incompatible-view",
      message:
        `Saved view "${view.id}" references query catalog ` +
        `"${view.catalogId}@${view.catalogVersion}" but saved query "${query.id}" uses ` +
        `"${query.catalogId}@${query.catalogVersion}".`,
      ok: false,
    };
  }
  if (view.surfaceVersion !== query.surfaceVersion) {
    return {
      code: "incompatible-view",
      message:
        `Saved view "${view.id}" references surface version "${view.surfaceVersion}" ` +
        `but saved query "${query.id}" uses "${query.surfaceVersion}".`,
      ok: false,
    };
  }
  const surfaceCompatibility = resolveSurfaceCompatibility?.(view.surfaceId);
  if (resolveSurfaceCompatibility && !surfaceCompatibility) {
    return {
      code: "stale-view",
      message:
        `Saved view "${view.id}" references query surface "${view.surfaceId}" ` +
        `but the current renderer compatibility contract is missing.`,
      ok: false,
    };
  }
  if (surfaceCompatibility && rendererCapabilities) {
    const containerValidation = validateQueryContainerSpec(createSavedViewContainerSpec(view), {
      rendererCapabilities,
      surface: surfaceCompatibility,
    });
    if (!containerValidation.ok) {
      return {
        code: "incompatible-view",
        message:
          `Saved view "${view.id}" has incompatible container defaults: ` +
          `${formatValidationIssue(containerValidation.issues[0])}`,
        ok: false,
      };
    }
  }
  return {
    ok: true,
    surface: queryCompatibility.surface,
  };
}

function createSavedViewContainerSpec(view: SavedViewRecord): QueryContainerSpec {
  return {
    containerId: view.spec.containerId,
    ...(view.spec.pagination ? { pagination: view.spec.pagination } : {}),
    query: {
      kind: "saved",
      ...(view.spec.query.params ? { params: view.spec.query.params } : {}),
      queryId: view.queryId,
    },
    ...(view.spec.refresh ? { refresh: view.spec.refresh } : {}),
    renderer: {
      ...(view.spec.renderer.definition ? { definition: view.spec.renderer.definition } : {}),
      rendererId: view.spec.renderer.rendererId,
    },
  };
}

function createDerivedSavedQueryDefinition(record: SavedQueryRecord): SavedQueryDefinition {
  return {
    createdAt: new Date(record.updatedAt),
    definitionHash: `derived:${record.id}`,
    id: record.id,
    kind: record.request.query.kind,
    name: record.name,
    ownerId: "derived-owner",
    parameterDefinitions: record.parameterDefinitions,
    request: record.request,
    surface: {
      catalogId: record.catalogId,
      catalogVersion: record.catalogVersion,
      moduleId: "derived-module",
      surfaceId: record.surfaceId,
      surfaceVersion: record.surfaceVersion,
    },
    updatedAt: new Date(record.updatedAt),
  };
}

function createDerivedSavedViewDefinition(record: SavedViewRecord): SavedViewDefinition {
  return {
    containerId: record.spec.containerId,
    ...(record.spec.pagination || record.spec.refresh
      ? {
          containerDefaults: {
            ...(record.spec.pagination ? { pagination: record.spec.pagination } : {}),
            ...(record.spec.refresh ? { refresh: record.spec.refresh } : {}),
          },
        }
      : {}),
    createdAt: new Date(record.updatedAt),
    id: record.id,
    name: record.name,
    ownerId: "derived-owner",
    queryId: record.queryId,
    ...(record.spec.query.params ? { queryParams: record.spec.query.params } : {}),
    ...(record.spec.renderer.definition
      ? { rendererDefinition: record.spec.renderer.definition }
      : {}),
    rendererId: record.spec.renderer.rendererId,
    updatedAt: new Date(record.updatedAt),
  };
}

function resolveOwnerId(
  label: string,
  inputOwnerId: string | undefined,
  defaultOwnerId?: string,
): string {
  const ownerId = inputOwnerId?.trim() || defaultOwnerId?.trim();
  if (!ownerId) {
    throw new SavedQuerySaveError(
      "missing-owner-id",
      `${label} writes require a non-empty owner id.`,
    );
  }
  return ownerId;
}

function matchesOwner(recordOwnerId: string, ownerId?: string): boolean {
  return ownerId ? recordOwnerId === ownerId : true;
}

async function readRawSavedQuery(
  graph: SavedQueryGraphClient,
  id: string,
): Promise<SavedQueryDefinition | undefined> {
  if (!graph.savedQuery.list().some((entry) => entry.id === id)) {
    return undefined;
  }
  return readSavedQueryDefinition(graph, id);
}

async function readOwnedSavedQuery(
  graph: SavedQueryGraphClient,
  id: string,
  ownerId?: string,
): Promise<SavedQueryDefinition | undefined> {
  const query = await readRawSavedQuery(graph, id);
  return query && matchesOwner(query.ownerId, ownerId) ? query : undefined;
}

async function readRawSavedView(
  graph: SavedQueryGraphClient,
  id: string,
): Promise<SavedViewDefinition | undefined> {
  if (!graph.savedView.list().some((entry) => entry.id === id)) {
    return undefined;
  }
  return readSavedViewDefinition(graph, id);
}

async function readOwnedSavedView(
  graph: SavedQueryGraphClient,
  id: string,
  ownerId?: string,
): Promise<SavedViewDefinition | undefined> {
  const view = await readRawSavedView(graph, id);
  return view && matchesOwner(view.ownerId, ownerId) ? view : undefined;
}

function requireInstalledSurfaceRef(surface: QueryEditorSurfaceSpec): SavedQuerySurfaceBinding {
  const ref = readInstalledSurfaceRef(surface);
  if (!ref) {
    throw new SavedQuerySaveError(
      "missing-catalog-ref",
      `Query surface "${surface.surfaceId}" does not expose installed catalog metadata.`,
    );
  }
  return ref;
}

function readInstalledSurfaceRef(
  surface: QueryEditorSurfaceSpec,
): SavedQuerySurfaceBinding | undefined {
  const moduleId = readTrimmedString(surface.moduleId);
  const catalogId = readTrimmedString(surface.catalogId);
  const catalogVersion = readTrimmedString(surface.catalogVersion);
  if (!moduleId || !catalogId || !catalogVersion) {
    return undefined;
  }
  return {
    moduleId,
    catalogId,
    catalogVersion,
    surfaceId: surface.surfaceId,
    surfaceVersion: surface.surfaceVersion,
  };
}

function compareSavedEntries(
  left: { readonly name: string; readonly updatedAt: Date },
  right: { readonly name: string; readonly updatedAt: Date },
): number {
  return (
    right.updatedAt.getTime() - left.updatedAt.getTime() || left.name.localeCompare(right.name)
  );
}

function readTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function mergeQueryParams(
  request: SerializedQueryRequest,
  params?: Readonly<Record<string, QueryLiteral>>,
): SerializedQueryRequest {
  if (!params || Object.keys(params).length === 0) {
    return request;
  }
  return {
    ...request,
    params: {
      ...request.params,
      ...params,
    },
  };
}

function resolveSerializedSurfaceId(request: SerializedQueryRequest): string | undefined {
  if (request.query.kind === "collection") {
    return request.query.indexId;
  }
  if (request.query.kind === "scope") {
    return request.query.scopeId;
  }
  return undefined;
}

function formatValidationIssue(
  issue:
    | {
        readonly message: string;
        readonly path: string;
      }
    | undefined,
): string {
  return issue ? `${issue.path} ${issue.message}` : "Unknown validation issue.";
}
