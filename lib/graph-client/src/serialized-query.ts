export const serializedQueryVersion = 1 as const;

export const queryParameterTypeValues = [
  "string",
  "number",
  "boolean",
  "date",
  "enum",
  "entity-ref",
  "url",
  "email",
  "color",
  "percent",
  "duration",
  "money",
  "quantity",
  "range",
  "rate",
  "string-list",
  "number-list",
  "boolean-list",
  "date-list",
  "enum-list",
  "entity-ref-list",
  "url-list",
  "email-list",
  "color-list",
  "percent-list",
  "duration-list",
  "money-list",
  "quantity-list",
  "range-list",
  "rate-list",
] as const;

export type QueryParameterType = (typeof queryParameterTypeValues)[number];

export type QueryLiteral =
  | string
  | number
  | boolean
  | null
  | readonly string[]
  | readonly number[]
  | readonly boolean[];

export type QueryValue =
  | {
      readonly kind: "literal";
      readonly value: QueryLiteral;
    }
  | {
      readonly kind: "param";
      readonly name: string;
    };

export type QueryParameterDefinition = {
  readonly defaultValue?: QueryLiteral;
  readonly label: string;
  readonly name: string;
  readonly required?: boolean;
  readonly type: QueryParameterType;
};

export const queryFilterOperatorValues = [
  "and",
  "or",
  "not",
  "eq",
  "neq",
  "in",
  "exists",
  "contains",
  "starts-with",
  "gt",
  "gte",
  "lt",
  "lte",
] as const;

export type QueryFilterOperator = (typeof queryFilterOperatorValues)[number];

export type QueryFilter =
  | {
      readonly op: "and" | "or";
      readonly clauses: readonly QueryFilter[];
    }
  | {
      readonly op: "not";
      readonly clause: QueryFilter;
    }
  | {
      readonly op: "in";
      readonly fieldId: string;
      readonly values: readonly QueryValue[];
    }
  | {
      readonly op: "exists";
      readonly fieldId: string;
      readonly value: boolean;
    }
  | {
      readonly op: "eq" | "neq" | "contains" | "starts-with" | "gt" | "gte" | "lt" | "lte";
      readonly fieldId: string;
      readonly value: QueryValue;
    };

export const queryOrderDirectionValues = ["asc", "desc"] as const;

export type QueryOrderDirection = (typeof queryOrderDirectionValues)[number];

export type QueryOrderClause = {
  readonly direction: QueryOrderDirection;
  readonly fieldId: string;
};

export type QueryWindow = {
  readonly after?: string;
  readonly limit: number;
};

export const serializedScopeKindValues = [
  "graph",
  "module",
  "entity-neighborhood",
  "collection",
  "work-queue",
  "context-bundle",
  "share-projection",
] as const;

export type SerializedScopeKind = (typeof serializedScopeKindValues)[number];

export type SerializedScopeDefinition = {
  readonly kind: SerializedScopeKind;
  readonly moduleIds?: readonly string[];
  readonly projectionId?: string;
  readonly roots?: readonly string[];
  readonly scopeId?: string;
};

export type EntityReadQuery = {
  readonly entityId: string;
  readonly kind: "entity";
};

export type NeighborhoodReadQuery = {
  readonly depth?: number;
  readonly kind: "neighborhood";
  readonly predicateIds?: readonly string[];
  readonly rootId: string;
};

export type CollectionReadQuery = {
  readonly filter?: QueryFilter;
  readonly indexId: string;
  readonly kind: "collection";
  readonly order?: readonly QueryOrderClause[];
  readonly window?: QueryWindow;
};

export type ScopeReadQuery = {
  readonly definition?: SerializedScopeDefinition;
  readonly kind: "scope";
  readonly scopeId?: string;
  readonly window?: QueryWindow;
};

export type ReadQuery =
  | EntityReadQuery
  | NeighborhoodReadQuery
  | CollectionReadQuery
  | ScopeReadQuery;

export type SerializedQueryRequest = {
  readonly params?: Readonly<Record<string, QueryLiteral>>;
  readonly query: ReadQuery;
  readonly version: typeof serializedQueryVersion;
};

export type QueryResultItem = {
  readonly entityId?: string;
  readonly key: string;
  readonly payload: Readonly<Record<string, unknown>>;
};

export type QueryResultPage = {
  readonly freshness: {
    readonly completeness: "complete" | "incomplete";
    readonly freshness: "current" | "stale";
    readonly projectedAt?: string;
    readonly projectionCursor?: string;
    readonly scopeCursor?: string;
  };
  readonly items: readonly QueryResultItem[];
  readonly kind: ReadQuery["kind"];
  readonly nextCursor?: string;
};

export type SerializedQuerySuccessResponse = {
  readonly ok: true;
  readonly result: QueryResultPage;
};

export type SerializedQueryErrorResponse = {
  readonly code?: string;
  readonly error: string;
  readonly ok: false;
};

export type SerializedQueryResponse = SerializedQuerySuccessResponse | SerializedQueryErrorResponse;

export class SerializedQueryValidationError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path} ${message}`);
    this.name = "SerializedQueryValidationError";
    this.path = path;
  }
}

export type SerializedQueryValidationOptions = {
  readonly parameterDefinitions?: readonly QueryParameterDefinition[];
};

export type QueryIdentityExecutionContext = {
  readonly policyFilterVersion?: string;
  readonly principalId?: string;
  readonly projectionCursor?: string;
  readonly projectionDefinitionHash?: string;
  readonly scopeDefinitionHash?: string;
};

export type SerializedQueryNormalizationOptions = SerializedQueryValidationOptions & {
  readonly executionContext?: QueryIdentityExecutionContext;
};

export type NormalizedQueryFilter =
  | {
      readonly clauses: readonly NormalizedQueryFilter[];
      readonly op: "and" | "or";
    }
  | {
      readonly clause: NormalizedQueryFilter;
      readonly op: "not";
    }
  | {
      readonly fieldId: string;
      readonly op: "in";
      readonly values: readonly QueryLiteral[];
    }
  | {
      readonly fieldId: string;
      readonly op: "exists";
      readonly value: boolean;
    }
  | {
      readonly fieldId: string;
      readonly op: "eq" | "neq" | "contains" | "starts-with" | "gt" | "gte" | "lt" | "lte";
      readonly value: QueryLiteral;
    };

export type NormalizedEntityReadQuery = EntityReadQuery;

export type NormalizedNeighborhoodReadQuery = {
  readonly depth?: number;
  readonly kind: "neighborhood";
  readonly predicateIds?: readonly string[];
  readonly rootId: string;
};

export type NormalizedCollectionReadQuery = {
  readonly filter?: NormalizedQueryFilter;
  readonly indexId: string;
  readonly kind: "collection";
  readonly order?: readonly QueryOrderClause[];
  readonly window?: {
    readonly limit: number;
  };
};

export type NormalizedScopeDefinition = {
  readonly kind: SerializedScopeKind;
  readonly moduleIds?: readonly string[];
  readonly projectionId?: string;
  readonly roots?: readonly string[];
  readonly scopeId?: string;
};

export type NormalizedScopeReadQuery = {
  readonly definition?: NormalizedScopeDefinition;
  readonly kind: "scope";
  readonly scopeId?: string;
  readonly window?: {
    readonly limit: number;
  };
};

export type NormalizedReadQuery =
  | NormalizedEntityReadQuery
  | NormalizedNeighborhoodReadQuery
  | NormalizedCollectionReadQuery
  | NormalizedScopeReadQuery;

export type NormalizedQueryParameterBinding = {
  readonly name: string;
  readonly type: QueryParameterType;
  readonly value: QueryLiteral;
};

export type NormalizedQueryMetadata = {
  readonly executionContextHash: string;
  readonly executionContextJson: string;
  readonly identityHash: string;
  readonly pageCursor?: string;
  readonly parameterHash: string;
  readonly parameterJson: string;
  readonly queryHash: string;
  readonly queryJson: string;
  readonly requestHash: string;
  readonly requestJson: string;
};

export type NormalizedQueryRequest = {
  readonly metadata: NormalizedQueryMetadata;
  readonly params: readonly NormalizedQueryParameterBinding[];
  readonly query: NormalizedReadQuery;
  readonly version: typeof serializedQueryVersion;
};

const queryValueKindValues = ["literal", "param"] as const;
const readQueryKindValues = ["entity", "neighborhood", "collection", "scope"] as const;
const responseFreshnessValues = ["current", "stale"] as const;
const responseCompletenessValues = ["complete", "incomplete"] as const;
const queryParameterNamePattern = /^[a-z][a-z0-9-]*$/;
const stringQueryParameterTypes = [
  "string",
  "date",
  "enum",
  "entity-ref",
  "url",
  "email",
  "color",
  "duration",
  "money",
  "quantity",
  "range",
  "rate",
] as const satisfies readonly QueryParameterType[];
const numberQueryParameterTypes = [
  "number",
  "percent",
] as const satisfies readonly QueryParameterType[];
const booleanQueryParameterTypes = ["boolean"] as const satisfies readonly QueryParameterType[];
const stringListQueryParameterTypes = [
  "string-list",
  "date-list",
  "enum-list",
  "entity-ref-list",
  "url-list",
  "email-list",
  "color-list",
  "duration-list",
  "money-list",
  "quantity-list",
  "range-list",
  "rate-list",
] as const satisfies readonly QueryParameterType[];
const numberListQueryParameterTypes = [
  "number-list",
  "percent-list",
] as const satisfies readonly QueryParameterType[];
const booleanListQueryParameterTypes = [
  "boolean-list",
] as const satisfies readonly QueryParameterType[];

function createValidationError(path: string, message: string): SerializedQueryValidationError {
  return new SerializedQueryValidationError(path, message);
}

function freezeArray<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...values]);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireObjectRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isObjectRecord(value)) {
    throw createValidationError(path, "must be a JSON object.");
  }

  return value;
}

function requireNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw createValidationError(path, "must be a non-empty string.");
  }

  return value;
}

function readOptionalNonEmptyString(value: unknown, path: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requireNonEmptyString(value, path);
}

function requireInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw createValidationError(path, "must be an integer.");
  }

  return value;
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw createValidationError(path, "must be a boolean.");
  }

  return value;
}

function requireStringArray(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) {
    throw createValidationError(path, "must be an array of strings.");
  }

  return value.map((entry, index) => requireNonEmptyString(entry, `${path}[${index}]`));
}

function readOptionalExecutionContextString(value: unknown, path: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requireNonEmptyString(value, path);
}

function requireQueryLiteral(value: unknown, path: string): QueryLiteral {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw createValidationError(path, "must be a finite number.");
    }
    return value;
  }

  if (!Array.isArray(value)) {
    throw createValidationError(
      path,
      "must be null, a scalar JSON value, or a homogeneous scalar array.",
    );
  }

  if (value.length === 0) {
    return [];
  }

  const [first] = value;
  if (typeof first === "string") {
    return value.map((entry, index) => requireNonEmptyString(entry, `${path}[${index}]`));
  }
  if (typeof first === "number") {
    return value.map((entry, index) => {
      if (typeof entry !== "number" || !Number.isFinite(entry)) {
        throw createValidationError(`${path}[${index}]`, "must be a finite number.");
      }
      return entry;
    });
  }
  if (typeof first === "boolean") {
    return value.map((entry, index) => requireBoolean(entry, `${path}[${index}]`));
  }

  throw createValidationError(path, "must contain only strings, numbers, or booleans.");
}

function isQueryLiteralCompatible(type: QueryParameterType, value: QueryLiteral): boolean {
  if ((stringQueryParameterTypes as readonly QueryParameterType[]).includes(type)) {
    return typeof value === "string";
  }

  if ((numberQueryParameterTypes as readonly QueryParameterType[]).includes(type)) {
    return typeof value === "number";
  }

  if ((booleanQueryParameterTypes as readonly QueryParameterType[]).includes(type)) {
    return typeof value === "boolean";
  }

  if ((stringListQueryParameterTypes as readonly QueryParameterType[]).includes(type)) {
    return Array.isArray(value) && value.every((entry) => typeof entry === "string");
  }

  if ((numberListQueryParameterTypes as readonly QueryParameterType[]).includes(type)) {
    return Array.isArray(value) && value.every((entry) => typeof entry === "number");
  }

  if ((booleanListQueryParameterTypes as readonly QueryParameterType[]).includes(type)) {
    return Array.isArray(value) && value.every((entry) => typeof entry === "boolean");
  }

  return false;
}

function canonicalizeQueryLiteral(value: QueryLiteral): QueryLiteral {
  if (!Array.isArray(value)) {
    return value;
  }

  return freezeArray(value);
}

function compareCanonicalValues(left: unknown, right: unknown): number {
  const leftJson = canonicalStringify(left);
  const rightJson = canonicalStringify(right);
  if (leftJson < rightJson) return -1;
  if (leftJson > rightJson) return 1;
  return 0;
}

function uniqueSortedStrings(values: readonly string[] | undefined): readonly string[] | undefined {
  if (values === undefined) {
    return undefined;
  }

  return freezeArray([...new Set(values)].sort((left, right) => left.localeCompare(right)));
}

function canonicalStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry));
  }

  if (isObjectRecord(value)) {
    const sortedEntries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJsonValue(entry)] as const);
    return Object.fromEntries(sortedEntries);
  }

  return value;
}

async function hashCanonicalValue(value: unknown): Promise<string> {
  const encoded = new TextEncoder().encode(canonicalStringify(value));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function parseQueryValue(
  value: unknown,
  path: string,
  parameterDefinitions: ReadonlyMap<string, QueryParameterDefinition>,
): QueryValue {
  const record = requireObjectRecord(value, path);
  const kind = requireNonEmptyString(record.kind, `${path}.kind`);
  if (!queryValueKindValues.includes(kind as (typeof queryValueKindValues)[number])) {
    throw createValidationError(
      `${path}.kind`,
      `must be one of: ${queryValueKindValues.join(", ")}.`,
    );
  }

  if (kind === "literal") {
    return {
      kind: "literal",
      value: requireQueryLiteral(record.value, `${path}.value`),
    };
  }

  const name = requireNonEmptyString(record.name, `${path}.name`);
  if (!queryParameterNamePattern.test(name)) {
    throw createValidationError(
      `${path}.name`,
      "must start with a letter and contain only lowercase letters, digits, or hyphens.",
    );
  }
  if (parameterDefinitions.size > 0 && !parameterDefinitions.has(name)) {
    throw createValidationError(`${path}.name`, `references unknown parameter "${name}".`);
  }

  return { kind: "param", name };
}

function parseQueryFilter(
  value: unknown,
  path: string,
  parameterDefinitions: ReadonlyMap<string, QueryParameterDefinition>,
): QueryFilter {
  const record = requireObjectRecord(value, path);
  const op = requireNonEmptyString(record.op, `${path}.op`);
  if (!queryFilterOperatorValues.includes(op as QueryFilterOperator)) {
    throw createValidationError(
      `${path}.op`,
      `must be one of: ${queryFilterOperatorValues.join(", ")}.`,
    );
  }

  if (op === "and" || op === "or") {
    if (!Array.isArray(record.clauses) || record.clauses.length === 0) {
      throw createValidationError(`${path}.clauses`, "must be a non-empty array.");
    }
    return {
      op,
      clauses: record.clauses.map((entry, index) =>
        parseQueryFilter(entry, `${path}.clauses[${index}]`, parameterDefinitions),
      ),
    };
  }

  if (op === "not") {
    return {
      op: "not",
      clause: parseQueryFilter(record.clause, `${path}.clause`, parameterDefinitions),
    };
  }

  const fieldId = requireNonEmptyString(record.fieldId, `${path}.fieldId`);

  if (op === "exists") {
    return {
      op: "exists",
      fieldId,
      value: requireBoolean(record.value, `${path}.value`),
    };
  }

  if (op === "in") {
    if (!Array.isArray(record.values) || record.values.length === 0) {
      throw createValidationError(`${path}.values`, "must be a non-empty array.");
    }

    return {
      op: "in",
      fieldId,
      values: record.values.map((entry, index) =>
        parseQueryValue(entry, `${path}.values[${index}]`, parameterDefinitions),
      ),
    };
  }

  return {
    op: op as Extract<
      QueryFilterOperator,
      "eq" | "neq" | "contains" | "starts-with" | "gt" | "gte" | "lt" | "lte"
    >,
    fieldId,
    value: parseQueryValue(record.value, `${path}.value`, parameterDefinitions),
  };
}

function parseQueryOrder(value: unknown, path: string): readonly QueryOrderClause[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || value.length === 0) {
    throw createValidationError(path, "must be a non-empty array when provided.");
  }

  const seenFieldIds = new Set<string>();
  return value.map((entry, index) => {
    const record = requireObjectRecord(entry, `${path}[${index}]`);
    const fieldId = requireNonEmptyString(record.fieldId, `${path}[${index}].fieldId`);
    if (seenFieldIds.has(fieldId)) {
      throw createValidationError(`${path}[${index}].fieldId`, "must not repeat within one query.");
    }
    seenFieldIds.add(fieldId);

    const direction = requireNonEmptyString(record.direction, `${path}[${index}].direction`);
    if (!queryOrderDirectionValues.includes(direction as QueryOrderDirection)) {
      throw createValidationError(
        `${path}[${index}].direction`,
        `must be one of: ${queryOrderDirectionValues.join(", ")}.`,
      );
    }

    return {
      fieldId,
      direction: direction as QueryOrderDirection,
    };
  });
}

function parseQueryWindow(value: unknown, path: string): QueryWindow | undefined {
  if (value === undefined) {
    return undefined;
  }

  const record = requireObjectRecord(value, path);
  const limit = requireInteger(record.limit, `${path}.limit`);
  if (limit <= 0) {
    throw createValidationError(`${path}.limit`, "must be greater than 0.");
  }

  const after = readOptionalNonEmptyString(record.after, `${path}.after`);
  return after === undefined ? { limit } : { after, limit };
}

function parseSerializedScopeDefinition(value: unknown, path: string): SerializedScopeDefinition {
  const record = requireObjectRecord(value, path);
  const kind = requireNonEmptyString(record.kind, `${path}.kind`);
  if (!serializedScopeKindValues.includes(kind as SerializedScopeKind)) {
    throw createValidationError(
      `${path}.kind`,
      `must be one of: ${serializedScopeKindValues.join(", ")}.`,
    );
  }

  const scopeId = readOptionalNonEmptyString(record.scopeId, `${path}.scopeId`);
  const projectionId = readOptionalNonEmptyString(record.projectionId, `${path}.projectionId`);
  const roots =
    record.roots === undefined ? undefined : requireStringArray(record.roots, `${path}.roots`);
  const moduleIds =
    record.moduleIds === undefined
      ? undefined
      : requireStringArray(record.moduleIds, `${path}.moduleIds`);

  if (
    scopeId === undefined &&
    projectionId === undefined &&
    roots === undefined &&
    moduleIds === undefined
  ) {
    throw createValidationError(
      path,
      "must include at least one of scopeId, projectionId, roots, or moduleIds.",
    );
  }

  return {
    kind: kind as SerializedScopeKind,
    ...(scopeId !== undefined ? { scopeId } : {}),
    ...(projectionId !== undefined ? { projectionId } : {}),
    ...(roots !== undefined ? { roots } : {}),
    ...(moduleIds !== undefined ? { moduleIds } : {}),
  };
}

function parseReadQuery(
  value: unknown,
  path: string,
  parameterDefinitions: ReadonlyMap<string, QueryParameterDefinition>,
): ReadQuery {
  const record = requireObjectRecord(value, path);
  const kind = requireNonEmptyString(record.kind, `${path}.kind`);
  if (!readQueryKindValues.includes(kind as (typeof readQueryKindValues)[number])) {
    throw createValidationError(
      `${path}.kind`,
      `must be one of: ${readQueryKindValues.join(", ")}.`,
    );
  }

  if (kind === "entity") {
    return {
      kind,
      entityId: requireNonEmptyString(record.entityId, `${path}.entityId`),
    };
  }

  if (kind === "neighborhood") {
    const depth =
      record.depth === undefined ? undefined : requireInteger(record.depth, `${path}.depth`);
    if (depth !== undefined && depth <= 0) {
      throw createValidationError(`${path}.depth`, "must be greater than 0 when provided.");
    }

    return {
      kind,
      rootId: requireNonEmptyString(record.rootId, `${path}.rootId`),
      ...(record.predicateIds === undefined
        ? {}
        : { predicateIds: requireStringArray(record.predicateIds, `${path}.predicateIds`) }),
      ...(depth !== undefined ? { depth } : {}),
    };
  }

  if (kind === "collection") {
    return {
      kind,
      indexId: requireNonEmptyString(record.indexId, `${path}.indexId`),
      ...(record.filter === undefined
        ? {}
        : { filter: parseQueryFilter(record.filter, `${path}.filter`, parameterDefinitions) }),
      ...(record.order === undefined
        ? {}
        : { order: parseQueryOrder(record.order, `${path}.order`) }),
      ...(record.window === undefined
        ? {}
        : { window: parseQueryWindow(record.window, `${path}.window`) }),
    };
  }

  const scopeId = readOptionalNonEmptyString(record.scopeId, `${path}.scopeId`);
  const definition =
    record.definition === undefined
      ? undefined
      : parseSerializedScopeDefinition(record.definition, `${path}.definition`);
  const window = parseQueryWindow(record.window, `${path}.window`);

  if (scopeId === undefined && definition === undefined) {
    throw createValidationError(path, 'must include "scopeId" or "definition".');
  }

  return {
    kind: "scope",
    ...(scopeId !== undefined ? { scopeId } : {}),
    ...(definition !== undefined ? { definition } : {}),
    ...(window !== undefined ? { window } : {}),
  };
}

function parseParameterDefinitions(
  definitions: readonly QueryParameterDefinition[] | undefined,
): ReadonlyMap<string, QueryParameterDefinition> {
  if (!definitions || definitions.length === 0) {
    return new Map();
  }

  const entries = new Map<string, QueryParameterDefinition>();
  for (const [index, definition] of definitions.entries()) {
    const path = `parameterDefinitions[${index}]`;
    const name = requireNonEmptyString(definition.name, `${path}.name`);
    if (!queryParameterNamePattern.test(name)) {
      throw createValidationError(
        `${path}.name`,
        "must start with a letter and contain only lowercase letters, digits, or hyphens.",
      );
    }
    if (entries.has(name)) {
      throw createValidationError(`${path}.name`, `duplicates parameter "${name}".`);
    }

    requireNonEmptyString(definition.label, `${path}.label`);

    if (!queryParameterTypeValues.includes(definition.type)) {
      throw createValidationError(
        `${path}.type`,
        `must be one of: ${queryParameterTypeValues.join(", ")}.`,
      );
    }

    if (
      definition.defaultValue !== undefined &&
      !isQueryLiteralCompatible(definition.type, definition.defaultValue)
    ) {
      throw createValidationError(
        `${path}.defaultValue`,
        `must match parameter type "${definition.type}".`,
      );
    }

    entries.set(name, definition);
  }

  return entries;
}

function parseQueryParams(
  value: unknown,
  path: string,
  parameterDefinitions: ReadonlyMap<string, QueryParameterDefinition>,
): Readonly<Record<string, QueryLiteral>> | undefined {
  if (value === undefined) {
    return undefined;
  }

  const record = requireObjectRecord(value, path);
  const params: Record<string, QueryLiteral> = {};

  for (const [name, paramValue] of Object.entries(record)) {
    if (!queryParameterNamePattern.test(name)) {
      throw createValidationError(
        `${path}.${name}`,
        "must use names that start with a letter and contain only lowercase letters, digits, or hyphens.",
      );
    }

    const definition = parameterDefinitions.get(name);
    if (parameterDefinitions.size > 0 && !definition) {
      throw createValidationError(`${path}.${name}`, "is not declared for this query.");
    }

    const literal = requireQueryLiteral(paramValue, `${path}.${name}`);
    if (definition && !isQueryLiteralCompatible(definition.type, literal)) {
      throw createValidationError(
        `${path}.${name}`,
        `must match parameter type "${definition.type}".`,
      );
    }
    params[name] = literal;
  }

  for (const [name, definition] of parameterDefinitions.entries()) {
    const resolvedValue = params[name] ?? definition.defaultValue;
    if (definition.required && resolvedValue === undefined) {
      throw createValidationError(`${path}.${name}`, "is required but was not provided.");
    }
  }

  return Object.keys(params).length > 0 ? params : {};
}

export function validateSerializedQueryRequest(
  value: unknown,
  options: SerializedQueryValidationOptions = {},
): SerializedQueryRequest {
  const parameterDefinitions = parseParameterDefinitions(options.parameterDefinitions);
  const record = requireObjectRecord(value, "Serialized query request");
  const version = requireInteger(record.version, "Serialized query request.version");
  if (version !== serializedQueryVersion) {
    throw createValidationError(
      "Serialized query request.version",
      `must be ${serializedQueryVersion}.`,
    );
  }

  const query = parseReadQuery(
    record.query,
    "Serialized query request.query",
    parameterDefinitions,
  );
  const params = parseQueryParams(
    record.params,
    "Serialized query request.params",
    parameterDefinitions,
  );

  return params === undefined
    ? { version: serializedQueryVersion, query }
    : { version: serializedQueryVersion, query, params };
}

function collectReferencedParameterNamesFromFilter(
  filter: QueryFilter | undefined,
  names: Set<string>,
): void {
  if (!filter) {
    return;
  }

  if (filter.op === "and" || filter.op === "or") {
    for (const clause of filter.clauses) {
      collectReferencedParameterNamesFromFilter(clause, names);
    }
    return;
  }

  if (filter.op === "not") {
    collectReferencedParameterNamesFromFilter(filter.clause, names);
    return;
  }

  if (filter.op === "in") {
    for (const value of filter.values) {
      if (value.kind === "param") {
        names.add(value.name);
      }
    }
    return;
  }

  if (
    (filter.op === "eq" ||
      filter.op === "neq" ||
      filter.op === "contains" ||
      filter.op === "starts-with" ||
      filter.op === "gt" ||
      filter.op === "gte" ||
      filter.op === "lt" ||
      filter.op === "lte") &&
    filter.value.kind === "param"
  ) {
    names.add(filter.value.name);
  }
}

function collectReferencedParameterNames(query: ReadQuery): readonly string[] {
  const names = new Set<string>();
  if (query.kind === "collection") {
    collectReferencedParameterNamesFromFilter(query.filter, names);
  }

  return freezeArray([...names].sort((left, right) => left.localeCompare(right)));
}

function resolveQueryParameterBindings(
  query: ReadQuery,
  params: Readonly<Record<string, QueryLiteral>> | undefined,
  definitions: ReadonlyMap<string, QueryParameterDefinition>,
): readonly NormalizedQueryParameterBinding[] {
  const referencedNames = collectReferencedParameterNames(query);
  return freezeArray(
    referencedNames.map((name) => {
      const definition = definitions.get(name);
      const value = params?.[name] ?? definition?.defaultValue;
      if (!definition) {
        throw createValidationError(
          `Serialized query request.query`,
          `references unknown parameter "${name}".`,
        );
      }
      if (value === undefined) {
        throw createValidationError(
          `Serialized query request.params.${name}`,
          "is referenced by the query but was not provided and has no default.",
        );
      }

      return {
        name,
        type: definition.type,
        value: canonicalizeQueryLiteral(value),
      };
    }),
  );
}

function buildResolvedParameterMap(
  bindings: readonly NormalizedQueryParameterBinding[],
): ReadonlyMap<string, QueryLiteral> {
  return new Map(bindings.map((binding) => [binding.name, binding.value] as const));
}

function bindQueryValue(
  value: QueryValue,
  params: ReadonlyMap<string, QueryLiteral>,
  path: string,
): QueryLiteral {
  if (value.kind === "literal") {
    return canonicalizeQueryLiteral(value.value);
  }

  const resolved = params.get(value.name);
  if (resolved === undefined) {
    throw createValidationError(path, `parameter "${value.name}" did not resolve.`);
  }
  return canonicalizeQueryLiteral(resolved);
}

function normalizeCollectionFilter(
  filter: QueryFilter,
  params: ReadonlyMap<string, QueryLiteral>,
): NormalizedQueryFilter {
  if (filter.op === "and" || filter.op === "or") {
    const clauses = filter.clauses.flatMap((clause) => {
      const normalizedClause = normalizeCollectionFilter(clause, params);
      return normalizedClause.op === filter.op ? normalizedClause.clauses : [normalizedClause];
    });
    const orderedClauses = clauses
      .slice()
      .sort((left, right) => compareCanonicalValues(left, right));
    return {
      op: filter.op,
      clauses: freezeArray(orderedClauses),
    };
  }

  if (filter.op === "not") {
    return {
      op: "not",
      clause: normalizeCollectionFilter(filter.clause, params),
    };
  }

  if (filter.op === "exists") {
    return {
      op: "exists",
      fieldId: filter.fieldId,
      value: filter.value,
    };
  }

  if (filter.op === "in") {
    const values = [
      ...new Map(
        filter.values
          .map((value) => bindQueryValue(value, params, `Serialized query request.query.filter`))
          .map((value) => [canonicalStringify(value), value] as const),
      ).values(),
    ].sort((left, right) => compareCanonicalValues(left, right));
    return {
      op: "in",
      fieldId: filter.fieldId,
      values: freezeArray(values),
    };
  }

  switch (filter.op) {
    case "eq":
    case "neq":
    case "contains":
    case "starts-with":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return {
        op: filter.op,
        fieldId: filter.fieldId,
        value: bindQueryValue(filter.value, params, `Serialized query request.query.filter`),
      };
  }
}

function normalizeReadQuery(
  query: ReadQuery,
  params: ReadonlyMap<string, QueryLiteral>,
): {
  readonly pageCursor?: string;
  readonly query: NormalizedReadQuery;
} {
  if (query.kind === "entity") {
    return { query };
  }

  if (query.kind === "neighborhood") {
    return {
      query: {
        kind: "neighborhood",
        rootId: query.rootId,
        ...(query.depth === undefined ? {} : { depth: query.depth }),
        ...(query.predicateIds === undefined
          ? {}
          : { predicateIds: uniqueSortedStrings(query.predicateIds) }),
      },
    };
  }

  if (query.kind === "collection") {
    const pageCursor = query.window?.after;
    return {
      ...(pageCursor === undefined ? {} : { pageCursor }),
      query: {
        kind: "collection",
        indexId: query.indexId,
        ...(query.filter === undefined
          ? {}
          : { filter: normalizeCollectionFilter(query.filter, params) }),
        ...(query.order === undefined ? {} : { order: freezeArray(query.order) }),
        ...(query.window === undefined ? {} : { window: { limit: query.window.limit } }),
      },
    };
  }

  const pageCursor = query.window?.after;
  return {
    ...(pageCursor === undefined ? {} : { pageCursor }),
    query: {
      kind: "scope",
      ...(query.scopeId === undefined ? {} : { scopeId: query.scopeId }),
      ...(query.definition === undefined
        ? {}
        : {
            definition: {
              kind: query.definition.kind,
              ...(query.definition.scopeId === undefined
                ? {}
                : { scopeId: query.definition.scopeId }),
              ...(query.definition.projectionId === undefined
                ? {}
                : { projectionId: query.definition.projectionId }),
              ...(query.definition.roots === undefined
                ? {}
                : { roots: uniqueSortedStrings(query.definition.roots) }),
              ...(query.definition.moduleIds === undefined
                ? {}
                : { moduleIds: uniqueSortedStrings(query.definition.moduleIds) }),
            },
          }),
      ...(query.window === undefined ? {} : { window: { limit: query.window.limit } }),
    },
  };
}

function normalizeExecutionContext(
  context: QueryIdentityExecutionContext | undefined,
): QueryIdentityExecutionContext {
  if (context === undefined) {
    return {};
  }

  return {
    ...(context.principalId === undefined
      ? {}
      : {
          principalId: readOptionalExecutionContextString(
            context.principalId,
            "Serialized query normalization.executionContext.principalId",
          ),
        }),
    ...(context.policyFilterVersion === undefined
      ? {}
      : {
          policyFilterVersion: readOptionalExecutionContextString(
            context.policyFilterVersion,
            "Serialized query normalization.executionContext.policyFilterVersion",
          ),
        }),
    ...(context.scopeDefinitionHash === undefined
      ? {}
      : {
          scopeDefinitionHash: readOptionalExecutionContextString(
            context.scopeDefinitionHash,
            "Serialized query normalization.executionContext.scopeDefinitionHash",
          ),
        }),
    ...(context.projectionDefinitionHash === undefined
      ? {}
      : {
          projectionDefinitionHash: readOptionalExecutionContextString(
            context.projectionDefinitionHash,
            "Serialized query normalization.executionContext.projectionDefinitionHash",
          ),
        }),
    ...(context.projectionCursor === undefined
      ? {}
      : {
          projectionCursor: readOptionalExecutionContextString(
            context.projectionCursor,
            "Serialized query normalization.executionContext.projectionCursor",
          ),
        }),
  };
}

export async function normalizeSerializedQueryRequest(
  value: unknown,
  options: SerializedQueryNormalizationOptions = {},
): Promise<NormalizedQueryRequest> {
  const parameterDefinitions = parseParameterDefinitions(options.parameterDefinitions);
  const request = validateSerializedQueryRequest(value, options);
  const bindings = resolveQueryParameterBindings(
    request.query,
    request.params,
    parameterDefinitions,
  );
  const resolvedParams = buildResolvedParameterMap(bindings);
  const normalized = normalizeReadQuery(request.query, resolvedParams);
  const executionContext = normalizeExecutionContext(options.executionContext);

  const queryJson = canonicalStringify(normalized.query);
  const parameterJson = canonicalStringify(
    bindings.map(({ name, type, value }) => ({ name, type, value })),
  );
  const executionContextJson = canonicalStringify(executionContext);
  const requestJson = canonicalStringify({
    query: normalized.query,
    ...(normalized.pageCursor === undefined ? {} : { pageCursor: normalized.pageCursor }),
  });

  const [queryHash, parameterHash, executionContextHash, requestHash] = await Promise.all([
    hashCanonicalValue(normalized.query),
    hashCanonicalValue(bindings.map(({ name, type, value }) => ({ name, type, value }))),
    hashCanonicalValue(executionContext),
    hashCanonicalValue({
      query: normalized.query,
      ...(normalized.pageCursor === undefined ? {} : { pageCursor: normalized.pageCursor }),
    }),
  ]);

  const identityHash = await hashCanonicalValue({
    executionContextHash,
    parameterHash,
    queryHash,
  });

  return {
    version: serializedQueryVersion,
    query: normalized.query,
    params: bindings,
    metadata: {
      queryHash,
      parameterHash,
      executionContextHash,
      requestHash,
      identityHash,
      queryJson,
      parameterJson,
      executionContextJson,
      requestJson,
      ...(normalized.pageCursor === undefined ? {} : { pageCursor: normalized.pageCursor }),
    },
  };
}

export function validateSerializedQueryResponse(value: unknown): SerializedQueryResponse {
  const record = requireObjectRecord(value, "Serialized query response");
  const ok = requireBoolean(record.ok, "Serialized query response.ok");

  if (!ok) {
    return {
      ok,
      error: requireNonEmptyString(record.error, "Serialized query response.error"),
      ...(record.code === undefined
        ? {}
        : { code: requireNonEmptyString(record.code, "Serialized query response.code") }),
    };
  }

  const result = requireObjectRecord(record.result, "Serialized query response.result");
  const kind = requireNonEmptyString(result.kind, "Serialized query response.result.kind");
  if (!readQueryKindValues.includes(kind as ReadQuery["kind"])) {
    throw createValidationError(
      "Serialized query response.result.kind",
      `must be one of: ${readQueryKindValues.join(", ")}.`,
    );
  }

  if (!Array.isArray(result.items)) {
    throw createValidationError("Serialized query response.result.items", "must be an array.");
  }

  const items = result.items.map((entry, index) => {
    const item = requireObjectRecord(entry, `Serialized query response.result.items[${index}]`);
    const key = requireNonEmptyString(
      item.key,
      `Serialized query response.result.items[${index}].key`,
    );
    const entityId = readOptionalNonEmptyString(
      item.entityId,
      `Serialized query response.result.items[${index}].entityId`,
    );
    const payload = requireObjectRecord(
      item.payload,
      `Serialized query response.result.items[${index}].payload`,
    );

    return entityId === undefined ? { key, payload } : { key, entityId, payload };
  });

  const freshness = requireObjectRecord(
    result.freshness,
    "Serialized query response.result.freshness",
  );
  const completeness = requireNonEmptyString(
    freshness.completeness,
    "Serialized query response.result.freshness.completeness",
  );
  if (
    !responseCompletenessValues.includes(
      completeness as (typeof responseCompletenessValues)[number],
    )
  ) {
    throw createValidationError(
      "Serialized query response.result.freshness.completeness",
      `must be one of: ${responseCompletenessValues.join(", ")}.`,
    );
  }
  const freshnessState = requireNonEmptyString(
    freshness.freshness,
    "Serialized query response.result.freshness.freshness",
  );
  if (
    !responseFreshnessValues.includes(freshnessState as (typeof responseFreshnessValues)[number])
  ) {
    throw createValidationError(
      "Serialized query response.result.freshness.freshness",
      `must be one of: ${responseFreshnessValues.join(", ")}.`,
    );
  }

  const nextCursor = readOptionalNonEmptyString(
    result.nextCursor,
    "Serialized query response.result.nextCursor",
  );
  const projectedAt = readOptionalNonEmptyString(
    freshness.projectedAt,
    "Serialized query response.result.freshness.projectedAt",
  );
  const projectionCursor = readOptionalNonEmptyString(
    freshness.projectionCursor,
    "Serialized query response.result.freshness.projectionCursor",
  );
  const scopeCursor = readOptionalNonEmptyString(
    freshness.scopeCursor,
    "Serialized query response.result.freshness.scopeCursor",
  );

  return {
    ok,
    result: {
      kind: kind as ReadQuery["kind"],
      items,
      freshness: {
        completeness: completeness as QueryResultPage["freshness"]["completeness"],
        freshness: freshnessState as QueryResultPage["freshness"]["freshness"],
        ...(projectedAt === undefined ? {} : { projectedAt }),
        ...(projectionCursor === undefined ? {} : { projectionCursor }),
        ...(scopeCursor === undefined ? {} : { scopeCursor }),
      },
      ...(nextCursor === undefined ? {} : { nextCursor }),
    },
  };
}
