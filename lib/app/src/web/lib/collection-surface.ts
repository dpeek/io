import type { CollectionSurfaceSpec } from "@io/graph-module";
import type { QueryEditorCatalog } from "@io/graph-module-core/react-dom";
import type { QuerySurfaceFieldKind } from "@io/graph-projection";

import {
  createQueryContainerRuntime,
  mountSavedQueryRenderer,
  validateQueryContainerSpec,
  type QueryContainerPageExecutor,
  type QueryContainerRuntimeController,
  type QueryContainerSourceResolver,
  type QueryContainerSpec,
  type QueryContainerValidationResult,
  type QueryRendererCapability,
  type QuerySurfaceRendererCompatibility,
} from "./query-container.js";
import { requestSerializedQuery } from "./query-transport.js";
import {
  createQuerySurfaceRendererCompatibility,
  getInstalledModuleQueryEditorCatalog,
  getInstalledModuleQuerySurface,
  getInstalledModuleQuerySurfaceRegistry,
  getInstalledModuleQuerySurfaceRendererCompatibility,
  type InstalledModuleQuerySurface,
  type InstalledModuleQuerySurfaceRegistry,
} from "./query-surface-registry.js";
import {
  createSavedQueryRecordSourceResolver,
  validateSavedQueryCompatibility,
  validateSavedViewCompatibility,
  type SavedQueryRecord,
  type SavedQueryRecordLookup,
  type SavedViewRecord,
} from "./saved-query.js";

type CollectionSurfacePresentationField = {
  readonly fieldId: string;
  readonly kind?: QuerySurfaceFieldKind;
  readonly label: string;
};

export type CollectionSurfaceRecordLookup = SavedQueryRecordLookup & {
  readonly getSavedView?: (
    id: string,
  ) => SavedViewRecord | Promise<SavedViewRecord | undefined> | undefined;
};

export type CollectionSurfaceBindingIssueCode =
  | "incompatible-view"
  | "incompatible-query"
  | "invalid-container"
  | "query-surface-missing"
  | "query-surface-renderers-missing"
  | "saved-query-missing"
  | "saved-view-missing"
  | "saved-view-resolver-missing"
  | "stale-query"
  | "stale-view"
  | "unknown-presentation-field"
  | "unsupported-presentation-kind"
  | "unsupported-source-kind";

export type CollectionSurfaceBindingIssue = {
  readonly code: CollectionSurfaceBindingIssueCode;
  readonly message: string;
};

export type CollectionSurfaceMountedBinding = {
  readonly collection: CollectionSurfaceSpec;
  readonly query: SavedQueryRecord;
  readonly querySurface: InstalledModuleQuerySurface;
  readonly spec: QueryContainerSpec;
  readonly surface: QuerySurfaceRendererCompatibility;
  readonly validation: QueryContainerValidationResult;
  readonly view?: SavedViewRecord;
};

export type CollectionSurfaceBindingResult =
  | {
      readonly binding: CollectionSurfaceMountedBinding;
      readonly ok: true;
    }
  | {
      readonly issue: CollectionSurfaceBindingIssue;
      readonly ok: false;
    };

export type CollectionSurfaceBindingOptions = {
  readonly catalog?: QueryEditorCatalog;
  readonly collection: CollectionSurfaceSpec;
  readonly lookup: CollectionSurfaceRecordLookup;
  readonly rendererCapabilities?: Readonly<Record<string, QueryRendererCapability>>;
  readonly resolveSurfaceCompatibility?: (
    surfaceId: string,
  ) => QuerySurfaceRendererCompatibility | undefined;
  readonly surfaceRegistry?: InstalledModuleQuerySurfaceRegistry;
};

const defaultQueryContainerRefresh = {
  mode: "manual",
} as const satisfies QueryContainerSpec["refresh"];

function createIssue(
  code: CollectionSurfaceBindingIssueCode,
  message: string,
): CollectionSurfaceBindingIssue {
  return { code, message };
}

function createCollectionSurfaceContainerId(collection: CollectionSurfaceSpec): string {
  return `collection-surface:${collection.key}`;
}

function preferredFieldId(
  fieldIds: readonly string[],
  preferred: readonly string[],
): string | undefined {
  for (const fieldId of preferred) {
    if (fieldIds.includes(fieldId)) {
      return fieldId;
    }
  }
  return fieldIds[0];
}

function mergePresentationField(
  existing: CollectionSurfacePresentationField | undefined,
  field: {
    readonly fieldId: string;
    readonly kind?: QuerySurfaceFieldKind;
    readonly label: string;
  },
): CollectionSurfacePresentationField {
  return {
    fieldId: field.fieldId,
    ...(existing?.kind ? { kind: existing.kind } : field.kind ? { kind: field.kind } : {}),
    label: existing?.label ?? field.label,
  };
}

function createPresentationFieldCatalog(
  querySurface: InstalledModuleQuerySurface,
): ReadonlyMap<string, CollectionSurfacePresentationField> {
  const fields = new Map<string, CollectionSurfacePresentationField>();

  for (const filter of querySurface.filters ?? []) {
    fields.set(
      filter.fieldId,
      mergePresentationField(fields.get(filter.fieldId), {
        fieldId: filter.fieldId,
        kind: filter.kind,
        label: filter.label,
      }),
    );
  }
  for (const ordering of querySurface.ordering ?? []) {
    fields.set(
      ordering.fieldId,
      mergePresentationField(fields.get(ordering.fieldId), {
        fieldId: ordering.fieldId,
        label: ordering.label,
      }),
    );
  }
  for (const selection of querySurface.selections ?? []) {
    fields.set(
      selection.fieldId,
      mergePresentationField(fields.get(selection.fieldId), {
        fieldId: selection.fieldId,
        label: selection.label,
      }),
    );
  }

  return fields;
}

function readCatalogField(
  fieldCatalog: ReadonlyMap<string, CollectionSurfacePresentationField>,
  fieldId: string,
  collection: CollectionSurfaceSpec,
  querySurface: InstalledModuleQuerySurface,
): CollectionSurfacePresentationField {
  const field = fieldCatalog.get(fieldId);
  const surfaceExposesFields =
    (querySurface.selections?.length ?? 0) > 0 ||
    (querySurface.ordering?.length ?? 0) > 0 ||
    (querySurface.filters?.length ?? 0) > 0;
  if (field) {
    return field;
  }
  if (surfaceExposesFields) {
    throw createIssue(
      "unknown-presentation-field",
      `Collection surface "${collection.key}" references unknown presentation field "${fieldId}" for query surface "${querySurface.surfaceId}".`,
    );
  }
  return {
    fieldId,
    label: fieldId,
  };
}

function mapPresentationFields(
  fields: readonly { readonly fieldId: string }[],
  fieldCatalog: ReadonlyMap<string, CollectionSurfacePresentationField>,
  collection: CollectionSurfaceSpec,
  querySurface: InstalledModuleQuerySurface,
): CollectionSurfacePresentationField[] {
  return fields.map((field) =>
    readCatalogField(fieldCatalog, field.fieldId, collection, querySurface),
  );
}

function readPresentationFields(
  collection: CollectionSurfaceSpec,
  querySurface: InstalledModuleQuerySurface,
): CollectionSurfacePresentationField[] {
  const fieldCatalog = createPresentationFieldCatalog(querySurface);
  const requestedFields = collection.presentation.fields;
  if (requestedFields && requestedFields.length > 0) {
    return requestedFields.map((fieldId) =>
      readCatalogField(fieldCatalog, fieldId, collection, querySurface),
    );
  }

  const defaultSelections =
    querySurface.selections?.filter((selection) => selection.defaultSelected) ?? [];
  if (defaultSelections.length > 0) {
    return mapPresentationFields(defaultSelections, fieldCatalog, collection, querySurface);
  }
  if ((querySurface.selections?.length ?? 0) > 0) {
    return mapPresentationFields(
      querySurface.selections ?? [],
      fieldCatalog,
      collection,
      querySurface,
    );
  }
  if ((querySurface.ordering?.length ?? 0) > 0 || (querySurface.filters?.length ?? 0) > 0) {
    const fallbackFields = [
      ...(querySurface.ordering ?? []),
      ...(querySurface.filters ?? []).filter(
        (field) =>
          !(querySurface.ordering ?? []).some((ordering) => ordering.fieldId === field.fieldId),
      ),
    ];
    return mapPresentationFields(fallbackFields, fieldCatalog, collection, querySurface);
  }
  return [];
}

function readTableColumnAlignment(
  kind: QuerySurfaceFieldKind | undefined,
): "center" | "end" | "start" | undefined {
  const baseKind = kind?.endsWith("-list") ? kind.slice(0, -5) : kind;
  switch (baseKind) {
    case "boolean":
      return "center";
    case "date":
    case "number":
    case "percent":
    case "duration":
    case "money":
    case "quantity":
    case "range":
    case "rate":
      return "end";
    default:
      return undefined;
  }
}

function createListRendererBinding(fields: readonly CollectionSurfacePresentationField[]) {
  const fieldIds = fields.map((field) => field.fieldId);
  const titleField = preferredFieldId(fieldIds, ["title", "name", "label"]);
  const descriptionField = preferredFieldId(
    fieldIds.filter((fieldId) => fieldId !== titleField),
    ["summary", "description", "subtitle", "state", "status"],
  );
  const metaFields = fields.filter(
    (field) => field.fieldId !== titleField && field.fieldId !== descriptionField,
  );

  return {
    definition: {
      item: {
        ...(descriptionField ? { descriptionField } : {}),
        ...(metaFields.length > 0 ? { metaFields } : {}),
        ...(titleField ? { titleField } : {}),
      },
      kind: "list" as const,
    },
    rendererId: "core:list",
  } satisfies QueryContainerSpec["renderer"];
}

function createTableRendererBinding(fields: readonly CollectionSurfacePresentationField[]) {
  return {
    definition: {
      columns: fields.map((field) => {
        const align = readTableColumnAlignment(field.kind);
        return {
          ...(align ? { align } : {}),
          fieldId: field.fieldId,
          ...(field.kind ? { kind: field.kind } : {}),
          label: field.label,
        };
      }),
      kind: "table" as const,
    },
    rendererId: "core:table",
  } satisfies QueryContainerSpec["renderer"];
}

function createCardGridRendererBinding(fields: readonly CollectionSurfacePresentationField[]) {
  const fieldIds = fields.map((field) => field.fieldId);
  const titleField = preferredFieldId(fieldIds, ["title", "name", "label"]);
  const descriptionField = preferredFieldId(
    fieldIds.filter((fieldId) => fieldId !== titleField),
    ["summary", "description", "subtitle"],
  );
  const detailFields = fields.filter(
    (field) => field.fieldId !== titleField && field.fieldId !== descriptionField,
  );

  return {
    definition: {
      card: {
        ...(descriptionField ? { descriptionField } : {}),
        ...(detailFields.length > 0 ? { fields: detailFields } : {}),
        ...(titleField ? { titleField } : {}),
      },
      kind: "card-grid" as const,
    },
    rendererId: "core:card-grid",
  } satisfies QueryContainerSpec["renderer"];
}

function createCollectionSurfaceRendererBinding(
  collection: CollectionSurfaceSpec,
  querySurface: InstalledModuleQuerySurface,
): QueryContainerSpec["renderer"] {
  const fields = readPresentationFields(collection, querySurface);

  switch (collection.presentation.kind) {
    case "list":
      return createListRendererBinding(fields);
    case "table":
      return createTableRendererBinding(fields);
    case "cardGrid":
      return createCardGridRendererBinding(fields);
    case "board":
      throw createIssue(
        "unsupported-presentation-kind",
        `Collection surface "${collection.key}" uses unsupported presentation kind "board" for the current query-container renderer runtime.`,
      );
  }
}

function createCollectionSurfaceQuerySpec(
  collection: CollectionSurfaceSpec,
  query: SavedQueryRecord,
  querySurface: InstalledModuleQuerySurface,
): QueryContainerSpec {
  return mountSavedQueryRenderer(
    {
      queryId: query.id,
    },
    {
      containerId: createCollectionSurfaceContainerId(collection),
      pagination: {
        mode: "paged",
        pageSize: querySurface.defaultPageSize ?? 25,
      },
      refresh: defaultQueryContainerRefresh,
      renderer: createCollectionSurfaceRendererBinding(collection, querySurface),
    },
  );
}

function createCollectionSurfaceSavedViewSpec(
  collection: CollectionSurfaceSpec,
  query: SavedQueryRecord,
  view: SavedViewRecord,
): QueryContainerSpec {
  return {
    containerId: createCollectionSurfaceContainerId(collection),
    ...(view.spec.pagination ? { pagination: view.spec.pagination } : {}),
    query: {
      kind: "saved",
      ...(view.spec.query.params ? { params: view.spec.query.params } : {}),
      queryId: query.id,
    },
    ...(view.spec.refresh
      ? { refresh: view.spec.refresh }
      : { refresh: defaultQueryContainerRefresh }),
    renderer: {
      ...(view.spec.renderer.definition ? { definition: view.spec.renderer.definition } : {}),
      rendererId: view.spec.renderer.rendererId,
    },
  };
}

export async function resolveCollectionSurfaceBinding(
  input: CollectionSurfaceBindingOptions,
): Promise<CollectionSurfaceBindingResult> {
  const { collection, lookup } = input;
  if (collection.source.kind !== "query") {
    return {
      issue: createIssue(
        "unsupported-source-kind",
        `Collection surface "${collection.key}" uses source kind "${collection.source.kind}", but the current browser binding only supports query-backed collection surfaces.`,
      ),
      ok: false,
    };
  }

  const query = await lookup.getSavedQuery(collection.source.query);
  if (!query) {
    return {
      issue: createIssue(
        "saved-query-missing",
        `Collection surface "${collection.key}" references missing saved query "${collection.source.query}".`,
      ),
      ok: false,
    };
  }

  const catalog = input.catalog ?? getInstalledModuleQueryEditorCatalog();
  const queryCompatibility = validateSavedQueryCompatibility(query, catalog);
  if (!queryCompatibility.ok) {
    return {
      issue: createIssue(queryCompatibility.code, queryCompatibility.message),
      ok: false,
    };
  }

  const surfaceRegistry = input.surfaceRegistry ?? getInstalledModuleQuerySurfaceRegistry();
  const querySurface = getInstalledModuleQuerySurface(surfaceRegistry, query.surfaceId);
  if (!querySurface) {
    return {
      issue: createIssue(
        "query-surface-missing",
        `Collection surface "${collection.key}" cannot resolve installed query surface "${query.surfaceId}".`,
      ),
      ok: false,
    };
  }

  const surfaceCompatibility =
    input.resolveSurfaceCompatibility?.(query.surfaceId) ??
    createQuerySurfaceRendererCompatibility(querySurface);
  if (!surfaceCompatibility) {
    return {
      issue: createIssue(
        "query-surface-renderers-missing",
        `Collection surface "${collection.key}" cannot mount query surface "${query.surfaceId}" because it does not expose renderer compatibility.`,
      ),
      ok: false,
    };
  }

  let view: SavedViewRecord | undefined;
  let spec: QueryContainerSpec;
  try {
    if (collection.source.savedView) {
      if (!lookup.getSavedView) {
        return {
          issue: createIssue(
            "saved-view-resolver-missing",
            `Collection surface "${collection.key}" references saved view "${collection.source.savedView}" without a saved-view lookup.`,
          ),
          ok: false,
        };
      }
      view = await lookup.getSavedView(collection.source.savedView);
      if (!view) {
        return {
          issue: createIssue(
            "saved-view-missing",
            `Collection surface "${collection.key}" references missing saved view "${collection.source.savedView}".`,
          ),
          ok: false,
        };
      }
      const viewCompatibility = validateSavedViewCompatibility({
        catalog,
        query,
        rendererCapabilities: input.rendererCapabilities,
        resolveSurfaceCompatibility:
          input.resolveSurfaceCompatibility ?? getInstalledModuleQuerySurfaceRendererCompatibility,
        view,
      });
      if (!viewCompatibility.ok) {
        return {
          issue: createIssue(viewCompatibility.code, viewCompatibility.message),
          ok: false,
        };
      }
      spec = createCollectionSurfaceSavedViewSpec(collection, query, view);
    } else {
      spec = createCollectionSurfaceQuerySpec(collection, query, querySurface);
    }
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      "message" in error &&
      typeof (error as { code?: unknown }).code === "string" &&
      typeof (error as { message?: unknown }).message === "string"
    ) {
      return {
        issue: createIssue(
          (error as { code: CollectionSurfaceBindingIssueCode }).code,
          (error as { message: string }).message,
        ),
        ok: false,
      };
    }
    throw error;
  }

  const validation = validateQueryContainerSpec(spec, {
    rendererCapabilities: input.rendererCapabilities,
    surface: surfaceCompatibility,
  });
  if (!validation.ok && spec.containerId.trim().length === 0) {
    return {
      issue: createIssue(
        "invalid-container",
        `Collection surface "${collection.key}" produced an invalid query container id.`,
      ),
      ok: false,
    };
  }

  return {
    binding: {
      collection,
      query,
      querySurface,
      spec,
      surface: surfaceCompatibility,
      validation,
      ...(view ? { view } : {}),
    },
    ok: true,
  };
}

export function createCollectionSurfaceSourceResolver(
  lookup: Pick<CollectionSurfaceRecordLookup, "getSavedQuery">,
  options: {
    readonly catalog?: QueryEditorCatalog;
  } = {},
): QueryContainerSourceResolver {
  return createSavedQueryRecordSourceResolver(lookup, options);
}

export function createCollectionSurfaceRuntime(
  lookup: Pick<CollectionSurfaceRecordLookup, "getSavedQuery">,
  options: {
    readonly catalog?: QueryEditorCatalog;
    readonly executePage?: QueryContainerPageExecutor;
  } = {},
): QueryContainerRuntimeController {
  return createQueryContainerRuntime({
    executePage:
      options.executePage ??
      ((request, runtimeOptions) =>
        requestSerializedQuery(request, { signal: runtimeOptions.signal })),
    resolveSource: createCollectionSurfaceSourceResolver(lookup, {
      catalog: options.catalog,
    }),
  });
}
