import {
  requireGraphBootstrapCoreSchema,
  type GraphBootstrapCoreSchema,
} from "@io/graph-bootstrap";
import { createGraphStore, type GraphStore } from "@io/graph-kernel";
import { edgeId, isEntityType, isEnumType, typeId } from "@io/graph-kernel";
import type {
  AnyTypeOutput,
  EdgeOutput,
  ScalarTypeOutput,
  TypeOutput,
  ValidationEvent,
  ValidationIssueInput,
  ValidationPhase,
} from "@io/graph-kernel";

import {
  clearFieldValue,
  cloneDate,
  cloneInput,
  collectChangedPredicateKeys,
  collectEnumValueIds,
  collectScalarCodecs,
  collectTypeIndex,
  decodeForRange,
  deleteNestedValue,
  encodeForRange,
  entryChangedPredicateKeys,
  flattenPredicates,
  formatValidationPath,
  hasNestedValue,
  getNestedValue,
  getPredicateCollectionKind,
  getStableCreateNodeId,
  getStableValidationNow,
  invalidResult,
  mergeChangedPredicateKeys,
  normalizeRequestedManyValues,
  planManyValues,
  readLogicalManyValues,
  readPredicateValue,
  removeManyValue,
  sameLogicalValue,
  setNestedValue,
  uniqueEncodedPredicateValues,
  validResult,
  type CreateInputOfType,
  type FlatPredicateEntry,
  type GraphDeleteValidationResult,
  type GraphMutationValidationResult,
  type GraphValidationIssue,
  type GraphValidationResult,
} from "./core";
import { commitCreateEntity, commitUpdateEntity } from "./entity-store";

type GraphClientCoreSchema = GraphBootstrapCoreSchema;

function normalizeValidationIssueInputs(
  issues: ValidationIssueInput | ValidationIssueInput[] | void,
): ValidationIssueInput[] {
  if (!issues) return [];
  return Array.isArray(issues) ? issues : [issues];
}

function createValidationIssue(
  source: "runtime" | "field" | "type",
  entry: FlatPredicateEntry,
  nodeId: string,
  issue: ValidationIssueInput,
): GraphValidationIssue {
  return {
    ...issue,
    source,
    path: Object.freeze([...entry.path, entry.field]),
    predicateKey: entry.predicate.key,
    nodeId,
  };
}

function appendValidationIssues(
  issues: GraphValidationIssue[],
  source: "runtime" | "field" | "type",
  entry: FlatPredicateEntry,
  nodeId: string,
  input: ValidationIssueInput | ValidationIssueInput[] | void,
): void {
  for (const issue of normalizeValidationIssueInputs(input)) {
    issues.push(createValidationIssue(source, entry, nodeId, issue));
  }
}

function appendRuntimeValidationIssue(
  issues: GraphValidationIssue[],
  entry: FlatPredicateEntry,
  nodeId: string,
  code: string,
  message: string,
): void {
  issues.push(createValidationIssue("runtime", entry, nodeId, { code, message }));
}

function asErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function enumValueIdsForRange(
  range: string,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
): Set<string> | undefined {
  const knownIds = enumValuesByRange.get(range);
  if (knownIds) return knownIds;

  const rangeType = typeByKey.get(range);
  if (!rangeType || !isEnumType(rangeType)) return undefined;

  return new Set(Object.values(rangeType.options).map((option) => option.id ?? option.key));
}

function validateScalarValue(
  issues: GraphValidationIssue[],
  entry: FlatPredicateEntry,
  nodeId: string,
  value: unknown,
  previous: unknown,
  phase: ValidationPhase,
  event: ValidationEvent,
  now: Date,
  changedPredicateKeys: ReadonlySet<string>,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
): void {
  const scalarType = scalarByKey.get(entry.predicate.range);
  if (!scalarType?.validate) return;
  appendValidationIssues(
    issues,
    "type",
    entry,
    nodeId,
    scalarType.validate({
      event,
      phase,
      nodeId,
      now,
      path: Object.freeze([...entry.path, entry.field]),
      predicateKey: entry.predicate.key,
      range: entry.predicate.range,
      value,
      previous,
      changedPredicateKeys,
    }),
  );
}

function validateEnumValue(
  issues: GraphValidationIssue[],
  entry: FlatPredicateEntry,
  nodeId: string,
  value: unknown,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
): boolean {
  const rangeType = typeByKey.get(entry.predicate.range);
  const enumValueIds = enumValueIdsForRange(entry.predicate.range, typeByKey, enumValuesByRange);
  if ((!rangeType || !isEnumType(rangeType)) && !enumValueIds) return true;

  const fieldPath = formatValidationPath([...entry.path, entry.field]);
  const enumName = rangeType?.values.name ?? rangeType?.values.key ?? entry.predicate.range;
  const expectsMany = entry.predicate.cardinality === "many";
  const values = expectsMany && Array.isArray(value) ? value : [value];

  if (values.some((item) => typeof item !== "string")) {
    appendValidationIssues(issues, "type", entry, nodeId, {
      code: "enum.valueType",
      message: expectsMany
        ? `Field "${fieldPath}" must use enum value id strings.`
        : `Field "${fieldPath}" must use an enum value id string.`,
    });
    return false;
  }

  if (!values.every((item) => enumValueIds?.has(item))) {
    appendValidationIssues(issues, "type", entry, nodeId, {
      code: "enum.member",
      message: expectsMany
        ? `Field "${fieldPath}" must reference declared "${enumName}" values.`
        : `Field "${fieldPath}" must reference a declared "${enumName}" value.`,
    });
    return false;
  }

  return true;
}

function appendInvalidValueIssue(
  issues: GraphValidationIssue[],
  entry: FlatPredicateEntry,
  nodeId: string,
  value: unknown,
  error: unknown,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
): void {
  if (!validateEnumValue(issues, entry, nodeId, value, typeByKey, enumValuesByRange)) return;

  const fieldPath = formatValidationPath([...entry.path, entry.field]);
  const issue = {
    code: "value.invalid",
    message: `Field "${fieldPath}" is invalid: ${asErrorMessage(error)}`,
  } satisfies ValidationIssueInput;

  appendValidationIssues(
    issues,
    scalarByKey.has(entry.predicate.range) ? "type" : "runtime",
    entry,
    nodeId,
    issue,
  );
}

function validateFieldValue(
  issues: GraphValidationIssue[],
  entry: FlatPredicateEntry,
  nodeId: string,
  value: unknown,
  previous: unknown,
  phase: ValidationPhase,
  event: ValidationEvent,
  now: Date,
  changedPredicateKeys: ReadonlySet<string>,
): void {
  if (!entry.predicate.validate) return;
  appendValidationIssues(
    issues,
    "field",
    entry,
    nodeId,
    entry.predicate.validate({
      event,
      phase,
      nodeId,
      now,
      path: Object.freeze([...entry.path, entry.field]),
      field: entry.field,
      predicateKey: entry.predicate.key,
      range: entry.predicate.range,
      cardinality: entry.predicate.cardinality,
      value,
      previous,
      changedPredicateKeys,
    }),
  );
}

function validateEntityReferenceValue(
  issues: GraphValidationIssue[],
  entry: FlatPredicateEntry,
  nodeId: string,
  value: unknown,
  store: GraphStore,
  typeByKey: Map<string, AnyTypeOutput>,
  coreSchema: GraphClientCoreSchema,
): void {
  const rangeType = typeByKey.get(entry.predicate.range);
  if (!rangeType || !isEntityType(rangeType)) return;

  const fieldPath = formatValidationPath([...entry.path, entry.field]);
  if (typeof value !== "string") {
    appendRuntimeValidationIssue(
      issues,
      entry,
      nodeId,
      "reference.invalid",
      `Field "${fieldPath}" must reference an entity id.`,
    );
    return;
  }

  const nodeTypePredicateId = edgeId(coreSchema.node.fields.type as EdgeOutput);
  const targetTypeIds = new Set(store.facts(value, nodeTypePredicateId).map((edge) => edge.o));

  if (targetTypeIds.size === 0) {
    if (entry.predicate.key === (coreSchema.predicate.fields.range as EdgeOutput).key) return;
    appendRuntimeValidationIssue(
      issues,
      entry,
      nodeId,
      "reference.missing",
      `Field "${fieldPath}" must reference an existing "${rangeType.values.name ?? rangeType.values.key}" entity.`,
    );
    return;
  }

  if (!targetTypeIds.has(typeId(rangeType))) {
    appendRuntimeValidationIssue(
      issues,
      entry,
      nodeId,
      "reference.type",
      `Field "${fieldPath}" must reference "${rangeType.values.name ?? rangeType.values.key}" entities.`,
    );
  }
}

function isManagedNodeTypeEntry(
  entry: FlatPredicateEntry,
  coreSchema: GraphClientCoreSchema,
): boolean {
  return entry.path.length === 0 && entry.predicate.key === coreSchema.node.fields.type.key;
}

function createNodeTypeValidationEntry(coreSchema: GraphClientCoreSchema): FlatPredicateEntry {
  return {
    path: [],
    field: "type",
    predicate: coreSchema.node.fields.type as EdgeOutput,
  };
}

function formatTypeDisplayName(typeDef: Pick<TypeOutput, "values">): string {
  return typeDef.values.name ?? typeDef.values.key;
}

function appendManagedFieldMutationIssue<T extends TypeOutput>(
  issues: GraphValidationIssue[],
  entry: FlatPredicateEntry,
  nodeId: string,
  typeDef: T,
): void {
  const fieldPath = formatValidationPath([...entry.path, entry.field]);
  appendRuntimeValidationIssue(
    issues,
    entry,
    nodeId,
    "field.managed",
    `Field "${fieldPath}" is managed by the typed "${formatTypeDisplayName(typeDef)}" handle.`,
  );
}

function validateNodeTypeState(
  store: GraphStore,
  nodeId: string,
  hasCurrentTypeFact: boolean,
  typeByKey: Map<string, AnyTypeOutput>,
  coreSchema: GraphClientCoreSchema,
): readonly GraphValidationIssue[] {
  const issues: GraphValidationIssue[] = [];
  const keyPredicateId = edgeId(coreSchema.predicate.fields.key as EdgeOutput);
  const nodeTypePredicateId = edgeId(coreSchema.node.fields.type as EdgeOutput);
  const typeEntry = createNodeTypeValidationEntry(coreSchema);

  if (!hasCurrentTypeFact) {
    const hasStructuredFacts = store.facts(nodeId).some((edge) => edge.p !== keyPredicateId);
    if (hasStructuredFacts) {
      appendRuntimeValidationIssue(
        issues,
        typeEntry,
        nodeId,
        "type.required",
        'Field "type" is required for nodes with stored data.',
      );
    }
    return issues;
  }

  for (const typeValue of uniqueEncodedPredicateValues(
    store.facts(nodeId, nodeTypePredicateId).map((edge) => ({ encoded: edge.o, decoded: edge.o })),
  )) {
    validateEntityReferenceValue(
      issues,
      typeEntry,
      nodeId,
      typeValue.decoded,
      store,
      typeByKey,
      coreSchema,
    );
  }

  return issues;
}

function validateTypedHandleTarget<T extends TypeOutput>(
  store: GraphStore,
  nodeId: string,
  typeDef: T,
  typeByKey: Map<string, AnyTypeOutput>,
  coreSchema: GraphClientCoreSchema,
): readonly GraphValidationIssue[] {
  const issues: GraphValidationIssue[] = [];
  const typeEntry = createNodeTypeValidationEntry(coreSchema);
  const nodeFacts = store.facts(nodeId);

  if (nodeFacts.length === 0) {
    appendRuntimeValidationIssue(
      issues,
      typeEntry,
      nodeId,
      "node.missing",
      `Typed "${formatTypeDisplayName(typeDef)}" handles require an existing node.`,
    );
    return issues;
  }

  const nodeTypePredicateId = edgeId(coreSchema.node.fields.type as EdgeOutput);
  const currentTypeIds = new Set(
    nodeFacts.filter((edge) => edge.p === nodeTypePredicateId).map((edge) => edge.o),
  );

  if (currentTypeIds.has(typeId(typeDef))) return issues;

  if (currentTypeIds.size === 0) {
    appendRuntimeValidationIssue(
      issues,
      typeEntry,
      nodeId,
      "type.required",
      `Node "${nodeId}" is missing the managed "${formatTypeDisplayName(typeDef)}" type.`,
    );
    return issues;
  }

  const currentTypes = [...currentTypeIds].map((currentTypeId) => {
    const currentType = typeByKey.get(currentTypeId);
    return currentType ? formatTypeDisplayName(currentType) : currentTypeId;
  });
  const quotedCurrentTypes =
    currentTypes.length === 1
      ? `"${currentTypes[0]}"`
      : currentTypes.map((currentType) => `"${currentType}"`).join(", ");

  appendRuntimeValidationIssue(
    issues,
    typeEntry,
    nodeId,
    "type.mismatch",
    `Typed "${formatTypeDisplayName(typeDef)}" handles cannot target nodes with current type ${quotedCurrentTypes}.`,
  );

  return issues;
}

function normalizeMutationValue(
  store: GraphStore,
  nodeId: string,
  entry: FlatPredicateEntry,
  nextValue: unknown,
  previous: unknown,
  phase: ValidationPhase,
  event: Extract<ValidationEvent, "create" | "update">,
  now: Date,
  changedPredicateKeys: ReadonlySet<string>,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
  issues: GraphValidationIssue[],
): unknown {
  const fieldPath = formatValidationPath([...entry.path, entry.field]);

  if (nextValue === clearFieldValue) {
    if (entry.predicate.cardinality === "one") {
      appendRuntimeValidationIssue(
        issues,
        entry,
        nodeId,
        "field.required",
        `Field "${fieldPath}" is required.`,
      );
      return undefined;
    }
    validateFieldValue(
      issues,
      entry,
      nodeId,
      undefined,
      previous,
      phase,
      event,
      now,
      changedPredicateKeys,
    );
    return clearFieldValue;
  }

  if (nextValue === undefined) {
    if (entry.predicate.cardinality === "one") {
      appendRuntimeValidationIssue(
        issues,
        entry,
        nodeId,
        "field.required",
        `Field "${fieldPath}" is required.`,
      );
      return undefined;
    }
    validateFieldValue(
      issues,
      entry,
      nodeId,
      undefined,
      previous,
      phase,
      event,
      now,
      changedPredicateKeys,
    );
    return event === "update" ? clearFieldValue : undefined;
  }

  if (entry.predicate.cardinality === "many") {
    if (!Array.isArray(nextValue)) {
      appendRuntimeValidationIssue(
        issues,
        entry,
        nodeId,
        "field.array",
        `Field "${fieldPath}" must be an array.`,
      );
      return nextValue;
    }

    try {
      const current =
        event === "update"
          ? readLogicalManyValues(store, nodeId, entry.predicate, scalarByKey, typeByKey)
          : [];
      const requested = normalizeRequestedManyValues(
        entry.predicate,
        nextValue,
        scalarByKey,
        typeByKey,
        enumValuesByRange,
      );
      const planned = planManyValues(current, requested, entry.predicate).map(
        (value) => value.decoded,
      );

      for (const value of planned) {
        validateScalarValue(
          issues,
          entry,
          nodeId,
          value,
          previous,
          phase,
          event,
          now,
          changedPredicateKeys,
          scalarByKey,
        );
      }
      validateFieldValue(
        issues,
        entry,
        nodeId,
        planned,
        previous,
        phase,
        event,
        now,
        changedPredicateKeys,
      );
      return planned;
    } catch (error) {
      appendInvalidValueIssue(
        issues,
        entry,
        nodeId,
        nextValue,
        error,
        scalarByKey,
        typeByKey,
        enumValuesByRange,
      );
      return nextValue;
    }
  }

  try {
    const encoded = encodeForRange(
      nextValue,
      entry.predicate.range,
      scalarByKey,
      typeByKey,
      enumValuesByRange,
    );
    const normalized = decodeForRange(encoded, entry.predicate.range, scalarByKey, typeByKey);
    validateScalarValue(
      issues,
      entry,
      nodeId,
      normalized,
      previous,
      phase,
      event,
      now,
      changedPredicateKeys,
      scalarByKey,
    );
    validateFieldValue(
      issues,
      entry,
      nodeId,
      normalized,
      previous,
      phase,
      event,
      now,
      changedPredicateKeys,
    );
    return normalized;
  } catch (error) {
    appendInvalidValueIssue(
      issues,
      entry,
      nodeId,
      nextValue,
      error,
      scalarByKey,
      typeByKey,
      enumValuesByRange,
    );
    return nextValue;
  }
}

function collectLogicalChangedPredicateKeys(
  input: Record<string, unknown>,
  entries: FlatPredicateEntry[],
  store: GraphStore,
  id: string,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
): Set<string> {
  const changed = new Set<string>();

  for (const entry of entries) {
    if (!hasNestedValue(input, entry.path, entry.field)) continue;

    const nextValue = getNestedValue(input, entry.path, entry.field);
    const previous = readPredicateValue(store, id, entry.predicate, scalarByKey, typeByKey);

    if (nextValue === clearFieldValue) {
      if (previous !== undefined) changed.add(entry.predicate.key);
      continue;
    }

    if (entry.predicate.cardinality === "many") {
      if (!Array.isArray(nextValue)) {
        changed.add(entry.predicate.key);
        continue;
      }

      try {
        const current = readLogicalManyValues(store, id, entry.predicate, scalarByKey, typeByKey);
        const requested = normalizeRequestedManyValues(
          entry.predicate,
          nextValue,
          scalarByKey,
          typeByKey,
          enumValuesByRange,
        );
        const planned = planManyValues(current, requested, entry.predicate).map(
          (value) => value.decoded,
        );

        if (!sameLogicalValue(previous, planned)) changed.add(entry.predicate.key);
      } catch {
        changed.add(entry.predicate.key);
      }
      continue;
    }

    if (!sameLogicalValue(previous, nextValue)) changed.add(entry.predicate.key);
  }

  return changed;
}

function applyLifecycleHooks(
  event: "create" | "update",
  input: Record<string, unknown>,
  entries: FlatPredicateEntry[],
  store: GraphStore,
  nodeId: string,
  now: Date,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
): Set<string> {
  const changedPredicateKeys =
    event === "update"
      ? collectLogicalChangedPredicateKeys(
          input,
          entries,
          store,
          nodeId,
          scalarByKey,
          typeByKey,
          enumValuesByRange,
        )
      : collectChangedPredicateKeys(input, entries);
  for (const entry of entries) {
    const hook = event === "create" ? entry.predicate.onCreate : entry.predicate.onUpdate;
    if (!hook) continue;
    const incomingValue = getNestedValue(input, entry.path, entry.field);
    const incoming = incomingValue === clearFieldValue ? undefined : incomingValue;
    const previous =
      event === "update"
        ? readPredicateValue(store, nodeId, entry.predicate, scalarByKey, typeByKey)
        : undefined;
    const next = hook({
      event,
      nodeId,
      now,
      incoming,
      previous,
      changedPredicateKeys,
    });
    if (next === undefined) continue;
    setNestedValue(input, entry.path, entry.field, next);
    changedPredicateKeys.add(entry.predicate.key);
  }
  return changedPredicateKeys;
}

function validateSimulatedLocalMutation(
  validationStore: GraphStore,
  namespace: Record<string, AnyTypeOutput>,
  now: Date,
  prepared: GraphMutationValidationResult,
): GraphMutationValidationResult {
  if (!prepared.ok) return prepared;

  const validation = validateGraphStore(validationStore, namespace, {
    now,
    phase: "local",
    event: prepared.event,
  });
  if (validation.ok) return prepared;

  return invalidResult(
    "local",
    prepared.event,
    prepared.value,
    mergeChangedPredicateKeys(new Set(prepared.changedPredicateKeys), validation.issues),
    validation.issues,
  );
}

function prepareMutationInput<T extends TypeOutput>(
  store: GraphStore,
  typeDef: T,
  inputValue: Record<string, unknown>,
  event: Extract<ValidationEvent, "create" | "update">,
  nodeId: string,
  now: Date,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
  coreSchema: GraphClientCoreSchema,
): GraphValidationResult<Record<string, unknown>> {
  const entries = flattenPredicates(typeDef.fields);
  const input = cloneInput(inputValue);
  const changedPredicateKeys = applyLifecycleHooks(
    event,
    input,
    entries,
    store,
    nodeId,
    now,
    scalarByKey,
    typeByKey,
    enumValuesByRange,
  );
  const issues: GraphValidationIssue[] = [];

  for (const entry of entries) {
    const hasExplicitValue = hasNestedValue(input, entry.path, entry.field);
    if (event === "update" && !hasExplicitValue) continue;
    const nextValue = getNestedValue(input, entry.path, entry.field);

    if (event === "create" && !hasExplicitValue && isManagedNodeTypeEntry(entry, coreSchema)) {
      continue;
    }

    const previous =
      event === "update"
        ? readPredicateValue(store, nodeId, entry.predicate, scalarByKey, typeByKey)
        : undefined;

    if (isManagedNodeTypeEntry(entry, coreSchema)) {
      appendManagedFieldMutationIssue(issues, entry, nodeId, typeDef);
      deleteNestedValue(input, entry.path, entry.field);
      continue;
    }

    const normalized = normalizeMutationValue(
      store,
      nodeId,
      entry,
      nextValue,
      previous,
      "local",
      event,
      now,
      changedPredicateKeys,
      scalarByKey,
      typeByKey,
      enumValuesByRange,
      issues,
    );

    if (normalized === undefined && nextValue === undefined) continue;
    setNestedValue(input, entry.path, entry.field, normalized);
  }

  return issues.length > 0
    ? invalidResult(
        "local",
        event,
        input,
        mergeChangedPredicateKeys(changedPredicateKeys, issues),
        issues,
      )
    : validResult("local", event, input, changedPredicateKeys);
}

function cloneStoreForValidation(store: GraphStore): GraphStore {
  return createGraphStore(store.snapshot());
}

function collectionItemPassesValidation(
  store: GraphStore,
  nodeId: string,
  predicate: EdgeOutput,
  value: unknown,
  now: Date,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
  coreSchema: GraphClientCoreSchema,
): boolean {
  try {
    const encoded = encodeForRange(
      value,
      predicate.range,
      scalarByKey,
      typeByKey,
      enumValuesByRange,
    );
    const decoded = decodeForRange(encoded, predicate.range, scalarByKey, typeByKey);
    const issues: GraphValidationIssue[] = [];
    const entry: FlatPredicateEntry = {
      path: [],
      field: predicate.key,
      predicate,
    };
    const changedPredicateKeys = new Set<string>([predicate.key]);

    validateScalarValue(
      issues,
      entry,
      nodeId,
      decoded,
      undefined,
      "local",
      "update",
      now,
      changedPredicateKeys,
      scalarByKey,
    );
    validateEntityReferenceValue(issues, entry, nodeId, decoded, store, typeByKey, coreSchema);

    return issues.length === 0;
  } catch {
    return false;
  }
}

export function planManyRemoveMutation(
  store: GraphStore,
  subjectId: string,
  predicate: EdgeOutput,
  currentValues: unknown[],
  value: unknown,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
  coreSchema: GraphClientCoreSchema,
): {
  nextValues: unknown[];
  validationValues: unknown[];
} {
  const now = getStableValidationNow(store);
  const isValidTarget = collectionItemPassesValidation(
    store,
    subjectId,
    predicate,
    value,
    now,
    scalarByKey,
    typeByKey,
    enumValuesByRange,
    coreSchema,
  );

  if (!isValidTarget) {
    return {
      nextValues: currentValues,
      validationValues: [...currentValues, value],
    };
  }

  const nextValues = removeManyValue(
    currentValues,
    predicate,
    value,
    scalarByKey,
    typeByKey,
    enumValuesByRange,
  );

  return {
    nextValues,
    validationValues: nextValues,
  };
}

export function validateCreateEntity<T extends TypeOutput>(
  store: GraphStore,
  typeDef: T,
  data: CreateInputOfType<T, Record<string, AnyTypeOutput>>,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
  namespace: Record<string, AnyTypeOutput>,
  options: {
    nodeId?: string;
  } = {},
): GraphMutationValidationResult {
  const coreSchema = requireGraphBootstrapCoreSchema(namespace);
  const now = getStableValidationNow(store);
  const validationNodeId = options.nodeId ?? getStableCreateNodeId(store);
  const validationStore = cloneStoreForValidation(store);
  const prepared = prepareMutationInput(
    validationStore,
    typeDef,
    data as Record<string, unknown>,
    "create",
    validationNodeId,
    now,
    scalarByKey,
    typeByKey,
    enumValuesByRange,
    coreSchema,
  );
  if (!prepared.ok) return prepared;

  commitCreateEntity(
    validationStore,
    validationNodeId,
    typeDef,
    prepared.value,
    coreSchema.node.fields.type,
    scalarByKey,
    typeByKey,
    enumValuesByRange,
  );

  return validateSimulatedLocalMutation(validationStore, namespace, now, prepared);
}

function validateEntityState<T extends TypeOutput>(
  store: GraphStore,
  id: string,
  typeDef: T,
  now: Date,
  phase: ValidationPhase,
  event: ValidationEvent,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
  coreSchema: GraphClientCoreSchema,
): readonly GraphValidationIssue[] {
  const issues: GraphValidationIssue[] = [];
  const entries = flattenPredicates(typeDef.fields);
  const changedPredicateKeys =
    phase === "authoritative" ? new Set(entries.map((entry) => entry.predicate.key)) : undefined;

  for (const entry of entries) {
    if (isManagedNodeTypeEntry(entry, coreSchema)) continue;
    const entryValidationKeys =
      changedPredicateKeys ?? entryChangedPredicateKeys(entry.predicate.key);
    const facts = store.facts(id, edgeId(entry.predicate));
    const fieldPath = formatValidationPath([...entry.path, entry.field]);
    const logicalFacts = uniqueEncodedPredicateValues(
      facts.map((fact) => ({ encoded: fact.o, decoded: fact.o })),
    );

    if (entry.predicate.cardinality === "one" && facts.length === 0) {
      appendRuntimeValidationIssue(
        issues,
        entry,
        id,
        "field.required",
        `Field "${fieldPath}" is required.`,
      );
      continue;
    }

    if (
      (entry.predicate.cardinality === "one" || entry.predicate.cardinality === "one?") &&
      facts.length > 1
    ) {
      appendRuntimeValidationIssue(
        issues,
        entry,
        id,
        "field.cardinality",
        `Field "${fieldPath}" exceeds ${entry.predicate.cardinality} cardinality.`,
      );
    }

    const decodedValues: Array<{ encoded: string; decoded: unknown }> = [];
    let hasDecodeError = false;
    for (const fact of facts) {
      try {
        const decoded = decodeForRange(fact.o, entry.predicate.range, scalarByKey, typeByKey);
        if (!validateEnumValue(issues, entry, id, decoded, typeByKey, enumValuesByRange)) {
          hasDecodeError = true;
          continue;
        }
        decodedValues.push({ encoded: fact.o, decoded });
        validateScalarValue(
          issues,
          entry,
          id,
          decoded,
          undefined,
          phase,
          event,
          now,
          entryValidationKeys,
          scalarByKey,
        );
        validateEntityReferenceValue(issues, entry, id, decoded, store, typeByKey, coreSchema);
      } catch (error) {
        hasDecodeError = true;
        appendInvalidValueIssue(
          issues,
          entry,
          id,
          fact.o,
          error,
          scalarByKey,
          typeByKey,
          enumValuesByRange,
        );
      }
    }

    if (hasDecodeError) continue;

    const logicalDecodedValues = uniqueEncodedPredicateValues(decodedValues);

    if (entry.predicate.cardinality === "many") {
      const logicalValues =
        getPredicateCollectionKind(entry.predicate) === "unordered"
          ? logicalDecodedValues.map((value) => value.decoded)
          : decodedValues.map((value) => value.decoded);
      validateFieldValue(
        issues,
        entry,
        id,
        logicalValues,
        undefined,
        phase,
        event,
        now,
        entryValidationKeys,
      );
      continue;
    }

    if (logicalFacts.length === 0) {
      validateFieldValue(
        issues,
        entry,
        id,
        undefined,
        undefined,
        phase,
        event,
        now,
        entryValidationKeys,
      );
      continue;
    }

    if (logicalDecodedValues.length === 1) {
      validateFieldValue(
        issues,
        entry,
        id,
        logicalDecodedValues[0]?.decoded,
        undefined,
        phase,
        event,
        now,
        entryValidationKeys,
      );
    }
  }

  return issues;
}

export function validateUpdateEntity<T extends TypeOutput>(
  store: GraphStore,
  id: string,
  typeDef: T,
  patch: Record<string, unknown>,
  scalarByKey: Map<string, ScalarTypeOutput<any>>,
  typeByKey: Map<string, AnyTypeOutput>,
  enumValuesByRange: Map<string, Set<string>>,
  namespace: Record<string, AnyTypeOutput>,
): GraphMutationValidationResult {
  const coreSchema = requireGraphBootstrapCoreSchema(namespace);
  const requestedChangedPredicateKeys = collectChangedPredicateKeys(
    patch,
    flattenPredicates(typeDef.fields),
  );
  const handleIssues = validateTypedHandleTarget(store, id, typeDef, typeByKey, coreSchema);
  if (handleIssues.length > 0) {
    return invalidResult(
      "local",
      "update",
      cloneInput(patch),
      mergeChangedPredicateKeys(requestedChangedPredicateKeys, handleIssues),
      handleIssues,
    );
  }

  const now = getStableValidationNow(store);
  const validationStore = cloneStoreForValidation(store);
  const prepared = prepareMutationInput(
    validationStore,
    typeDef,
    patch,
    "update",
    id,
    now,
    scalarByKey,
    typeByKey,
    enumValuesByRange,
    coreSchema,
  );
  if (!prepared.ok) return prepared;

  commitUpdateEntity(
    validationStore,
    id,
    typeDef,
    prepared.value,
    scalarByKey,
    typeByKey,
    enumValuesByRange,
  );

  return validateSimulatedLocalMutation(validationStore, namespace, now, prepared);
}

export function prepareDeleteEntity<
  T extends TypeOutput,
  Defs extends Record<string, AnyTypeOutput>,
>(
  store: GraphStore,
  id: string,
  typeDef: T,
  typeByKey: Map<string, AnyTypeOutput>,
  namespace: Defs,
): GraphDeleteValidationResult {
  const coreSchema = requireGraphBootstrapCoreSchema(namespace);
  const handleIssues = validateTypedHandleTarget(store, id, typeDef, typeByKey, coreSchema);
  if (handleIssues.length > 0) {
    return invalidResult(
      "local",
      "delete",
      id,
      new Set(handleIssues.map((issue) => issue.predicateKey)),
      handleIssues,
    );
  }

  const now = getStableValidationNow(store);
  const validationStore = cloneStoreForValidation(store);
  for (const edge of validationStore.facts(id)) validationStore.retract(edge.id);

  const validation = validateGraphStore(validationStore, namespace, {
    now,
    phase: "local",
    event: "delete",
  });
  return validation.ok
    ? validResult("local", "delete", id, new Set<string>())
    : invalidResult(
        "local",
        "delete",
        id,
        new Set(validation.issues.map((issue) => issue.predicateKey)),
        validation.issues,
      );
}

export function validateGraphStore<const T extends Record<string, AnyTypeOutput>>(
  store: GraphStore,
  namespace: T,
  options: {
    now?: Date;
    phase?: ValidationPhase;
    event?: ValidationEvent;
  } = {},
): GraphValidationResult<void> {
  const coreSchema = requireGraphBootstrapCoreSchema(namespace);
  const now = options.now ? cloneDate(options.now) : new Date();
  const phase = options.phase ?? "authoritative";
  const event = options.event ?? "reconcile";
  const scalarByKey = collectScalarCodecs(namespace);
  const typeByKey = collectTypeIndex(namespace);
  const enumValuesByRange = collectEnumValueIds(namespace, typeByKey);
  const nodeTypePredicate = coreSchema.node.fields.type as EdgeOutput;
  const nodeTypePredicateId = edgeId(nodeTypePredicate);
  const combined = Object.values(namespace);
  const issues: GraphValidationIssue[] = [];
  const subjects = new Map<string, boolean>();

  for (const edge of store.facts()) {
    const existing = subjects.get(edge.s) ?? false;
    subjects.set(edge.s, existing || edge.p === nodeTypePredicateId);
  }

  for (const [nodeId, hasCurrentTypeFact] of subjects) {
    issues.push(...validateNodeTypeState(store, nodeId, hasCurrentTypeFact, typeByKey, coreSchema));
  }

  for (const typeDef of combined) {
    if (!isEntityType(typeDef)) continue;
    const seenIds = new Set<string>();
    for (const edge of store.facts(undefined, nodeTypePredicateId, typeId(typeDef))) {
      if (seenIds.has(edge.s)) continue;
      seenIds.add(edge.s);
      issues.push(
        ...validateEntityState(
          store,
          edge.s,
          typeDef,
          now,
          phase,
          event,
          scalarByKey,
          typeByKey,
          enumValuesByRange,
          coreSchema,
        ),
      );
    }
  }

  return issues.length > 0
    ? invalidResult(
        phase,
        event,
        undefined,
        new Set(issues.map((issue) => issue.predicateKey)),
        issues,
      )
    : validResult(phase, event, undefined, new Set<string>());
}
