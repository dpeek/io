import {
  edgeId,
  fieldGroupMeta,
  fieldWritePolicy,
  GraphValidationError,
  isEntityType,
  isEnumType,
  isFieldsOutput,
  typeId,
  type AnyTypeOutput,
  type EdgeOutput,
  type EntityRef,
  type GraphMutationValidationResult,
  type PredicateRef,
  type Store,
} from "@io/core/graph";
import { Button } from "@io/web/button";
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";

import { flattenPredicateRefs } from "./catalog.js";
import { InspectorFieldSection, InspectorShell } from "./inspector.js";
import {
  createdAtPredicateId,
  explorerNamespace,
  typePredicateId,
  updatedAtPredicateId,
} from "./model.js";
import type { EntityCatalogEntry, ExplorerRuntime } from "./model.js";
import { describeSyncError } from "./sync.js";
import { EmptyState, Section } from "./ui.js";

const defaultTagColors = [
  "#2563eb",
  "#0f766e",
  "#d97706",
  "#be123c",
  "#7c3aed",
  "#0891b2",
] as const;

type DraftFieldDefinition = {
  field: EdgeOutput;
  fieldName: string;
  path: string[];
  pathLabel: string;
  predicateId: string;
  reason?: string;
};

type CreatePlan = {
  clientFields: DraftFieldDefinition[];
  deferredFields: DraftFieldDefinition[];
  requiredBlockingFields: DraftFieldDefinition[];
  supported: boolean;
};

type DraftControllerOptions = {
  entry: EntityCatalogEntry;
  entityEntryByIdRef: MutableRefObject<ReadonlyMap<string, EntityCatalogEntry>>;
  initialInput: Record<string, unknown>;
  store: Store;
  typeById: ReadonlyMap<string, AnyTypeOutput>;
};

type DraftController = {
  fields: Record<string, unknown>;
  getInput(): Record<string, unknown>;
};

function isEdgeOutputValue(value: unknown): value is EdgeOutput {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<EdgeOutput>;
  return (
    typeof candidate.key === "string" &&
    typeof candidate.range === "string" &&
    typeof candidate.cardinality === "string"
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  return Object.getPrototypeOf(value) === Object.prototype;
}

function cloneDraftValue<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (value instanceof URL) return new URL(value.toString()) as T;
  if (Array.isArray(value)) return value.map((item) => cloneDraftValue(item)) as T;
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nextValue]) => [key, cloneDraftValue(nextValue)]),
    ) as T;
  }
  return value;
}

function sameLogicalValue(left: unknown, right: unknown): boolean {
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
  if (left instanceof URL && right instanceof URL) return left.toString() === right.toString();

  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (!sameLogicalValue(left[index], right[index])) return false;
    }
    return true;
  }

  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    for (const key of leftKeys) {
      if (!(key in right)) return false;
      if (!sameLogicalValue(left[key], right[key])) return false;
    }
    return true;
  }

  return Object.is(left, right);
}

function getDraftValue(
  input: Record<string, unknown>,
  path: readonly string[],
  fieldName: string,
  field: EdgeOutput,
): unknown {
  let current: unknown = input;
  for (const segment of path) {
    if (!isPlainObject(current) || !(segment in current)) {
      return field.cardinality === "many" ? [] : undefined;
    }
    current = current[segment];
  }

  if (!isPlainObject(current) || !(fieldName in current)) {
    return field.cardinality === "many" ? [] : undefined;
  }

  const value = current[fieldName];
  if (value === undefined) return field.cardinality === "many" ? [] : undefined;
  return cloneDraftValue(value);
}

function setDraftValue(
  input: Record<string, unknown>,
  path: readonly string[],
  fieldName: string,
  nextValue: unknown,
): Record<string, unknown> {
  const nextInput = cloneDraftValue(input);
  let current: Record<string, unknown> = nextInput;

  for (const segment of path) {
    const existing = current[segment];
    if (!isPlainObject(existing)) {
      const created: Record<string, unknown> = {};
      current[segment] = created;
      current = created;
      continue;
    }
    current = existing;
  }

  if (nextValue === undefined) {
    delete current[fieldName];
  } else {
    current[fieldName] = cloneDraftValue(nextValue);
  }

  return nextInput;
}

function removeDraftItem(values: readonly unknown[], value: unknown): unknown[] {
  const nextValues = [...values];
  const index = nextValues.findIndex((candidate) => sameLogicalValue(candidate, value));
  if (index >= 0) nextValues.splice(index, 1);
  return nextValues;
}

function describeDeferredFieldReason(field: DraftFieldDefinition): string {
  if (field.predicateId === typePredicateId) return "Assigned automatically by the graph.";
  if (field.predicateId === createdAtPredicateId || field.predicateId === updatedAtPredicateId) {
    return "Managed by lifecycle hooks after create.";
  }

  const writePolicy = fieldWritePolicy(field.field as Parameters<typeof fieldWritePolicy>[0]);
  if (writePolicy === "server-command") {
    return "Edited after create through a server-command flow.";
  }
  if (writePolicy === "authority-only") {
    return "Authority-owned and not editable from this client.";
  }
  return "Edited after create through the normal entity view.";
}

function collectDraftFields(
  node: Record<string, unknown>,
  path: string[] = [],
  out: DraftFieldDefinition[] = [],
): DraftFieldDefinition[] {
  for (const [fieldName, value] of Object.entries(node)) {
    if (isEdgeOutputValue(value)) {
      out.push({
        field: value,
        fieldName,
        path,
        pathLabel: [...path, fieldName].join("."),
        predicateId: edgeId(value),
      });
      continue;
    }

    if (!isFieldsOutput(value)) continue;
    collectDraftFields(value as Record<string, unknown>, [...path, fieldName], out);
  }

  return out;
}

export function buildCreatePlan(entry: EntityCatalogEntry): CreatePlan {
  const clientFields: DraftFieldDefinition[] = [];
  const deferredFields: DraftFieldDefinition[] = [];
  const requiredBlockingFields: DraftFieldDefinition[] = [];

  for (const field of collectDraftFields(entry.typeDef.fields as Record<string, unknown>)) {
    const isManagedField =
      field.predicateId === typePredicateId ||
      field.predicateId === createdAtPredicateId ||
      field.predicateId === updatedAtPredicateId;
    const writePolicy = fieldWritePolicy(field.field as Parameters<typeof fieldWritePolicy>[0]);

    if (isManagedField || writePolicy !== "client-tx") {
      const deferred = {
        ...field,
        reason: describeDeferredFieldReason(field),
      };
      deferredFields.push(deferred);
      if (field.field.cardinality === "one" && !isManagedField) {
        requiredBlockingFields.push(deferred);
      }
      continue;
    }

    clientFields.push(field);
  }

  return {
    clientFields,
    deferredFields,
    requiredBlockingFields,
    supported: requiredBlockingFields.length === 0,
  };
}

function buildCreateDefaults(
  entry: EntityCatalogEntry,
  typeById: ReadonlyMap<string, AnyTypeOutput>,
): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};

  for (const field of collectDraftFields(entry.typeDef.fields as Record<string, unknown>)) {
    if (fieldWritePolicy(field.field as Parameters<typeof fieldWritePolicy>[0]) !== "client-tx") {
      continue;
    }
    if (field.field.cardinality !== "one") continue;

    const rangeType = typeById.get(field.field.range);
    if (!rangeType || !isEnumType(rangeType)) continue;
    const firstOption = Object.values(rangeType.options)[0];
    if (!firstOption) continue;
    const optionId = firstOption.id ?? firstOption.key;
    Object.assign(defaults, setDraftValue(defaults, field.path, field.fieldName, optionId));
  }

  if (entry.key === "app:topic") {
    return setDraftValue(defaults, [], "order", entry.count);
  }

  if (entry.key === "core:tag") {
    return setDraftValue(
      defaults,
      [],
      "color",
      defaultTagColors[entry.count % defaultTagColors.length] ?? defaultTagColors[0],
    );
  }

  return defaults;
}

function createDraftController({
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

function DeferredFieldSection({ fields }: { fields: readonly DraftFieldDefinition[] }) {
  if (fields.length === 0) return null;

  return (
    <Section title="After Create">
      <div className="grid gap-3">
        {fields.map((field) => (
          <div
            className="border-border bg-muted/20 rounded-xl border px-4 py-3"
            data-explorer-deferred-field={field.pathLabel}
            key={field.pathLabel}
          >
            <div className="text-sm font-medium">{field.pathLabel}</div>
            <div className="text-muted-foreground mt-1 text-sm">
              {field.reason ?? describeDeferredFieldReason(field)}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

export function GenericCreateInspector({
  entityEntry,
  entityEntryById,
  onCancelCreate,
  onCreated,
  runtime,
}: {
  entityEntry: EntityCatalogEntry;
  entityEntryById: ReadonlyMap<string, EntityCatalogEntry>;
  onCancelCreate?: () => void;
  onCreated: (entityId: string) => void;
  runtime: ExplorerRuntime;
}) {
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const entityEntryRef = useRef(entityEntry);
  const entityEntryByIdRef = useRef(entityEntryById);

  useEffect(() => {
    entityEntryRef.current = entityEntry;
  }, [entityEntry]);

  useEffect(() => {
    entityEntryByIdRef.current = entityEntryById;
  }, [entityEntryById]);

  const typeById = useMemo(
    () => new Map(Object.values(explorerNamespace).map((typeDef) => [typeId(typeDef), typeDef])),
    [],
  );
  const createPlan = useMemo(() => buildCreatePlan(entityEntry), [entityEntry.id]);
  const controller = useMemo(
    () =>
      createDraftController({
        entry: entityEntry,
        entityEntryByIdRef,
        initialInput: buildCreateDefaults(entityEntry, typeById),
        store: runtime.store,
        typeById,
      }),
    [entityEntry.id, runtime.store, typeById],
  );
  const predicateRows = useMemo(
    () =>
      new Map(flattenPredicateRefs(controller.fields).map((row) => [row.pathLabel, row.predicate])),
    [controller],
  );
  const fieldRows = useMemo(
    () =>
      createPlan.clientFields.flatMap((field) => {
        const predicate = predicateRows.get(field.pathLabel);
        return predicate ? [{ pathLabel: field.pathLabel, predicate }] : [];
      }),
    [createPlan.clientFields, predicateRows],
  );

  async function handleCreate(): Promise<void> {
    const currentEntry = entityEntryRef.current;
    const input = controller.getInput();
    const validation = currentEntry.validateCreate(input as never);

    if (!validation.ok) {
      setSubmitError(
        describeSyncError(new GraphValidationError(validation)) ?? "Create validation failed.",
      );
      return;
    }

    setBusy(true);
    setSubmitError("");

    try {
      const createdId = currentEntry.create(input as never);
      await runtime.sync.flush();
      onCreated(createdId);
    } catch (error) {
      setSubmitError(describeSyncError(error) ?? "Create failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!createPlan.supported) {
    return (
      <InspectorShell
        description="This entity type cannot be created from the client because required fields are owned by server-command or authority-only flows."
        state="new"
        status={`New ${entityEntry.name}`}
        title={`New ${entityEntry.name}`}
        typeLabel={entityEntry.name}
      >
        <EmptyState>Required deferred fields block generic create for this type.</EmptyState>
        <DeferredFieldSection fields={createPlan.requiredBlockingFields} />
      </InspectorShell>
    );
  }

  return (
    <InspectorShell
      description={`Create ${entityEntry.name.toLowerCase()} records through the same field editors used for live entities.`}
      state="new"
      status={`New ${entityEntry.name}`}
      title={`New ${entityEntry.name}`}
      typeLabel={entityEntry.name}
    >
      <InspectorFieldSection
        emptyMessage="No client-writable fields."
        hideMissingStatus
        rows={fieldRows}
        title="Fields"
      />

      <DeferredFieldSection fields={createPlan.deferredFields} />

      <Section title="Create">
        <div className="space-y-4">
          <p className="text-muted-foreground text-sm">
            The draft validates through the real graph handle before commit. After creation, you
            continue editing in the normal entity inspector.
          </p>

          {submitError ? (
            <div
              className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-100"
              data-explorer-create-error="true"
            >
              {submitError}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              data-explorer-create-submit={entityEntry.id}
              disabled={busy}
              onClick={() => {
                void handleCreate();
              }}
              type="button"
            >
              {busy ? "Creating..." : `Create ${entityEntry.name}`}
            </Button>
            {onCancelCreate ? (
              <Button onClick={onCancelCreate} type="button" variant="outline">
                Cancel
              </Button>
            ) : null}
          </div>
        </div>
      </Section>
    </InspectorShell>
  );
}
