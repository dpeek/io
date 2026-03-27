import {
  edgeId,
  isEntityType,
  isFieldsOutput,
  typeId,
  type AnyTypeOutput,
  type EdgeOutput,
  type GraphStore,
} from "@io/app/graph";
import {
  type EntityRef,
  fieldGroupMeta,
  type GraphMutationValidationResult,
  type PredicateRef,
} from "@io/graph-client";
import type { MutableRefObject } from "react";

import { isEdgeOutputValue } from "./create-draft-plan.js";
import {
  cloneDraftValue,
  getDraftValue,
  removeDraftItem,
  setDraftValue,
} from "./create-draft-values.js";
import { typePredicateId } from "./model.js";
import type { EntityCatalogEntry } from "./model.js";

type DraftControllerOptions = {
  entry: EntityCatalogEntry;
  entityEntryByIdRef: MutableRefObject<ReadonlyMap<string, EntityCatalogEntry>>;
  initialInput: Record<string, unknown>;
  store: GraphStore;
  typeById: ReadonlyMap<string, AnyTypeOutput>;
};

export type DraftController = {
  fields: Record<string, unknown>;
  getInput(): Record<string, unknown>;
};

export function createDraftController({
  entry,
  entityEntryByIdRef,
  initialInput,
  store,
  typeById,
}: DraftControllerOptions): DraftController {
  let currentInput = cloneDraftValue(initialInput);
  const listenersByPath = new Map<string, Set<() => void>>();
  const draftSubjectId = `draft:${entry.id}`;

  function readValue(path: readonly string[], fieldName: string, field: EdgeOutput): unknown {
    return getDraftValue(currentInput, path, fieldName, field);
  }

  function subscribePath(pathLabel: string, listener: () => void): () => void {
    const listeners = listenersByPath.get(pathLabel) ?? new Set<() => void>();
    listeners.add(listener);
    listenersByPath.set(pathLabel, listeners);

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) listenersByPath.delete(pathLabel);
    };
  }

  function notifyPath(pathLabel: string): void {
    listenersByPath.get(pathLabel)?.forEach((listener) => listener());
  }

  function applyMutation(path: readonly string[], fieldName: string, nextValue: unknown): void {
    currentInput = setDraftValue(currentInput, path, fieldName, nextValue);
    notifyPath([...path, fieldName].join("."));
  }

  function validateMutation(
    path: readonly string[],
    fieldName: string,
    field: EdgeOutput,
    nextValue: unknown,
  ): GraphMutationValidationResult {
    const nextInput = setDraftValue(currentInput, path, fieldName, nextValue);
    const validation = entry.validateCreate(nextInput as never);
    if (validation.ok) return validation;

    const relevantIssues = validation.issues.filter((issue) => issue.predicateKey === field.key);
    if (relevantIssues.length > 0) return validation;

    return {
      changedPredicateKeys: validation.changedPredicateKeys,
      event: validation.event,
      ok: true,
      phase: validation.phase,
      value: cloneDraftValue(nextInput),
    };
  }

  function resolveEntity(rangeTypeId: string, id: string): EntityRef<any, any> | undefined {
    if (store.facts(id, typePredicateId, rangeTypeId).length === 0) return undefined;
    const rangeEntry = entityEntryByIdRef.current.get(rangeTypeId);
    return rangeEntry ? rangeEntry.getRef(id) : undefined;
  }

  function listEntities(rangeTypeId: string): EntityRef<any, any>[] {
    const rangeEntry = entityEntryByIdRef.current.get(rangeTypeId);
    return rangeEntry ? rangeEntry.ids.map((id) => rangeEntry.getRef(id)) : [];
  }

  function buildFields(
    node: Record<string, unknown>,
    path: string[] = [],
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    Object.defineProperty(out, fieldGroupMeta, {
      value: {
        fieldTree: node,
        path: Object.freeze([...path]),
        subjectId: draftSubjectId,
      },
      enumerable: false,
      configurable: false,
      writable: false,
    });

    for (const [fieldName, value] of Object.entries(node)) {
      if (isEdgeOutputValue(value)) {
        const field = value;
        const pathLabel = [...path, fieldName].join(".");
        const rangeType = typeById.get(field.range);
        const base = {
          batch<TResult>(fn: () => TResult) {
            return fn();
          },
          field,
          get() {
            return readValue(path, fieldName, field);
          },
          listEntities() {
            return rangeType && isEntityType(rangeType) ? listEntities(typeId(rangeType)) : [];
          },
          predicateId: edgeId(field),
          rangeType,
          resolveEntity(id: string) {
            return rangeType && isEntityType(rangeType)
              ? resolveEntity(typeId(rangeType), id)
              : undefined;
          },
          subjectId: draftSubjectId,
          subscribe(listener: () => void) {
            return subscribePath(pathLabel, listener);
          },
        };

        if (field.cardinality === "many") {
          out[fieldName] = {
            ...base,
            add: (valueToAdd: unknown) => {
              const currentValues = base.get() as unknown[];
              applyMutation(path, fieldName, [...currentValues, valueToAdd]);
            },
            clear: () => {
              applyMutation(path, fieldName, undefined);
            },
            collection: {
              kind:
                (
                  field as {
                    meta?: { collection?: { kind?: "ordered" | "unordered" } };
                  }
                ).meta?.collection?.kind ?? "ordered",
            },
            remove: (valueToRemove: unknown) => {
              const currentValues = base.get() as unknown[];
              applyMutation(path, fieldName, removeDraftItem(currentValues, valueToRemove));
            },
            replace: (nextValues: unknown[]) => {
              applyMutation(path, fieldName, nextValues);
            },
            validateAdd: (valueToAdd: unknown) => {
              const currentValues = base.get() as unknown[];
              return validateMutation(path, fieldName, field, [...currentValues, valueToAdd]);
            },
            validateClear: () => {
              return validateMutation(path, fieldName, field, undefined);
            },
            validateRemove: (valueToRemove: unknown) => {
              const currentValues = base.get() as unknown[];
              return validateMutation(
                path,
                fieldName,
                field,
                removeDraftItem(currentValues, valueToRemove),
              );
            },
            validateReplace: (nextValues: unknown[]) => {
              return validateMutation(path, fieldName, field, nextValues);
            },
          } satisfies PredicateRef<any, any>;
          continue;
        }

        if (field.cardinality === "one?") {
          out[fieldName] = {
            ...base,
            clear() {
              applyMutation(path, fieldName, undefined);
            },
            set(nextValue: unknown) {
              applyMutation(path, fieldName, nextValue);
            },
            validateClear() {
              return validateMutation(path, fieldName, field, undefined);
            },
            validateSet(nextValue: unknown) {
              return validateMutation(path, fieldName, field, nextValue);
            },
          } satisfies PredicateRef<any, any>;
          continue;
        }

        out[fieldName] = {
          ...base,
          set(nextValue: unknown) {
            applyMutation(path, fieldName, nextValue);
          },
          validateSet(nextValue: unknown) {
            return validateMutation(path, fieldName, field, nextValue);
          },
        } satisfies PredicateRef<any, any>;
        continue;
      }

      if (!isFieldsOutput(value)) continue;
      out[fieldName] = buildFields(value as Record<string, unknown>, [...path, fieldName]);
    }

    return out;
  }

  return {
    fields: buildFields(entry.typeDef.fields as Record<string, unknown>),
    getInput() {
      return cloneDraftValue(currentInput);
    },
  };
}
