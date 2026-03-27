import {
  fieldVisibility,
  fieldWritePolicy,
  isEntityType,
  isEnumType,
  isFieldsOutput,
  typeId,
  type AnyTypeOutput,
  type Cardinality,
  type EdgeOutput,
  type FieldsOutput,
  type GraphFieldWritePolicy,
  type TypeOutput,
} from "@io/graph-kernel";
import { core } from "@io/graph-module-core";

type GraphMcpNamespace = Record<string, AnyTypeOutput>;
type GraphTypeKind = AnyTypeOutput["kind"] | "unknown";
type GraphSelection = Record<string, unknown>;
type GraphTypeEntry = {
  readonly alias: string;
  readonly type: AnyTypeOutput;
  readonly typeKey: string;
};
type GraphLeafPath = {
  readonly parts: readonly string[];
  readonly path: string;
  readonly rangeKind: GraphTypeKind;
};

const previewPathPriority = [
  "name",
  "label",
  "headline",
  "slug",
  "key",
  "updatedAt",
  "createdAt",
] as const;

export class GraphMcpToolError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "GraphMcpToolError";
    this.code = code;
    this.details = details;
  }
}

export type GraphMcpFieldSummary = {
  readonly cardinality: Cardinality;
  readonly label: string;
  readonly path: string;
  readonly range: string;
  readonly rangeKind: GraphTypeKind;
  readonly writePolicy: GraphFieldWritePolicy;
};

export type GraphMcpTypeSummary =
  | {
      readonly fields: readonly GraphMcpFieldSummary[];
      readonly kind: "entity";
      readonly name: string;
      readonly type: string;
    }
  | {
      readonly kind: "enum";
      readonly name: string;
      readonly options: readonly {
        readonly id: string;
        readonly name: string;
      }[];
      readonly type: string;
    }
  | {
      readonly kind: "scalar";
      readonly name: string;
      readonly type: string;
    };

export type GraphMcpPublicEntityType = GraphTypeEntry & {
  readonly defaultSelection: GraphSelection;
  readonly previewPaths: readonly string[];
  readonly previewSelection: GraphSelection;
  readonly type: TypeOutput;
};

export type GraphMcpSchema = {
  readonly publicEntityTypes: readonly GraphMcpPublicEntityType[];
  readonly publicEntityTypesByKey: ReadonlyMap<string, GraphMcpPublicEntityType>;
  readonly publicTypeSummaries: readonly GraphMcpTypeSummary[];
  readonly typeByRef: ReadonlyMap<string, AnyTypeOutput>;
};

const graphMcpSchemaCache = new WeakMap<GraphMcpNamespace, GraphMcpSchema>();

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  return Object.getPrototypeOf(value) === Object.prototype;
}

function resolveTypeName(typeDef: AnyTypeOutput): string {
  return typeDef.values.name ?? typeDef.values.key;
}

function resolveRangeType(
  typeByRef: ReadonlyMap<string, AnyTypeOutput>,
  range: string,
): AnyTypeOutput | undefined {
  return typeByRef.get(range);
}

function resolveRangeKey(typeByRef: ReadonlyMap<string, AnyTypeOutput>, range: string): string {
  return resolveRangeType(typeByRef, range)?.values.key ?? range;
}

function resolveRangeKind(
  typeByRef: ReadonlyMap<string, AnyTypeOutput>,
  range: string,
): GraphTypeKind {
  return resolveRangeType(typeByRef, range)?.kind ?? "unknown";
}

function readFieldVisibility(field: EdgeOutput): ReturnType<typeof fieldVisibility> {
  return fieldVisibility(field as Parameters<typeof fieldVisibility>[0]);
}

function readFieldWritePolicy(field: EdgeOutput): ReturnType<typeof fieldWritePolicy> {
  return fieldWritePolicy(field as Parameters<typeof fieldWritePolicy>[0]);
}

function collectCombinedTypeEntries(namespace: GraphMcpNamespace): GraphTypeEntry[] {
  const combined = { ...core, ...namespace };
  const out: GraphTypeEntry[] = [];
  const seen = new Set<string>();

  for (const [alias, type] of Object.entries(combined)) {
    if (seen.has(type.values.key)) continue;
    seen.add(type.values.key);
    out.push({
      alias,
      type,
      typeKey: type.values.key,
    });
  }

  return out.sort((left, right) => left.typeKey.localeCompare(right.typeKey));
}

function createTypeIndex(entries: readonly GraphTypeEntry[]): Map<string, AnyTypeOutput> {
  const out = new Map<string, AnyTypeOutput>();

  for (const entry of entries) {
    out.set(entry.type.values.key, entry.type);
    out.set(typeId(entry.type), entry.type);
  }

  return out;
}

function collectPublicTypeKeys(
  namespace: GraphMcpNamespace,
  typeByRef: ReadonlyMap<string, AnyTypeOutput>,
): Set<string> {
  const out = new Set<string>(Object.values(namespace).map((typeDef) => typeDef.values.key));

  function walk(fields: FieldsOutput): void {
    for (const value of Object.values(fields)) {
      if (isFieldsOutput(value)) {
        walk(value);
        continue;
      }

      const field = value as EdgeOutput;
      if (readFieldVisibility(field) === "authority-only") continue;
      const rangeType = resolveRangeType(typeByRef, field.range);
      if (!rangeType) continue;
      out.add(rangeType.values.key);
    }
  }

  for (const typeDef of Object.values(namespace)) {
    if (!isEntityType(typeDef)) continue;
    walk(typeDef.fields);
  }

  return out;
}

function readFieldLabel(fieldName: string, field: EdgeOutput): string {
  const meta = field as EdgeOutput & { meta?: { label?: string } };
  return meta.meta?.label ?? fieldName;
}

function collectVisibleFieldSummaries(
  fields: FieldsOutput,
  typeByRef: ReadonlyMap<string, AnyTypeOutput>,
  path: readonly string[] = [],
): GraphMcpFieldSummary[] {
  const out: GraphMcpFieldSummary[] = [];

  for (const [fieldName, value] of Object.entries(fields)) {
    if (isFieldsOutput(value)) {
      out.push(...collectVisibleFieldSummaries(value, typeByRef, [...path, fieldName]));
      continue;
    }

    const field = value as EdgeOutput;
    if (readFieldVisibility(field) === "authority-only") continue;

    out.push({
      cardinality: field.cardinality,
      label: readFieldLabel(fieldName, field),
      path: [...path, fieldName].join("."),
      range: resolveRangeKey(typeByRef, field.range),
      rangeKind: resolveRangeKind(typeByRef, field.range),
      writePolicy: readFieldWritePolicy(field),
    });
  }

  return out;
}

function summarizeType(
  entry: GraphTypeEntry,
  typeByRef: ReadonlyMap<string, AnyTypeOutput>,
): GraphMcpTypeSummary {
  const name = resolveTypeName(entry.type);

  if (isEntityType(entry.type)) {
    return {
      fields: collectVisibleFieldSummaries(entry.type.fields, typeByRef),
      kind: "entity",
      name,
      type: entry.typeKey,
    };
  }

  if (isEnumType(entry.type)) {
    return {
      kind: "enum",
      name,
      options: Object.values(entry.type.options)
        .map((option) => ({
          id: option.id ?? option.key,
          name: option.name ?? option.key,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      type: entry.typeKey,
    };
  }

  return {
    kind: "scalar",
    name,
    type: entry.typeKey,
  };
}

function createDefaultSelection(fields: FieldsOutput): GraphSelection {
  const selection: GraphSelection = {};

  for (const [fieldName, value] of Object.entries(fields)) {
    if (isFieldsOutput(value)) {
      const nested = createDefaultSelection(value);
      if (Object.keys(nested).length > 0) selection[fieldName] = nested;
      continue;
    }

    const field = value as EdgeOutput;
    if (readFieldVisibility(field) === "authority-only") continue;
    selection[fieldName] = true;
  }

  return selection;
}

function collectVisibleLeafPaths(
  fields: FieldsOutput,
  typeByRef: ReadonlyMap<string, AnyTypeOutput>,
  path: readonly string[] = [],
): GraphLeafPath[] {
  const out: GraphLeafPath[] = [];

  for (const [fieldName, value] of Object.entries(fields)) {
    if (isFieldsOutput(value)) {
      out.push(...collectVisibleLeafPaths(value, typeByRef, [...path, fieldName]));
      continue;
    }

    const field = value as EdgeOutput;
    if (readFieldVisibility(field) === "authority-only") continue;

    const parts = [...path, fieldName];
    out.push({
      parts,
      path: parts.join("."),
      rangeKind: resolveRangeKind(typeByRef, field.range),
    });
  }

  return out;
}

function createPreviewSelection(
  typeDef: TypeOutput,
  typeByRef: ReadonlyMap<string, AnyTypeOutput>,
): Pick<GraphMcpPublicEntityType, "previewPaths" | "previewSelection"> {
  const leafPaths = collectVisibleLeafPaths(typeDef.fields, typeByRef).filter(
    (field) => field.rangeKind !== "entity" && field.path !== "type",
  );
  const seen = new Set<string>();
  const previewPaths: string[] = [];

  for (const candidate of previewPathPriority) {
    const match = leafPaths.find((field) => field.path === candidate);
    if (!match || seen.has(match.path)) continue;
    seen.add(match.path);
    previewPaths.push(match.path);
  }

  if (previewPaths.length === 0) {
    let fallbackCount = 0;
    for (const field of leafPaths) {
      if (seen.has(field.path)) continue;
      seen.add(field.path);
      previewPaths.push(field.path);
      fallbackCount += 1;
      if (fallbackCount === 3) break;
    }
  }

  return {
    previewPaths,
    previewSelection: buildSelectionFromPaths(typeDef, typeByRef, previewPaths),
  };
}

function createInvalidFieldPathError(
  typeKey: string,
  path: string,
  message: string,
): GraphMcpToolError {
  return new GraphMcpToolError("graph.invalidFieldPath", message, {
    path,
    type: typeKey,
  });
}

function getOrCreateSelectionBranch(
  selection: GraphSelection,
  fieldName: string,
  path: string,
  typeKey: string,
): GraphSelection {
  const existing = selection[fieldName];
  if (existing === undefined) {
    const next: GraphSelection = {};
    selection[fieldName] = next;
    return next;
  }

  if (!isPlainRecord(existing)) {
    throw createInvalidFieldPathError(
      typeKey,
      path,
      `Field path "${path}" conflicts with an existing selection on "${fieldName}".`,
    );
  }

  return existing;
}

function getOrCreateReferenceSelection(
  selection: GraphSelection,
  fieldName: string,
  path: string,
  typeKey: string,
): GraphSelection {
  const existing = selection[fieldName];

  if (existing === undefined) {
    const next: GraphSelection = {};
    selection[fieldName] = { select: next };
    return next;
  }

  if (existing === true) {
    const next: GraphSelection = { id: true };
    selection[fieldName] = { select: next };
    return next;
  }

  if (!isPlainRecord(existing) || !("select" in existing) || !isPlainRecord(existing.select)) {
    throw createInvalidFieldPathError(
      typeKey,
      path,
      `Field path "${path}" conflicts with an existing selection on "${fieldName}".`,
    );
  }

  return existing.select;
}

function addEntitySelectionPath(
  typeDef: TypeOutput,
  selection: GraphSelection,
  typeByRef: ReadonlyMap<string, AnyTypeOutput>,
  parts: readonly string[],
  path: string,
): void {
  const [head, ...tail] = parts;
  if (!head) return;

  if (head === "id") {
    if (tail.length > 0) {
      throw createInvalidFieldPathError(
        typeDef.values.key,
        path,
        `Field path "${path}" cannot continue after "id".`,
      );
    }

    selection.id = true;
    return;
  }

  addFieldSelectionPath(typeDef.values.key, typeDef.fields, selection, typeByRef, parts, path);
}

function addFieldSelectionPath(
  typeKey: string,
  fields: FieldsOutput,
  selection: GraphSelection,
  typeByRef: ReadonlyMap<string, AnyTypeOutput>,
  parts: readonly string[],
  path: string,
): void {
  const [head, ...tail] = parts;
  if (!head) return;

  const value = (fields as Record<string, unknown>)[head];
  if (!value) {
    throw createInvalidFieldPathError(
      typeKey,
      path,
      `Unknown field path "${path}" on type "${typeKey}".`,
    );
  }

  if (isFieldsOutput(value)) {
    if (tail.length === 0) {
      throw createInvalidFieldPathError(
        typeKey,
        path,
        `Field path "${path}" refers to a field group. Select a nested field instead.`,
      );
    }

    addFieldSelectionPath(
      typeKey,
      value,
      getOrCreateSelectionBranch(selection, head, path, typeKey),
      typeByRef,
      tail,
      path,
    );
    return;
  }

  const field = value as EdgeOutput;
  if (readFieldVisibility(field) === "authority-only") {
    throw createInvalidFieldPathError(
      typeKey,
      path,
      `Field path "${path}" is not visible on type "${typeKey}".`,
    );
  }

  const rangeType = resolveRangeType(typeByRef, field.range);
  const entityRange = rangeType && isEntityType(rangeType) ? rangeType : undefined;

  if (tail.length === 0) {
    const current = selection[head];
    if (!entityRange || current === undefined || current === true) {
      selection[head] = true;
      return;
    }

    if (isPlainRecord(current) && "select" in current && isPlainRecord(current.select)) {
      current.select.id = true;
      return;
    }

    throw createInvalidFieldPathError(
      typeKey,
      path,
      `Field path "${path}" conflicts with an existing selection on "${head}".`,
    );
  }

  if (!entityRange) {
    throw createInvalidFieldPathError(
      typeKey,
      path,
      `Field path "${path}" cannot continue through "${head}" because it is not an entity reference.`,
    );
  }

  addEntitySelectionPath(
    entityRange,
    getOrCreateReferenceSelection(selection, head, path, typeKey),
    typeByRef,
    tail,
    path,
  );
}

export function buildSelectionFromPaths(
  typeDef: TypeOutput,
  typeByRef: ReadonlyMap<string, AnyTypeOutput>,
  paths: readonly string[],
): GraphSelection {
  const selection: GraphSelection = { id: true };
  const uniquePaths = [...new Set(paths)];

  for (const path of uniquePaths) {
    const trimmed = path.trim();
    if (trimmed.length === 0) continue;
    addEntitySelectionPath(typeDef, selection, typeByRef, trimmed.split("."), trimmed);
  }

  return selection;
}

export function createGraphMcpSchema(namespace: GraphMcpNamespace): GraphMcpSchema {
  const cached = graphMcpSchemaCache.get(namespace);
  if (cached) return cached;

  const combinedEntries = collectCombinedTypeEntries(namespace);
  const typeByRef = createTypeIndex(combinedEntries);
  const publicTypeKeys = collectPublicTypeKeys(namespace, typeByRef);
  const publicEntries = combinedEntries.filter((entry) => publicTypeKeys.has(entry.typeKey));
  const publicEntityTypes = publicEntries.flatMap((entry) => {
    if (!isEntityType(entry.type)) return [];

    const defaultSelection = {
      id: true,
      ...createDefaultSelection(entry.type.fields),
    };
    const preview = createPreviewSelection(entry.type, typeByRef);

    return [
      {
        ...entry,
        defaultSelection,
        previewPaths: preview.previewPaths,
        previewSelection: preview.previewSelection,
        type: entry.type,
      } satisfies GraphMcpPublicEntityType,
    ];
  });

  const schema = {
    publicEntityTypes,
    publicEntityTypesByKey: new Map(publicEntityTypes.map((entry) => [entry.typeKey, entry])),
    publicTypeSummaries: publicEntries.map((entry) => summarizeType(entry, typeByRef)),
    typeByRef,
  };

  graphMcpSchemaCache.set(namespace, schema);
  return schema;
}
