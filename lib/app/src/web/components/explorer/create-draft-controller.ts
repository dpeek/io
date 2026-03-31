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
  type FieldGroupRef,
  type GraphMutationValidationResult,
  type PredicateRef,
} from "@io/graph-client";
import type {
  EditSessionController,
  EditSessionFieldController,
  EditSessionPath,
} from "@io/graph-react";
import type { MutableRefObject } from "react";

import { isEdgeOutputValue } from "./create-draft-plan.js";
import {
  cloneDraftValue,
  getDraftValue,
  removeDraftItem,
  sameLogicalValue,
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
  session: EditSessionController<Record<string, unknown>>;
  getInput(): Record<string, unknown>;
};

export function createDraftController({
  entry,
  entityEntryByIdRef,
  initialInput,
  store,
  typeById,
}: DraftControllerOptions): DraftController {
  let committedInput = cloneDraftValue(initialInput);
  let currentInput = cloneDraftValue(initialInput);
  const sessionListeners = new Set<() => void>();
  const listenersByPath = new Map<string, Set<() => void>>();
  const touchedPaths = new Set<string>();
  const fieldControllersByPath = new Map<string, EditSessionFieldController<unknown>>();
  const fieldEntries: Array<{
    field: EdgeOutput;
    fieldName: string;
    path: readonly string[];
    pathKey: string;
  }> = [];
  const draftSubjectId = `draft:${entry.id}`;
  const submitCommitPolicy = { mode: "submit" } as const;

  function pathKey(path: EditSessionPath): string {
    return JSON.stringify([...path]);
  }

  function readValue(path: readonly string[], fieldName: string, field: EdgeOutput): unknown {
    return getDraftValue(currentInput, path, fieldName, field);
  }

  function readCommittedValue(
    path: readonly string[],
    fieldName: string,
    field: EdgeOutput,
  ): unknown {
    return getDraftValue(committedInput, path, fieldName, field);
  }

  function subscribePath(pathKeyValue: string, listener: () => void): () => void {
    const listeners = listenersByPath.get(pathKeyValue) ?? new Set<() => void>();
    listeners.add(listener);
    listenersByPath.set(pathKeyValue, listeners);

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) listenersByPath.delete(pathKeyValue);
    };
  }

  function notifyPaths(pathKeys: readonly string[]): void {
    for (const pathKeyValue of new Set(pathKeys)) {
      listenersByPath.get(pathKeyValue)?.forEach((listener) => listener());
    }
    sessionListeners.forEach((listener) => listener());
  }

  function fieldSnapshot(
    path: readonly string[],
    fieldName: string,
    field: EdgeOutput,
  ): {
    committedValue: unknown;
    draftValue: unknown;
    dirty: boolean;
    touched: boolean;
  } {
    const committedValue = readCommittedValue(path, fieldName, field);
    const draftValue = readValue(path, fieldName, field);
    const fullPath = [...path, fieldName];
    return {
      committedValue,
      dirty: !sameLogicalValue(committedValue, draftValue),
      draftValue,
      touched: touchedPaths.has(pathKey(fullPath)),
    };
  }

  function collectDirtyFieldPathKeys(): string[] {
    return fieldEntries.flatMap((fieldEntry) =>
      fieldSnapshot(fieldEntry.path, fieldEntry.fieldName, fieldEntry.field).dirty
        ? [fieldEntry.pathKey]
        : [],
    );
  }

  function collectChangedFieldPathKeys(
    currentValue: Record<string, unknown>,
    nextValue: Record<string, unknown>,
  ): string[] {
    return fieldEntries.flatMap((fieldEntry) => {
      const previousFieldValue = getDraftValue(
        currentValue,
        fieldEntry.path,
        fieldEntry.fieldName,
        fieldEntry.field,
      );
      const nextFieldValue = getDraftValue(
        nextValue,
        fieldEntry.path,
        fieldEntry.fieldName,
        fieldEntry.field,
      );
      return sameLogicalValue(previousFieldValue, nextFieldValue) ? [] : [fieldEntry.pathKey];
    });
  }

  function applyMutation(path: readonly string[], fieldName: string, nextValue: unknown): void {
    const nextInput = setDraftValue(currentInput, path, fieldName, nextValue);
    if (sameLogicalValue(currentInput, nextInput)) return;
    const fullPath = [...path, fieldName];
    currentInput = nextInput;
    notifyPaths([pathKey(fullPath)]);
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

  function createFieldController(
    path: readonly string[],
    fieldName: string,
    field: EdgeOutput,
  ): EditSessionFieldController<unknown> {
    const fullPath = Object.freeze([...path, fieldName]) as readonly string[];
    const fullPathKey = pathKey(fullPath);
    const controller = {
      commit() {
        const snapshot = fieldSnapshot(path, fieldName, field);
        if (!snapshot.dirty) return false;
        committedInput = setDraftValue(committedInput, path, fieldName, snapshot.draftValue);
        notifyPaths([fullPathKey]);
        return true;
      },
      commitPolicy: submitCommitPolicy,
      getSnapshot() {
        return fieldSnapshot(path, fieldName, field);
      },
      path: fullPath,
      revert() {
        const snapshot = fieldSnapshot(path, fieldName, field);
        if (!snapshot.dirty) return false;
        currentInput = setDraftValue(currentInput, path, fieldName, snapshot.committedValue);
        notifyPaths([fullPathKey]);
        return true;
      },
      setDraftValue(nextValue: unknown) {
        applyMutation(path, fieldName, nextValue);
      },
      setTouched(nextTouched: boolean) {
        const hadTouched = touchedPaths.has(fullPathKey);
        if (hadTouched === nextTouched) return;
        if (nextTouched) {
          touchedPaths.add(fullPathKey);
        } else {
          touchedPaths.delete(fullPathKey);
        }
        notifyPaths([fullPathKey]);
      },
      subscribe(listener: () => void) {
        return subscribePath(fullPathKey, listener);
      },
    } satisfies EditSessionFieldController<unknown>;

    fieldEntries.push({ field, fieldName, path, pathKey: fullPathKey });
    fieldControllersByPath.set(fullPathKey, controller);
    return controller;
  }

  const session = {
    commit() {
      if (!session.getSnapshot().dirty) return false;
      const dirtyPathKeys = collectDirtyFieldPathKeys();
      committedInput = cloneDraftValue(currentInput);
      notifyPaths(dirtyPathKeys);
      return true;
    },
    defaultCommitPolicy: submitCommitPolicy,
    getField(path: EditSessionPath) {
      return fieldControllersByPath.get(pathKey(path));
    },
    getSnapshot() {
      return {
        committedValue: cloneDraftValue(committedInput),
        draftValue: cloneDraftValue(currentInput),
        dirty: !sameLogicalValue(committedInput, currentInput),
        touched: touchedPaths.size > 0,
      };
    },
    revert() {
      if (!session.getSnapshot().dirty) return false;
      const dirtyPathKeys = collectDirtyFieldPathKeys();
      currentInput = cloneDraftValue(committedInput);
      notifyPaths(dirtyPathKeys);
      return true;
    },
    setDraftValue(nextValue: Record<string, unknown>) {
      const nextInput = cloneDraftValue(nextValue);
      if (sameLogicalValue(currentInput, nextInput)) return;
      const changedPathKeys = collectChangedFieldPathKeys(currentInput, nextInput);
      currentInput = nextInput;
      notifyPaths(changedPathKeys);
    },
    setTouched(nextTouched: boolean) {
      const changedPathKeys = fieldEntries
        .filter((fieldEntry) => touchedPaths.has(fieldEntry.pathKey) !== nextTouched)
        .map((fieldEntry) => fieldEntry.pathKey);
      if (changedPathKeys.length === 0) return;
      if (nextTouched) {
        for (const pathKeyValue of changedPathKeys) touchedPaths.add(pathKeyValue);
      } else {
        for (const pathKeyValue of changedPathKeys) touchedPaths.delete(pathKeyValue);
      }
      notifyPaths(changedPathKeys);
    },
    subscribe(listener: () => void) {
      sessionListeners.add(listener);
      return () => {
        sessionListeners.delete(listener);
      };
    },
  } satisfies EditSessionController<Record<string, unknown>>;

  function buildFields(node: Record<string, unknown>, path: string[] = []): FieldGroupRef<any> {
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
        const fieldController = createFieldController(path, fieldName, field);
        const rangeType = typeById.get(field.range);
        const base = {
          batch<TResult>(fn: () => TResult) {
            return fn();
          },
          field,
          get() {
            return fieldController.getSnapshot().draftValue;
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
            return fieldController.subscribe(listener);
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

    return out as FieldGroupRef<any>;
  }

  return {
    fields: buildFields(entry.typeDef.fields as Record<string, unknown>),
    session,
    getInput() {
      return session.getSnapshot().draftValue;
    },
  };
}
