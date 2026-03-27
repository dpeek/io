import {
  normalizeSerializedQueryRequest,
  queryFilterOperatorValues,
  queryOrderDirectionValues,
  queryParameterTypeValues,
  serializedQueryVersion,
  SerializedQueryValidationError,
  validateSerializedQueryRequest,
  type NormalizedQueryRequest,
  type QueryFilter,
  type QueryFilterOperator,
  type QueryLiteral,
  type QueryOrderClause,
  type QueryOrderDirection,
  type QueryParameterDefinition,
  type QueryParameterType,
  type QueryValue,
  type ReadQuery,
  type SerializedQueryNormalizationOptions,
  type SerializedQueryRequest,
} from "@io/graph-client";

export const queryEditorFieldControlValues = [
  "enum",
  "entity-ref",
  "date",
  "boolean",
  "text",
  "number",
] as const;

export type QueryEditorFieldControl = (typeof queryEditorFieldControlValues)[number];

export type QueryEditorOption = {
  readonly label: string;
  readonly value: string;
};

export type QueryEditorFieldSpec = {
  readonly control: QueryEditorFieldControl;
  readonly description?: string;
  readonly fieldId: string;
  readonly filterOperators: readonly QueryFilterOperator[];
  readonly label: string;
  readonly options?: readonly QueryEditorOption[];
  readonly sortable?: boolean;
};

export type QueryEditorSurfaceSpec = {
  readonly defaultPageSize?: number;
  readonly description?: string;
  readonly fields: readonly QueryEditorFieldSpec[];
  readonly label: string;
  readonly queryKind: "collection" | "scope";
  readonly sourceKind: "projection" | "scope";
  readonly surfaceId: string;
};

export type QueryEditorCatalog = {
  readonly surfaces: readonly QueryEditorSurfaceSpec[];
};

export type QueryEditorValueDraft =
  | {
      readonly kind: "literal";
      readonly value: QueryEditorRawValue;
    }
  | {
      readonly kind: "param";
      readonly name: string;
    };

export type QueryEditorRawValue = QueryLiteral | undefined;

export type QueryEditorFilterDraft = {
  readonly fieldId: string;
  readonly id: string;
  readonly operator: QueryFilterOperator;
  readonly value: QueryEditorValueDraft;
};

export type QueryEditorSortDraft = {
  readonly direction: QueryOrderDirection;
  readonly fieldId: string;
  readonly id: string;
};

export type QueryEditorParameterDraft = {
  readonly defaultValue: QueryEditorRawValue;
  readonly id: string;
  readonly label: string;
  readonly name: string;
  readonly required: boolean;
  readonly type: QueryParameterType;
};

export type QueryEditorDraft = {
  readonly filters: readonly QueryEditorFilterDraft[];
  readonly pagination: {
    readonly after: string;
    readonly limit: number;
  };
  readonly parameters: readonly QueryEditorParameterDraft[];
  readonly sorts: readonly QueryEditorSortDraft[];
  readonly surfaceId: string;
};

export type QueryEditorValidationIssueCode =
  | "duplicate-parameter"
  | "invalid-limit"
  | "invalid-parameter-default"
  | "invalid-parameter-name"
  | "invalid-value"
  | "missing-field"
  | "missing-parameter"
  | "missing-surface"
  | "non-sortable-field"
  | "serialized-query-invalid"
  | "unsupported-filter-operator"
  | "unsupported-filters"
  | "unsupported-sorts";

export type QueryEditorValidationIssue = {
  readonly code: QueryEditorValidationIssueCode;
  readonly message: string;
  readonly path: string;
};

export type QueryEditorValidationResult = {
  readonly issues: readonly QueryEditorValidationIssue[];
  readonly ok: boolean;
};

export type SerializedQueryEditorDraft = {
  readonly parameterDefinitions: readonly QueryParameterDefinition[];
  readonly request: SerializedQueryRequest;
  readonly surface: QueryEditorSurfaceSpec;
};

export type NormalizedQueryEditorDraft = SerializedQueryEditorDraft & {
  readonly normalizedRequest: NormalizedQueryRequest;
};

export class QueryEditorHydrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueryEditorHydrationError";
  }
}

let nextDraftId = 1;

const defaultOperatorsByControl = Object.freeze({
  enum: ["eq", "neq", "in"] as const,
  "entity-ref": ["eq", "neq", "in"] as const,
  date: ["eq", "gt", "gte", "lt", "lte"] as const,
  boolean: ["eq", "neq", "exists"] as const,
  text: ["eq", "neq", "contains", "starts-with", "in"] as const,
  number: ["eq", "neq", "gt", "gte", "lt", "lte"] as const,
} satisfies Record<QueryEditorFieldControl, readonly QueryFilterOperator[]>);

const defaultParameterTypesByControl = Object.freeze({
  enum: "enum",
  "entity-ref": "entity-ref",
  date: "date",
  boolean: "boolean",
  text: "string",
  number: "number",
} satisfies Record<QueryEditorFieldControl, QueryParameterType>);

export function createQueryEditorCatalog(
  surfaces: readonly QueryEditorSurfaceSpec[],
): QueryEditorCatalog {
  return { surfaces };
}

export function getQueryEditorSurface(
  catalog: QueryEditorCatalog,
  surfaceId: string,
): QueryEditorSurfaceSpec | undefined {
  return catalog.surfaces.find((surface) => surface.surfaceId === surfaceId);
}

export function getQueryEditorField(
  surface: QueryEditorSurfaceSpec,
  fieldId: string,
): QueryEditorFieldSpec | undefined {
  return surface.fields.find((field) => field.fieldId === fieldId);
}

export function createQueryEditorDraft(
  catalog: QueryEditorCatalog,
  surfaceId: string = catalog.surfaces[0]?.surfaceId ?? "",
): QueryEditorDraft {
  const surface = getQueryEditorSurface(catalog, surfaceId);
  return {
    filters: [],
    pagination: {
      after: "",
      limit: surface?.defaultPageSize ?? 25,
    },
    parameters: [],
    sorts: [],
    surfaceId,
  };
}

export function hydrateQueryEditorDraft(input: {
  readonly catalog: QueryEditorCatalog;
  readonly parameterDefinitions?: readonly QueryParameterDefinition[];
  readonly request: SerializedQueryRequest;
}): QueryEditorDraft {
  const { catalog, parameterDefinitions = [], request } = input;
  const surfaceId =
    request.query.kind === "collection"
      ? request.query.indexId
      : request.query.kind === "scope"
        ? request.query.scopeId
        : undefined;

  if (!surfaceId) {
    throw new QueryEditorHydrationError(
      `Query editor only supports collection and named scope requests, received "${request.query.kind}".`,
    );
  }

  const surface = getQueryEditorSurface(catalog, surfaceId);
  if (!surface) {
    throw new QueryEditorHydrationError(`Unknown query surface "${surfaceId}".`);
  }

  if (request.query.kind === "scope") {
    return {
      filters: [],
      pagination: {
        after: request.query.window?.after ?? "",
        limit: request.query.window?.limit ?? surface.defaultPageSize ?? 25,
      },
      parameters: parameterDefinitions.map((parameter, index) =>
        hydrateParameterDraft(parameter, request.params, index),
      ),
      sorts: [],
      surfaceId,
    };
  }

  if (request.query.kind !== "collection") {
    throw new QueryEditorHydrationError(
      `Query editor only supports collection and named scope requests, received "${request.query.kind}".`,
    );
  }

  return {
    filters: flattenHydratedFilters(request.query.filter).map((filter, index) =>
      hydrateFilterDraft(filter, index),
    ),
    pagination: {
      after: request.query.window?.after ?? "",
      limit: request.query.window?.limit ?? surface.defaultPageSize ?? 25,
    },
    parameters: parameterDefinitions.map((parameter, index) =>
      hydrateParameterDraft(parameter, request.params, index),
    ),
    sorts:
      request.query.order?.map((sort, index) => ({
        direction: sort.direction,
        fieldId: sort.fieldId,
        id: `sort:${index + 1}`,
      })) ?? [],
    surfaceId,
  };
}

export function addQueryEditorFilter(
  draft: QueryEditorDraft,
  catalog: QueryEditorCatalog,
): QueryEditorDraft {
  const surface = getQueryEditorSurface(catalog, draft.surfaceId);
  const field = surface?.fields[0];
  if (!field) {
    return draft;
  }

  const operator = field.filterOperators[0] ?? defaultOperatorsByControl[field.control][0];
  const nextFilter: QueryEditorFilterDraft = {
    fieldId: field.fieldId,
    id: createDraftId("filter"),
    operator,
    value: createDefaultFilterValue(field, operator),
  };

  return {
    ...draft,
    filters: [...draft.filters, nextFilter],
  };
}

export function updateQueryEditorFilter(
  draft: QueryEditorDraft,
  filterId: string,
  update: Partial<QueryEditorFilterDraft>,
  catalog: QueryEditorCatalog,
): QueryEditorDraft {
  const surface = getQueryEditorSurface(catalog, draft.surfaceId);
  return {
    ...draft,
    filters: draft.filters.map((filter) => {
      if (filter.id !== filterId) {
        return filter;
      }

      const nextFieldId = update.fieldId ?? filter.fieldId;
      const nextField = surface ? getQueryEditorField(surface, nextFieldId) : undefined;
      const nextOperator = update.operator ?? filter.operator;
      const operatorAllowed = nextField?.filterOperators.includes(nextOperator) ?? false;
      const nextValue =
        update.value !== undefined
          ? update.value
          : nextField && (!operatorAllowed || nextFieldId !== filter.fieldId)
            ? createDefaultFilterValue(
                nextField,
                operatorAllowed
                  ? nextOperator
                  : (nextField.filterOperators[0] ??
                      defaultOperatorsByControl[nextField.control][0]),
              )
            : filter.value;

      return {
        ...filter,
        ...update,
        operator:
          nextField && !operatorAllowed
            ? (nextField.filterOperators[0] ?? defaultOperatorsByControl[nextField.control][0])
            : nextOperator,
        value: nextValue,
      };
    }),
  };
}

export function removeQueryEditorFilter(
  draft: QueryEditorDraft,
  filterId: string,
): QueryEditorDraft {
  return {
    ...draft,
    filters: draft.filters.filter((filter) => filter.id !== filterId),
  };
}

export function addQueryEditorSort(
  draft: QueryEditorDraft,
  catalog: QueryEditorCatalog,
): QueryEditorDraft {
  const surface = getQueryEditorSurface(catalog, draft.surfaceId);
  const field = surface?.fields.find((candidate) => candidate.sortable);
  if (!field) {
    return draft;
  }

  return {
    ...draft,
    sorts: [
      ...draft.sorts,
      {
        direction: "asc",
        fieldId: field.fieldId,
        id: createDraftId("sort"),
      },
    ],
  };
}

export function updateQueryEditorSort(
  draft: QueryEditorDraft,
  sortId: string,
  update: Partial<QueryEditorSortDraft>,
): QueryEditorDraft {
  return {
    ...draft,
    sorts: draft.sorts.map((sort) => (sort.id === sortId ? { ...sort, ...update } : sort)),
  };
}

export function removeQueryEditorSort(draft: QueryEditorDraft, sortId: string): QueryEditorDraft {
  return {
    ...draft,
    sorts: draft.sorts.filter((sort) => sort.id !== sortId),
  };
}

export function addQueryEditorParameter(draft: QueryEditorDraft): QueryEditorDraft {
  return {
    ...draft,
    parameters: [
      ...draft.parameters,
      {
        defaultValue: "",
        id: createDraftId("param"),
        label: "New parameter",
        name: `param-${draft.parameters.length + 1}`,
        required: false,
        type: "string",
      },
    ],
  };
}

export function updateQueryEditorParameter(
  draft: QueryEditorDraft,
  parameterId: string,
  update: Partial<QueryEditorParameterDraft>,
): QueryEditorDraft {
  return {
    ...draft,
    parameters: draft.parameters.map((parameter) =>
      parameter.id === parameterId ? { ...parameter, ...update } : parameter,
    ),
  };
}

export function removeQueryEditorParameter(
  draft: QueryEditorDraft,
  parameterId: string,
): QueryEditorDraft {
  return {
    ...draft,
    parameters: draft.parameters.filter((parameter) => parameter.id !== parameterId),
  };
}

export function validateQueryEditorDraft(
  draft: QueryEditorDraft,
  catalog: QueryEditorCatalog,
): QueryEditorValidationResult {
  const issues = collectQueryEditorIssues(draft, catalog);
  return {
    issues,
    ok: issues.length === 0,
  };
}

export function serializeQueryEditorDraft(
  draft: QueryEditorDraft,
  catalog: QueryEditorCatalog,
): SerializedQueryEditorDraft {
  const issues = collectQueryEditorIssues(draft, catalog);
  if (issues.length > 0) {
    throw new QueryEditorValidationError(issues);
  }

  const surface = getQueryEditorSurface(catalog, draft.surfaceId);
  if (!surface) {
    throw new QueryEditorValidationError([
      {
        code: "missing-surface",
        message: `Unknown query surface "${draft.surfaceId}".`,
        path: "draft.surfaceId",
      },
    ]);
  }

  const parameterDefinitions = draft.parameters.map((parameter) => ({
    defaultValue:
      parameter.defaultValue === undefined || parameter.defaultValue === ""
        ? undefined
        : coerceParameterDefault(parameter),
    label: parameter.label.trim(),
    name: parameter.name.trim(),
    required: parameter.required || undefined,
    type: parameter.type,
  }));

  const request: SerializedQueryRequest = {
    params: buildSerializedParams(draft.parameters),
    query: buildSerializedQuery(draft, surface),
    version: serializedQueryVersion,
  };

  return {
    parameterDefinitions,
    request,
    surface,
  };
}

export async function normalizeQueryEditorDraft(
  draft: QueryEditorDraft,
  catalog: QueryEditorCatalog,
  options: SerializedQueryNormalizationOptions = {},
): Promise<NormalizedQueryEditorDraft> {
  const serialized = serializeQueryEditorDraft(draft, catalog);
  const normalizedRequest = await normalizeSerializedQueryRequest(serialized.request, {
    ...options,
    parameterDefinitions: serialized.parameterDefinitions,
  });
  return {
    ...serialized,
    normalizedRequest,
  };
}

export class QueryEditorValidationError extends Error {
  readonly issues: readonly QueryEditorValidationIssue[];

  constructor(issues: readonly QueryEditorValidationIssue[]) {
    const first = issues[0];
    super(first ? `${first.path} ${first.message}` : "Query editor validation failed.");
    this.name = "QueryEditorValidationError";
    this.issues = issues;
  }
}

function collectQueryEditorIssues(
  draft: QueryEditorDraft,
  catalog: QueryEditorCatalog,
): readonly QueryEditorValidationIssue[] {
  const issues: QueryEditorValidationIssue[] = [];
  const surface = getQueryEditorSurface(catalog, draft.surfaceId);

  if (!surface) {
    issues.push({
      code: "missing-surface",
      message: `Unknown query surface "${draft.surfaceId}".`,
      path: "draft.surfaceId",
    });
    return issues;
  }

  if (!Number.isInteger(draft.pagination.limit) || draft.pagination.limit <= 0) {
    issues.push({
      code: "invalid-limit",
      message: "Page size must be a positive integer.",
      path: "draft.pagination.limit",
    });
  }

  if (draft.pagination.after !== undefined && typeof draft.pagination.after !== "string") {
    issues.push({
      code: "invalid-value",
      message: "Pagination cursor must be a string.",
      path: "draft.pagination.after",
    });
  }

  const parameterNames = new Set<string>();
  for (const [index, parameter] of draft.parameters.entries()) {
    const path = `draft.parameters[${index}]`;
    const name = parameter.name.trim();
    if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(name)) {
      issues.push({
        code: "invalid-parameter-name",
        message:
          "Parameter names must start with a letter and use only letters, numbers, or dashes.",
        path: `${path}.name`,
      });
    } else if (parameterNames.has(name)) {
      issues.push({
        code: "duplicate-parameter",
        message: `Parameter "${name}" is already defined.`,
        path: `${path}.name`,
      });
    } else {
      parameterNames.add(name);
    }

    if (parameter.defaultValue !== "" && parameter.defaultValue !== undefined) {
      try {
        coerceParameterDefault(parameter);
      } catch (error) {
        issues.push({
          code: "invalid-parameter-default",
          message: error instanceof Error ? error.message : "Parameter default is invalid.",
          path: `${path}.defaultValue`,
        });
      }
    }
  }

  if (surface.queryKind !== "collection" && draft.filters.length > 0) {
    issues.push({
      code: "unsupported-filters",
      message: `Query surface "${surface.surfaceId}" does not support filters.`,
      path: "draft.filters",
    });
  }

  if (surface.queryKind !== "collection" && draft.sorts.length > 0) {
    issues.push({
      code: "unsupported-sorts",
      message: `Query surface "${surface.surfaceId}" does not support sorting.`,
      path: "draft.sorts",
    });
  }

  for (const [index, filter] of draft.filters.entries()) {
    const path = `draft.filters[${index}]`;
    const field = getQueryEditorField(surface, filter.fieldId);
    if (!field) {
      issues.push({
        code: "missing-field",
        message: `Unknown field "${filter.fieldId}" for query surface "${surface.surfaceId}".`,
        path: `${path}.fieldId`,
      });
      continue;
    }

    if (!field.filterOperators.includes(filter.operator)) {
      issues.push({
        code: "unsupported-filter-operator",
        message: `Operator "${filter.operator}" is not supported for field "${field.fieldId}".`,
        path: `${path}.operator`,
      });
    }

    try {
      coerceFilterDraftValue(filter, field, draft.parameters, `${path}.value`);
    } catch (error) {
      issues.push({
        code: error instanceof MissingParameterError ? "missing-parameter" : "invalid-value",
        message: error instanceof Error ? error.message : "Filter value is invalid.",
        path: `${path}.value`,
      });
    }
  }

  const seenSorts = new Set<string>();
  for (const [index, sort] of draft.sorts.entries()) {
    const path = `draft.sorts[${index}]`;
    const field = getQueryEditorField(surface, sort.fieldId);
    if (!field) {
      issues.push({
        code: "missing-field",
        message: `Unknown field "${sort.fieldId}" for query surface "${surface.surfaceId}".`,
        path: `${path}.fieldId`,
      });
      continue;
    }
    if (!field.sortable) {
      issues.push({
        code: "non-sortable-field",
        message: `Field "${field.fieldId}" cannot be used for sorting.`,
        path: `${path}.fieldId`,
      });
    }
    if (seenSorts.has(sort.fieldId)) {
      issues.push({
        code: "non-sortable-field",
        message: `Field "${sort.fieldId}" can only appear once in sort clauses.`,
        path: `${path}.fieldId`,
      });
    }
    seenSorts.add(sort.fieldId);
    if (!queryOrderDirectionValues.includes(sort.direction)) {
      issues.push({
        code: "invalid-value",
        message: `Sort direction "${sort.direction}" is invalid.`,
        path: `${path}.direction`,
      });
    }
  }

  if (issues.length > 0) {
    return issues;
  }

  try {
    const serialized = serializeQueryEditorDraftUnchecked(draft, surface);
    validateSerializedQueryRequest(serialized.request, {
      parameterDefinitions: serialized.parameterDefinitions,
    });
  } catch (error) {
    if (error instanceof SerializedQueryValidationError) {
      issues.push({
        code: "serialized-query-invalid",
        message: error.message,
        path: error.path,
      });
    } else if (error instanceof Error) {
      issues.push({
        code: "serialized-query-invalid",
        message: error.message,
        path: "draft",
      });
    }
  }

  return issues;
}

function serializeQueryEditorDraftUnchecked(
  draft: QueryEditorDraft,
  surface: QueryEditorSurfaceSpec,
): SerializedQueryEditorDraft {
  return {
    parameterDefinitions: draft.parameters.map((parameter) => ({
      defaultValue:
        parameter.defaultValue === undefined || parameter.defaultValue === ""
          ? undefined
          : coerceParameterDefault(parameter),
      label: parameter.label.trim(),
      name: parameter.name.trim(),
      required: parameter.required || undefined,
      type: parameter.type,
    })),
    request: {
      params: buildSerializedParams(draft.parameters),
      query: buildSerializedQuery(draft, surface),
      version: serializedQueryVersion,
    },
    surface,
  };
}

function buildSerializedQuery(draft: QueryEditorDraft, surface: QueryEditorSurfaceSpec): ReadQuery {
  const window = {
    ...(draft.pagination.after.trim().length > 0 ? { after: draft.pagination.after.trim() } : {}),
    limit: draft.pagination.limit,
  };

  if (surface.queryKind === "scope") {
    return {
      kind: "scope",
      scopeId: surface.surfaceId,
      window,
    };
  }

  const filterClauses = draft.filters.map((filter) =>
    buildSerializedFilter(filter, requireField(surface, filter.fieldId), draft.parameters),
  );
  const filter =
    filterClauses.length === 0
      ? undefined
      : filterClauses.length === 1
        ? filterClauses[0]
        : ({ clauses: filterClauses, op: "and" } satisfies QueryFilter);

  const order =
    draft.sorts.length === 0
      ? undefined
      : draft.sorts.map(
          (sort) =>
            ({
              direction: sort.direction,
              fieldId: sort.fieldId,
            }) satisfies QueryOrderClause,
        );

  return {
    filter,
    indexId: surface.surfaceId,
    kind: "collection",
    order,
    window,
  };
}

function buildSerializedFilter(
  filter: QueryEditorFilterDraft,
  field: QueryEditorFieldSpec,
  parameters: readonly QueryEditorParameterDraft[],
): QueryFilter {
  if (filter.operator === "exists") {
    const existsValue = coerceExistsValue(filter.value, `${field.fieldId}.exists`);
    return {
      fieldId: filter.fieldId,
      op: "exists",
      value: existsValue,
    };
  }

  if (filter.operator === "in") {
    const value = coerceFilterDraftValue(filter, field, parameters, field.fieldId);
    return {
      fieldId: filter.fieldId,
      op: "in",
      values: Array.isArray(value) ? value : [value],
    };
  }

  const operator = filter.operator as Extract<
    QueryFilter,
    { readonly fieldId: string; readonly value: QueryValue }
  >["op"];
  return {
    fieldId: filter.fieldId,
    op: operator,
    value: coerceSingleQueryValue(filter.value, field, parameters, field.fieldId),
  };
}

function buildSerializedParams(
  parameters: readonly QueryEditorParameterDraft[],
): Record<string, QueryLiteral> | undefined {
  const entries = parameters.flatMap((parameter) => {
    if (parameter.defaultValue === undefined || parameter.defaultValue === "") {
      return [];
    }

    return [[parameter.name.trim(), coerceParameterDefault(parameter)] as const];
  });

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function coerceFilterDraftValue(
  filter: QueryEditorFilterDraft,
  field: QueryEditorFieldSpec,
  parameters: readonly QueryEditorParameterDraft[],
  path: string,
): QueryValue | readonly QueryValue[] {
  if (filter.operator === "in") {
    if (filter.value.kind === "param") {
      const parameter = requireParameter(parameters, filter.value.name, path);
      const listType = listParameterTypeForField(field.control);
      if (parameter.type !== listType) {
        throw new Error(
          `Parameter "${parameter.name}" must use type "${listType}" for "${field.fieldId}" in-filters.`,
        );
      }
      return [{ kind: "param", name: parameter.name.trim() }];
    }

    const listValue = coerceLiteralValue(field, filter.value.value, true) as readonly string[];
    return listValue.map((entry) => ({ kind: "literal", value: entry }) as const);
  }

  return coerceSingleQueryValue(filter.value, field, parameters, path);
}

function coerceSingleQueryValue(
  value: QueryEditorValueDraft,
  field: QueryEditorFieldSpec,
  parameters: readonly QueryEditorParameterDraft[],
  path: string,
): QueryValue {
  if (value.kind === "param") {
    const parameter = requireParameter(parameters, value.name, path);
    const expectedType = defaultParameterTypesByControl[field.control];
    if (parameter.type !== expectedType) {
      throw new Error(
        `Parameter "${parameter.name}" must use type "${expectedType}" for field "${field.fieldId}".`,
      );
    }
    return {
      kind: "param",
      name: parameter.name.trim(),
    };
  }

  return {
    kind: "literal",
    value: coerceLiteralValue(field, value.value, false),
  };
}

function coerceExistsValue(value: QueryEditorValueDraft, path: string): boolean {
  if (value.kind !== "literal" || typeof value.value !== "boolean") {
    throw new Error(`"${path}" must be a boolean literal.`);
  }
  return value.value;
}

function coerceLiteralValue(
  field: QueryEditorFieldSpec,
  rawValue: QueryEditorRawValue,
  isList: boolean,
): QueryLiteral {
  switch (field.control) {
    case "enum":
    case "entity-ref":
    case "text":
    case "date":
      if (isList) {
        if (!Array.isArray(rawValue) || rawValue.some((entry) => typeof entry !== "string")) {
          throw new Error(`"${field.fieldId}" expects a list of string values.`);
        }
        if (rawValue.length === 0) {
          throw new Error(`"${field.fieldId}" requires at least one value.`);
        }
        return rawValue;
      }
      if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
        throw new Error(`"${field.fieldId}" requires a non-empty string value.`);
      }
      return rawValue.trim();
    case "boolean":
      if (typeof rawValue !== "boolean") {
        throw new Error(`"${field.fieldId}" requires a boolean value.`);
      }
      return rawValue;
    case "number": {
      if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
        return rawValue;
      }
      if (typeof rawValue === "string" && rawValue.trim().length > 0) {
        const parsed = Number(rawValue);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
      throw new Error(`"${field.fieldId}" requires a numeric value.`);
    }
  }
}

function coerceParameterDefault(parameter: QueryEditorParameterDraft): QueryLiteral {
  const rawValue = parameter.defaultValue;
  switch (parameter.type) {
    case "string":
    case "date":
    case "enum":
    case "entity-ref":
      if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
        throw new Error(`Parameter "${parameter.name}" requires a non-empty string default.`);
      }
      return rawValue.trim();
    case "number": {
      if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
        return rawValue;
      }
      if (typeof rawValue === "string" && rawValue.trim().length > 0) {
        const parsed = Number(rawValue);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
      throw new Error(`Parameter "${parameter.name}" requires a numeric default.`);
    }
    case "boolean":
      if (typeof rawValue !== "boolean") {
        throw new Error(`Parameter "${parameter.name}" requires a boolean default.`);
      }
      return rawValue;
    case "string-list":
    case "entity-ref-list":
      if (!Array.isArray(rawValue) || rawValue.some((entry) => typeof entry !== "string")) {
        throw new Error(`Parameter "${parameter.name}" requires a string-list default.`);
      }
      if (rawValue.length === 0) {
        throw new Error(`Parameter "${parameter.name}" requires at least one default value.`);
      }
      return rawValue;
  }
}

function requireField(surface: QueryEditorSurfaceSpec, fieldId: string): QueryEditorFieldSpec {
  const field = getQueryEditorField(surface, fieldId);
  if (!field) {
    throw new Error(`Unknown field "${fieldId}" for query surface "${surface.surfaceId}".`);
  }
  return field;
}

function requireParameter(
  parameters: readonly QueryEditorParameterDraft[],
  name: string,
  path: string,
): QueryEditorParameterDraft {
  const parameter = parameters.find((candidate) => candidate.name.trim() === name.trim());
  if (!parameter) {
    throw new MissingParameterError(`Parameter "${name}" is not defined.`, path);
  }
  return parameter;
}

function listParameterTypeForField(control: QueryEditorFieldControl): QueryParameterType {
  switch (control) {
    case "entity-ref":
      return "entity-ref-list";
    case "enum":
    case "text":
    case "date":
      return "string-list";
    case "boolean":
    case "number":
      throw new Error(`"${control}" fields do not support list parameters.`);
  }
}

function createDefaultFilterValue(
  field: QueryEditorFieldSpec,
  operator: QueryFilterOperator,
): QueryEditorValueDraft {
  if (operator === "exists") {
    return { kind: "literal", value: true };
  }

  if (operator === "in") {
    return {
      kind: "literal",
      value:
        field.options && field.options[0]
          ? [field.options[0].value]
          : field.control === "entity-ref"
            ? ["entity:1"]
            : [field.control === "number" ? "1" : "value"],
    };
  }

  switch (field.control) {
    case "enum":
      return { kind: "literal", value: field.options?.[0]?.value ?? "draft" };
    case "entity-ref":
      return { kind: "literal", value: field.options?.[0]?.value ?? "entity:1" };
    case "date":
      return { kind: "literal", value: "2026-03-26" };
    case "boolean":
      return { kind: "literal", value: true };
    case "text":
      return { kind: "literal", value: "value" };
    case "number":
      return { kind: "literal", value: 1 };
  }
}

function hydrateParameterDraft(
  parameter: QueryParameterDefinition,
  params: Readonly<Record<string, QueryLiteral>> | undefined,
  index: number,
): QueryEditorParameterDraft {
  return {
    defaultValue: params?.[parameter.name] ?? parameter.defaultValue ?? "",
    id: `param:${parameter.name || index + 1}`,
    label: parameter.label,
    name: parameter.name,
    required: parameter.required ?? false,
    type: parameter.type,
  };
}

function flattenHydratedFilters(filter: QueryFilter | undefined): readonly QueryFilter[] {
  if (!filter) {
    return [];
  }
  if (filter.op === "and") {
    return filter.clauses.flatMap((clause) => flattenHydratedFilters(clause));
  }
  if (filter.op === "or" || filter.op === "not") {
    throw new QueryEditorHydrationError(
      `Query editor cannot hydrate "${filter.op}" filters back into the current form draft.`,
    );
  }
  return [filter];
}

function hydrateFilterDraft(filter: QueryFilter, index: number): QueryEditorFilterDraft {
  if (filter.op === "exists") {
    return {
      fieldId: filter.fieldId,
      id: `filter:${index + 1}`,
      operator: filter.op,
      value: {
        kind: "literal",
        value: filter.value,
      },
    };
  }
  if (filter.op === "in") {
    const firstValue = filter.values[0];
    return {
      fieldId: filter.fieldId,
      id: `filter:${index + 1}`,
      operator: filter.op,
      value:
        firstValue?.kind === "param"
          ? { kind: "param", name: firstValue.name }
          : {
              kind: "literal",
              value: filter.values
                .map((value) => {
                  if (value.kind !== "literal") {
                    throw new QueryEditorHydrationError(
                      `Query editor cannot hydrate mixed literal and param values for "${filter.fieldId}".`,
                    );
                  }
                  if (typeof value.value !== "string") {
                    throw new QueryEditorHydrationError(
                      `Query editor only supports string list filters for "${filter.fieldId}".`,
                    );
                  }
                  return value.value;
                })
                .filter((value) => value.length > 0),
            },
    };
  }
  const comparisonFilter = filter as Extract<
    QueryFilter,
    {
      readonly fieldId: string;
      readonly op: "eq" | "neq" | "contains" | "starts-with" | "gt" | "gte" | "lt" | "lte";
      readonly value: QueryValue;
    }
  >;
  return {
    fieldId: comparisonFilter.fieldId,
    id: `filter:${index + 1}`,
    operator: comparisonFilter.op,
    value:
      comparisonFilter.value.kind === "param"
        ? { kind: "param", name: comparisonFilter.value.name }
        : {
            kind: "literal",
            value: comparisonFilter.value.value,
          },
  };
}

function createDraftId(prefix: string): string {
  const id = nextDraftId;
  nextDraftId += 1;
  return `${prefix}:${id}`;
}

class MissingParameterError extends Error {
  readonly path: string;

  constructor(message: string, path: string) {
    super(message);
    this.name = "MissingParameterError";
    this.path = path;
  }
}

export const queryEditorDefaults = Object.freeze({
  fieldControls: queryEditorFieldControlValues,
  filterOperators: queryFilterOperatorValues,
  parameterTypes: queryParameterTypeValues,
});
