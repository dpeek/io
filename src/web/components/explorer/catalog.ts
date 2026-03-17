import {
  core,
  edgeId,
  type GraphMutationValidationResult,
  isEntityType,
  isFieldGroupRef,
  resolvePredicateDefinitionIconId,
  resolveTypeDefinitionIconId,
  type AnyTypeOutput,
  type Store,
  typeId,
} from "@io/core/graph";

import type {
  AnyEntityRef,
  AnyPredicateRef,
  DefinitionFieldEntry,
  EntityCatalogEntry,
  ExplorerClient,
  MutableOptionalPredicateRef,
  PredicateCatalogEntry,
  PredicateFieldEntry,
  TypeCatalogEntry,
} from "./model.js";
import { explorerNamespace, typePredicateId } from "./model.js";

function compareExplorerNamespaces(left: string, right: string): number {
  return Number(left.startsWith("core:")) - Number(right.startsWith("core:"));
}

function isDefinitionField(
  value: unknown,
): value is { cardinality: "one" | "one?" | "many"; key: string; range: string } {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<{ cardinality: string; key: string; range: string }>;
  return (
    typeof candidate.key === "string" &&
    typeof candidate.range === "string" &&
    typeof candidate.cardinality === "string"
  );
}

export function flattenDefinitionFields(
  tree: Record<string, unknown>,
  typeById: ReadonlyMap<string, AnyTypeOutput>,
  path: string[] = [],
  out: DefinitionFieldEntry[] = [],
): DefinitionFieldEntry[] {
  for (const [fieldName, value] of Object.entries(tree)) {
    if (isDefinitionField(value)) {
      out.push({
        cardinality: value.cardinality,
        iconId: resolvePredicateDefinitionIconId(value, typeById.get(value.range)),
        key: value.key,
        pathLabel: [...path, fieldName].join("."),
        predicateId: edgeId(value),
        rangeId: value.range,
      });
      continue;
    }

    if (!value || typeof value !== "object") continue;
    flattenDefinitionFields(value as Record<string, unknown>, typeById, [...path, fieldName], out);
  }

  return out;
}

export function buildTypeCatalog(store: Store): TypeCatalogEntry[] {
  const kindOrder: Record<AnyTypeOutput["kind"], number> = {
    entity: 0,
    enum: 1,
    scalar: 2,
  };
  const typeDefs = Object.values(explorerNamespace);
  const typeById = new Map(typeDefs.map((typeDef) => [typeId(typeDef), typeDef]));

  return typeDefs
    .map((typeDef) => ({
      compiledIconId: resolveTypeDefinitionIconId(typeDef),
      dataCount:
        typeDef.kind === "entity"
          ? store.facts(undefined, typePredicateId, typeId(typeDef)).length
          : 0,
      fieldDefs: typeDef.kind === "entity" ? flattenDefinitionFields(typeDef.fields, typeById) : [],
      id: typeId(typeDef),
      key: typeDef.values.key,
      kind: typeDef.kind,
      name: typeDef.values.name ?? typeDef.values.key,
      optionDefs:
        typeDef.kind === "enum"
          ? Object.values(typeDef.options).map((option) => ({
              description: option.description,
              id: option.id ?? option.key,
              key: option.key,
              name: option.name,
            }))
          : [],
      typeDef,
    }))
    .sort((left, right) => {
      const byNamespace = compareExplorerNamespaces(left.key, right.key);
      if (byNamespace !== 0) return byNamespace;
      const byKind = kindOrder[left.kind] - kindOrder[right.kind];
      if (byKind !== 0) return byKind;
      return left.key.localeCompare(right.key);
    });
}

export function buildEntityCatalog(client: ExplorerClient, store: Store): EntityCatalogEntry[] {
  const handles = client as unknown as Record<
    string,
    {
      create?: (input: Record<string, unknown>) => string;
      ref?: (id: string) => AnyEntityRef;
      validateCreate?: (input: Record<string, unknown>) => GraphMutationValidationResult;
    }
  >;
  const typeById = new Map(
    Object.values(explorerNamespace).map((typeDef) => [typeId(typeDef), typeDef]),
  );
  const entries = Object.entries(explorerNamespace).filter(([, typeDef]) =>
    isEntityType(typeDef),
  ) as Array<[string, Extract<AnyTypeOutput, { kind: "entity" }>]>;

  return entries
    .sort(([, left], [, right]) => {
      const byNamespace = compareExplorerNamespaces(left.values.key, right.values.key);
      if (byNamespace !== 0) return byNamespace;
      return left.values.key.localeCompare(right.values.key);
    })
    .map(([alias, typeDef]) => {
      const handle = handles[alias]?.ref;
      if (!handle) {
        throw new Error(`Missing explorer handle for entity type "${alias}"`);
      }
      const create = handles[alias]?.create;
      const validateCreate = handles[alias]?.validateCreate;
      if (!create || !validateCreate) {
        throw new Error(`Missing create handle for entity type "${alias}"`);
      }

      const fieldDefs = flattenDefinitionFields(typeDef.fields, typeById);
      const iconPredicateId = fieldDefs.find(
        (fieldDef) =>
          fieldDef.rangeId === typeId(core.icon) &&
          (fieldDef.cardinality === "one" || fieldDef.cardinality === "one?"),
      )?.predicateId;
      const ids = store.facts(undefined, typePredicateId, typeId(typeDef)).map((edge) => edge.s);

      return {
        count: ids.length,
        create,
        getRef(id: string) {
          return handle(id);
        },
        id: typeId(typeDef),
        iconPredicateId,
        ids,
        key: typeDef.values.key,
        name: typeDef.values.name ?? typeDef.values.key,
        typeDef,
        validateCreate,
      };
    });
}

export function buildPredicateCatalog(
  client: ExplorerClient,
  typeEntries: readonly TypeCatalogEntry[],
): PredicateCatalogEntry[] {
  const predicateHandle = (
    client as unknown as Record<string, { ref?: (id: string) => AnyEntityRef }>
  ).predicate?.ref;
  if (!predicateHandle) {
    throw new Error('Missing explorer handle for "predicate"');
  }

  const byId = new Map<string, PredicateCatalogEntry>();

  for (const typeEntry of typeEntries) {
    if (typeEntry.typeDef.kind !== "entity") continue;

    for (const fieldDef of typeEntry.fieldDefs) {
      const existing = byId.get(fieldDef.predicateId);
      if (existing) {
        existing.owners.push({
          pathLabel: fieldDef.pathLabel,
          typeId: typeEntry.id,
          typeKey: typeEntry.key,
          typeName: typeEntry.name,
        });
        continue;
      }

      byId.set(fieldDef.predicateId, {
        compiledCardinality: fieldDef.cardinality,
        compiledIconId: fieldDef.iconId,
        compiledRangeId: fieldDef.rangeId,
        getRef() {
          return predicateHandle(fieldDef.predicateId);
        },
        id: fieldDef.predicateId,
        key: fieldDef.key,
        owners: [
          {
            pathLabel: fieldDef.pathLabel,
            typeId: typeEntry.id,
            typeKey: typeEntry.key,
            typeName: typeEntry.name,
          },
        ],
      });
    }
  }

  return [...byId.values()].sort((left, right) => left.key.localeCompare(right.key));
}

function isPredicateRef(value: unknown): value is AnyPredicateRef {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AnyPredicateRef>;
  return typeof candidate.predicateId === "string" && typeof candidate.get === "function";
}

export function flattenPredicateRefs(
  node: Record<string, unknown>,
  path: string[] = [],
  out: PredicateFieldEntry[] = [],
): PredicateFieldEntry[] {
  for (const [fieldName, value] of Object.entries(node)) {
    if (isPredicateRef(value)) {
      out.push({
        pathLabel: [...path, fieldName].join("."),
        predicate: value,
      });
      continue;
    }

    if (!isFieldGroupRef(value)) continue;
    flattenPredicateRefs(value as Record<string, unknown>, [...path, fieldName], out);
  }

  return out;
}

export function asNodeMetadataFields(fields: unknown): {
  createdAt: AnyPredicateRef;
  description: AnyPredicateRef;
  label: AnyPredicateRef;
  name: AnyPredicateRef;
  updatedAt: AnyPredicateRef;
} {
  return fields as {
    createdAt: AnyPredicateRef;
    description: AnyPredicateRef;
    label: AnyPredicateRef;
    name: AnyPredicateRef;
    updatedAt: AnyPredicateRef;
  };
}

export function asTypeMetadataFields(fields: unknown): {
  createdAt: AnyPredicateRef;
  description: AnyPredicateRef;
  icon: MutableOptionalPredicateRef;
  label: AnyPredicateRef;
  name: AnyPredicateRef;
  updatedAt: AnyPredicateRef;
} {
  return fields as {
    createdAt: AnyPredicateRef;
    description: AnyPredicateRef;
    icon: MutableOptionalPredicateRef;
    label: AnyPredicateRef;
    name: AnyPredicateRef;
    updatedAt: AnyPredicateRef;
  };
}

export function asPredicateMetadataFields(fields: unknown): {
  cardinality: AnyPredicateRef;
  description: AnyPredicateRef;
  icon: MutableOptionalPredicateRef;
  key: AnyPredicateRef;
  name: AnyPredicateRef;
  range: MutableOptionalPredicateRef;
} {
  return fields as {
    cardinality: AnyPredicateRef;
    description: AnyPredicateRef;
    icon: MutableOptionalPredicateRef;
    key: AnyPredicateRef;
    name: AnyPredicateRef;
    range: MutableOptionalPredicateRef;
  };
}
