import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  app,
  core,
  createExampleRuntime,
  createTypeClient,
  edgeId,
  formatValidationPath,
  GraphValidationError,
  isEntityType,
  isFieldGroupRef,
  type AnyTypeOutput,
  type Cardinality,
  type EntityRef,
  type GraphMutationValidationResult,
  type NamespaceClient,
  type PredicateRef,
  type Store,
  typeId,
} from "#graph";

import { PredicateFieldEditor, formatPredicateValue, usePredicateField } from "./bindings.js";
import { performValidatedMutation } from "./mutation-validation.js";
import { defaultWebFieldResolver } from "./resolver.js";

const explorerNamespace = { ...core, ...app };

type ExplorerNamespace = typeof explorerNamespace;
type ExplorerClient = NamespaceClient<ExplorerNamespace>;
type ExplorerRuntime = ReturnType<typeof createExampleRuntime>;
type ExplorerSection = "entities" | "types" | "predicates";
type AnyEntityRef = EntityRef<any, any>;
type AnyPredicateRef = PredicateRef<any, any>;
type MutableOptionalPredicateRef = AnyPredicateRef & {
  clear(): void;
  set(value: unknown): void;
  validateClear(): GraphMutationValidationResult;
  validateSet(value: unknown): GraphMutationValidationResult;
};
type MutationCallbacks = {
  onMutationError?: (error: unknown) => void;
  onMutationSuccess?: () => void;
};

type DefinitionFieldEntry = {
  cardinality: Cardinality;
  key: string;
  pathLabel: string;
  predicateId: string;
  rangeId: string;
};

type TypeCatalogEntry = {
  dataCount: number;
  fieldDefs: DefinitionFieldEntry[];
  id: string;
  key: string;
  kind: AnyTypeOutput["kind"];
  name: string;
  optionDefs: Array<{
    description?: string;
    id: string;
    key: string;
    name?: string;
  }>;
  typeDef: AnyTypeOutput;
};

type EntityCatalogEntry = {
  count: number;
  getRef: (id: string) => AnyEntityRef;
  id: string;
  ids: string[];
  key: string;
  name: string;
  typeDef: Extract<AnyTypeOutput, { kind: "entity" }>;
};

type PredicateOwner = {
  pathLabel: string;
  typeId: string;
  typeKey: string;
  typeName: string;
};

type PredicateCatalogEntry = {
  compiledCardinality: Cardinality;
  compiledRangeId: string;
  getRef: () => AnyEntityRef;
  id: string;
  key: string;
  owners: PredicateOwner[];
};

type PredicateFieldEntry = {
  pathLabel: string;
  predicate: AnyPredicateRef;
};

type FieldStatus = {
  label: string;
  tone: "empty" | "missing" | "present";
};
type FieldValidationMessage = {
  id: string;
  message: string;
  pathLabel: string;
  source: string;
};

const keyPredicateId = edgeId(core.predicate.fields.key);
const typePredicateId = edgeId(core.node.fields.type);

const compiledCardinalityIdByLiteral: Record<Cardinality, string> = {
  one: core.cardinality.values.one.id,
  "one?": core.cardinality.values.oneOptional.id,
  many: core.cardinality.values.many.id,
};

const cardinalityLabelById = new Map<string, string>([
  [core.cardinality.values.one.id, "one"],
  [core.cardinality.values.oneOptional.id, "one?"],
  [core.cardinality.values.many.id, "many"],
]);

function getFirstObject(store: Store, subjectId: string, predicateId: string): string | undefined {
  return store.facts(subjectId, predicateId)[0]?.o;
}

function getNodeName(store: Store, id: string): string {
  return getFirstObject(store, id, edgeId(core.node.fields.name)) ?? id;
}

function getEntityLabel(entity: { id: string; get(): Record<string, unknown> }): string {
  const snapshot = entity.get();
  const name = snapshot.name;
  if (typeof name === "string" && name.length > 0) return name;
  const label = snapshot.label;
  if (typeof label === "string" && label.length > 0) return label;
  return entity.id;
}

function formatCardinality(cardinality: Cardinality): string {
  if (cardinality === "one") return "required";
  if (cardinality === "one?") return "optional";
  return "many";
}

function formatGraphCardinality(valueId: string | undefined): string {
  if (!valueId) return "unset";
  return cardinalityLabelById.get(valueId) ?? valueId;
}

function getFieldLabel(predicate: AnyPredicateRef): string {
  const field = predicate.field as { key: string; meta?: { label?: string } };
  if (field.meta?.label) return field.meta.label;
  const segments = field.key.split(":");
  return segments.at(-1) ?? field.key;
}

function getFieldRangeLabel(predicate: AnyPredicateRef, typeKeyById: ReadonlyMap<string, string>): string {
  const rangeKey = predicate.rangeType?.values.key;
  return rangeKey ?? typeKeyById.get(predicate.field.range) ?? predicate.field.range;
}

function matchesQuery(query: string, ...parts: Array<string | undefined>): boolean {
  if (!query) return true;
  return parts.some((part) => part?.toLowerCase().includes(query));
}

function isDefinitionField(value: unknown): value is { cardinality: Cardinality; key: string; range: string } {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<{ cardinality: Cardinality; key: string; range: string }>;
  return (
    typeof candidate.key === "string" &&
    typeof candidate.range === "string" &&
    typeof candidate.cardinality === "string"
  );
}

function flattenDefinitionFields(
  tree: Record<string, unknown>,
  path: string[] = [],
  out: DefinitionFieldEntry[] = [],
): DefinitionFieldEntry[] {
  for (const [fieldName, value] of Object.entries(tree)) {
    if (isDefinitionField(value)) {
      out.push({
        cardinality: value.cardinality,
        key: value.key,
        pathLabel: [...path, fieldName].join("."),
        predicateId: edgeId(value),
        rangeId: value.range,
      });
      continue;
    }

    if (!value || typeof value !== "object") continue;
    flattenDefinitionFields(value as Record<string, unknown>, [...path, fieldName], out);
  }

  return out;
}

function buildTypeCatalog(store: Store): TypeCatalogEntry[] {
  const kindOrder: Record<AnyTypeOutput["kind"], number> = {
    entity: 0,
    enum: 1,
    scalar: 2,
  };

  return Object.values(explorerNamespace)
    .map((typeDef) => ({
      dataCount:
        typeDef.kind === "entity"
          ? store.facts(undefined, typePredicateId, typeId(typeDef)).length
          : 0,
      fieldDefs: typeDef.kind === "entity" ? flattenDefinitionFields(typeDef.fields) : [],
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
      const byNamespace = Number(left.key.startsWith("core:")) - Number(right.key.startsWith("core:"));
      if (byNamespace !== 0) return byNamespace;
      const byKind = kindOrder[left.kind] - kindOrder[right.kind];
      if (byKind !== 0) return byKind;
      return left.key.localeCompare(right.key);
    });
}

function buildEntityCatalog(client: ExplorerClient, store: Store): EntityCatalogEntry[] {
  const handles = client as unknown as Record<string, { ref?: (id: string) => AnyEntityRef }>;
  const appEntities = Object.entries(app).filter(([, typeDef]) => isEntityType(typeDef)) as Array<
    [string, Extract<AnyTypeOutput, { kind: "entity" }>]
  >;

  return appEntities.map(([alias, typeDef]) => {
    const handle = handles[alias]?.ref;
    if (!handle) {
      throw new Error(`Missing explorer handle for entity type "${alias}"`);
    }

    const ids = store
      .facts(undefined, typePredicateId, typeId(typeDef))
      .map((edge) => edge.s);

    return {
      count: ids.length,
      getRef(id: string) {
        return handle(id);
      },
      id: typeId(typeDef),
      ids,
      key: typeDef.values.key,
      name: typeDef.values.name ?? typeDef.values.key,
      typeDef,
    };
  });
}

function buildPredicateCatalog(
  client: ExplorerClient,
  typeEntries: readonly TypeCatalogEntry[],
): PredicateCatalogEntry[] {
  const predicateHandle = (client as unknown as Record<string, { ref?: (id: string) => AnyEntityRef }>).predicate?.ref;
  if (!predicateHandle) {
    throw new Error(`Missing explorer handle for "predicate"`);
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

function flattenPredicateRefs(
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

function asNamedFields(fields: unknown): {
  label: AnyPredicateRef;
  name: AnyPredicateRef;
} {
  return fields as {
    label: AnyPredicateRef;
    name: AnyPredicateRef;
  };
}

function asNodeMetadataFields(fields: unknown): {
  description: AnyPredicateRef;
  label: AnyPredicateRef;
  name: AnyPredicateRef;
} {
  return fields as {
    description: AnyPredicateRef;
    label: AnyPredicateRef;
    name: AnyPredicateRef;
  };
}

function asPredicateMetadataFields(fields: unknown): {
  cardinality: AnyPredicateRef;
  description: AnyPredicateRef;
  key: AnyPredicateRef;
  name: AnyPredicateRef;
  range: MutableOptionalPredicateRef;
} {
  return fields as {
    cardinality: AnyPredicateRef;
    description: AnyPredicateRef;
    key: AnyPredicateRef;
    name: AnyPredicateRef;
    range: MutableOptionalPredicateRef;
  };
}

function useStoreSlotValue(store: Store, subjectId: string, predicateId: string): string | undefined {
  const hasSnapshotRef = useRef(false);
  const snapshotRef = useRef<string | undefined>(undefined);

  function readSnapshot(): string | undefined {
    const next = getFirstObject(store, subjectId, predicateId);
    if (hasSnapshotRef.current && snapshotRef.current === next) return snapshotRef.current;
    snapshotRef.current = next;
    hasSnapshotRef.current = true;
    return next;
  }

  return useSyncExternalStore(
    (listener) => store.subscribePredicateSlot(subjectId, predicateId, listener),
    readSnapshot,
    readSnapshot,
  );
}

function describePredicateValue(predicate: AnyPredicateRef, value: unknown): FieldStatus {
  if (predicate.field.cardinality === "many") {
    const count = Array.isArray(value) ? value.length : 0;
    return count > 0
      ? { label: `${count} items`, tone: "present" }
      : { label: "empty", tone: "empty" };
  }

  if (value === undefined) {
    return predicate.field.cardinality === "one"
      ? { label: "missing", tone: "missing" }
      : { label: "unset", tone: "empty" };
  }

  if (typeof value === "string" && value.length === 0) {
    return { label: "empty string", tone: "empty" };
  }

  return { label: "set", tone: "present" };
}

function statusBadgeClass(status: FieldStatus["tone"]): string {
  if (status === "missing") return "border-rose-500/30 bg-rose-500/10 text-rose-200";
  if (status === "empty") return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
}

function collectFieldValidationMessages(
  error: unknown,
  predicate: AnyPredicateRef,
): FieldValidationMessage[] {
  if (!(error instanceof GraphValidationError)) return [];
  const relevant = error.result.issues.filter(
    (issue) => issue.nodeId === predicate.subjectId && issue.predicateKey === predicate.field.key,
  );
  const issues = relevant.length > 0 ? relevant : error.result.issues;

  return issues.map((issue, index) => ({
    id: `${issue.nodeId}:${issue.predicateKey}:${issue.code}:${index}`,
    message: issue.message,
    pathLabel: formatValidationPath(issue.path),
    source: issue.source,
  }));
}

function checkToneClass(state: "aligned" | "drifted" | "missing"): string {
  if (state === "aligned") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  if (state === "drifted") return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  return "border-rose-500/30 bg-rose-500/10 text-rose-200";
}

function Section({
  children,
  right,
  title,
}: {
  children: ReactNode;
  right?: ReactNode;
  title: string;
}) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-lg shadow-black/20">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-wide text-slate-100">{title}</h2>
        {right ?? null}
      </div>
      {children}
    </section>
  );
}

function Badge({
  children,
  className = "",
  data,
}: {
  children: ReactNode;
  className?: string;
  data?: Record<string, string>;
}) {
  return (
    <span
      {...data}
      className={`rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.16em] ${className}`.trim()}
    >
      {children}
    </span>
  );
}

function ListButton({
  active,
  children,
  onClick,
  props,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
  props?: Record<string, string>;
}) {
  return (
    <button
      {...props}
      className={
        "w-full rounded-2xl border px-3 py-3 text-left transition " +
        (active
          ? "border-cyan-400/40 bg-cyan-500/15 text-white"
          : "border-slate-800 bg-slate-950/70 text-slate-200 hover:border-slate-700 hover:bg-slate-900")
      }
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-slate-800 p-4 text-sm text-slate-400">{children}</p>;
}

function PredicateValuePreview({
  predicate,
  typeKeyById,
}: {
  predicate: AnyPredicateRef;
  typeKeyById: ReadonlyMap<string, string>;
}) {
  const { value } = usePredicateField(predicate);

  if (predicate.rangeType && isEntityType(predicate.rangeType)) {
    const ids = Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : typeof value === "string"
        ? [value]
        : [];

    if (ids.length === 0) {
      return <span className="text-sm text-slate-500">Unset</span>;
    }

    return (
      <div className="flex flex-wrap gap-1.5">
        {ids.map((id) => {
          const entity = predicate.resolveEntity(id);
          const label = entity ? getEntityLabel(entity) : typeKeyById.get(id) ?? id;
          return (
            <Badge
              className="border-slate-700 bg-slate-950 text-slate-200 normal-case tracking-normal"
              key={id}
            >
              {label}
            </Badge>
          );
        })}
      </div>
    );
  }

  if (value === undefined) {
    return <span className="text-sm text-slate-500">Unset</span>;
  }

  if (Array.isArray(value) && value.length === 0) {
    return <span className="text-sm text-slate-500">Empty</span>;
  }

  const formatted = formatPredicateValue(predicate, value as never);
  if (formatted.length > 0) {
    return <span className="text-sm text-slate-100">{formatted}</span>;
  }

  if (value === "") {
    return <span className="text-sm text-slate-500">Empty string</span>;
  }

  return <span className="text-sm text-slate-100">{String(value)}</span>;
}

function PredicateRow({
  customEditor,
  pathLabel,
  predicate,
  title,
  typeKeyById,
}: {
  customEditor?: (callbacks: MutationCallbacks) => ReactNode;
  pathLabel: string;
  predicate: AnyPredicateRef;
  title?: string;
  typeKeyById: ReadonlyMap<string, string>;
}) {
  const binding = usePredicateField(predicate);
  const status = describePredicateValue(predicate, binding.value);
  const editorResolution = defaultWebFieldResolver.resolveEditor(predicate);
  const isEditable = customEditor !== undefined || editorResolution.status === "resolved";
  const [validationMessages, setValidationMessages] = useState<FieldValidationMessage[]>([]);

  useEffect(() => {
    setValidationMessages([]);
  }, [binding.value]);

  function handleMutationError(error: unknown): void {
    setValidationMessages(collectFieldValidationMessages(error, predicate));
  }

  function handleMutationSuccess(): void {
    setValidationMessages([]);
  }

  return (
    <div
      className="rounded-2xl border border-slate-800 bg-slate-950/80 p-3"
      data-explorer-field-path={pathLabel}
      data-explorer-field-validation-state={validationMessages.length > 0 ? "invalid" : "valid"}
      data-explorer-field-state={status.tone}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="text-sm font-medium text-slate-100">{title ?? getFieldLabel(predicate)}</div>
          <div className="font-mono text-[11px] text-slate-500">{pathLabel}</div>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          <Badge className="border-slate-700 bg-slate-900 text-slate-300">{formatCardinality(predicate.field.cardinality)}</Badge>
          <Badge className="border-slate-700 bg-slate-900 text-slate-300">{getFieldRangeLabel(predicate, typeKeyById)}</Badge>
          <Badge
            className={statusBadgeClass(status.tone)}
            data={{ "data-explorer-field-status": status.tone }}
          >
            {status.label}
          </Badge>
          <Badge
            className={
              isEditable
                ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-200"
                : "border-slate-700 bg-slate-900 text-slate-400"
            }
          >
            {isEditable ? "editable" : "read only"}
          </Badge>
        </div>
      </div>

      <div className="mt-3">
        {customEditor?.({
          onMutationError: handleMutationError,
          onMutationSuccess: handleMutationSuccess,
        }) ?? (
          isEditable ? (
            <PredicateFieldEditor
              onMutationError={handleMutationError}
              onMutationSuccess={handleMutationSuccess}
              predicate={predicate}
            />
          ) : (
            <PredicateValuePreview predicate={predicate} typeKeyById={typeKeyById} />
          )
        )}
      </div>

      {validationMessages.length > 0 ? (
        <div
          className="mt-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-100"
          data-explorer-field-validation={pathLabel}
        >
          <div className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-rose-200">
            Validation
          </div>
          <div className="space-y-2">
            {validationMessages.map((issue) => (
              <div
                className="flex flex-wrap items-start gap-2"
                data-explorer-field-validation-message={issue.pathLabel || pathLabel}
                key={issue.id}
              >
                <Badge className="border-rose-400/30 bg-rose-400/10 text-rose-100">
                  {issue.source}
                </Badge>
                <span>{issue.message}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-500">
        <code>{predicate.field.key}</code>
        <code>{predicate.predicateId}</code>
      </div>
    </div>
  );
}

function DefinitionCheck({
  check,
  compiled,
  current,
  label,
  state,
}: {
  check: string;
  compiled: string;
  current: string;
  label: string;
  state: "aligned" | "drifted" | "missing";
}) {
  return (
    <div
      className="rounded-2xl border border-slate-800 bg-slate-950/80 p-3"
      data-explorer-check={check}
      data-explorer-check-state={state}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-slate-100">{label}</span>
        <Badge className={checkToneClass(state)}>{state}</Badge>
      </div>
      <div className="mt-2 grid gap-1 text-[12px] text-slate-400">
        <div>
          graph: <code>{current}</code>
        </div>
        <div>
          compiled: <code>{compiled}</code>
        </div>
      </div>
    </div>
  );
}

function SectionNav({
  count,
  label,
  mode,
  onSelect,
  selected,
}: {
  count: number;
  label: string;
  mode: ExplorerSection;
  onSelect: (mode: ExplorerSection) => void;
  selected: ExplorerSection;
}) {
  const isActive = mode === selected;
  return (
    <button
      className={
        "flex w-full items-center justify-between rounded-2xl border px-3 py-2.5 text-sm transition " +
        (isActive
          ? "border-cyan-400/40 bg-cyan-500/15 text-white"
          : "border-slate-800 bg-slate-950/70 text-slate-300 hover:border-slate-700 hover:bg-slate-900")
      }
      data-explorer-nav={mode}
      onClick={() => onSelect(mode)}
      type="button"
    >
      <span>{label}</span>
      <Badge
        className={
          isActive
            ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-100"
            : "border-slate-700 bg-slate-900 text-slate-400"
        }
      >
        {count}
      </Badge>
    </button>
  );
}

function EntityListItem({
  active,
  entity,
  onSelect,
}: {
  active: boolean;
  entity: AnyEntityRef;
  onSelect: () => void;
}) {
  const fields = asNamedFields(entity.fields);
  const name = usePredicateField(fields.name).value;
  const label = usePredicateField(fields.label).value;

  return (
    <ListButton
      active={active}
      onClick={onSelect}
      props={{ "data-explorer-item-entity": entity.id }}
    >
      <div className="space-y-1">
        <div className="text-sm font-medium">{typeof name === "string" && name.length > 0 ? name : entity.id}</div>
        {typeof label === "string" && label.length > 0 ? (
          <div className="text-xs text-slate-400">{label}</div>
        ) : null}
        <div className="font-mono text-[11px] text-slate-500">{entity.id}</div>
      </div>
    </ListButton>
  );
}

function TypeListItem({
  active,
  entry,
  onSelect,
  store,
}: {
  active: boolean;
  entry: TypeCatalogEntry;
  onSelect: () => void;
  store: Store;
}) {
  const graphName = useStoreSlotValue(store, entry.id, edgeId(core.node.fields.name));

  return (
    <ListButton active={active} onClick={onSelect} props={{ "data-explorer-item-type": entry.id }}>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">{graphName ?? entry.name}</span>
          <Badge className="border-slate-700 bg-slate-900 text-slate-300">{entry.kind}</Badge>
        </div>
        <div className="font-mono text-[11px] text-slate-500">{entry.key}</div>
        {entry.kind === "entity" ? (
          <div className="text-xs text-slate-400">{entry.fieldDefs.length} fields</div>
        ) : entry.kind === "enum" ? (
          <div className="text-xs text-slate-400">{entry.optionDefs.length} options</div>
        ) : (
          <div className="text-xs text-slate-400">scalar metadata</div>
        )}
      </div>
    </ListButton>
  );
}

function PredicateListItem({
  active,
  entry,
  onSelect,
}: {
  active: boolean;
  entry: PredicateCatalogEntry;
  onSelect: () => void;
}) {
  const predicate = entry.getRef();
  const fields = asPredicateMetadataFields(predicate.fields);
  const key = usePredicateField(fields.key).value;
  const name = usePredicateField(fields.name).value;

  return (
    <ListButton
      active={active}
      onClick={onSelect}
      props={{ "data-explorer-item-predicate": entry.id }}
    >
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">{typeof key === "string" ? key : entry.key}</span>
          <Badge className="border-slate-700 bg-slate-900 text-slate-300">{entry.owners.length} uses</Badge>
        </div>
        {typeof name === "string" && name !== key ? <div className="text-xs text-slate-400">{name}</div> : null}
        <div className="font-mono text-[11px] text-slate-500">{entry.id}</div>
      </div>
    </ListButton>
  );
}

function PredicateRangeEditor({
  onMutationError,
  onMutationSuccess,
  options,
  predicate,
}: {
  onMutationError?: (error: unknown) => void;
  onMutationSuccess?: () => void;
  options: readonly TypeCatalogEntry[];
  predicate: MutableOptionalPredicateRef;
}) {
  const { value } = usePredicateField(predicate);
  const selectedId = typeof value === "string" ? value : "";
  const knownOptionIds = new Set(options.map((option) => option.id));

  return (
    <select
      className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
      data-explorer-range-editor={predicate.subjectId}
      onChange={(event) => {
        const nextValue = event.target.value;
        if (nextValue.length === 0) {
          performValidatedMutation(
            { onMutationError, onMutationSuccess },
            () => predicate.validateClear(),
            () => {
              predicate.clear();
              return true;
            },
          );
          return;
        }
        performValidatedMutation(
          { onMutationError, onMutationSuccess },
          () => predicate.validateSet(nextValue),
          () => {
            predicate.set(nextValue);
            return true;
          },
        );
      }}
      value={selectedId}
    >
      <option value="">Unset range</option>
      {!knownOptionIds.has(selectedId) && selectedId.length > 0 ? (
        <option value={selectedId}>{selectedId}</option>
      ) : null}
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.key}
        </option>
      ))}
    </select>
  );
}

function EntityInspector({
  entity,
  typeEntry,
  typeKeyById,
}: {
  entity: AnyEntityRef;
  typeEntry: EntityCatalogEntry;
  typeKeyById: ReadonlyMap<string, string>;
}) {
  const fields = asNamedFields(entity.fields);
  const name = usePredicateField(fields.name).value;
  const rows = useMemo(() => flattenPredicateRefs(entity.fields as Record<string, unknown>), [entity]);

  return (
    <div className="space-y-4" data-explorer-panel="entities">
      <Section title="Entity">
        <div className="space-y-3">
          <div>
            <h3 className="text-xl font-semibold text-white">
              {typeof name === "string" && name.length > 0 ? name : entity.id}
            </h3>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">
              Live entity edits mutate predicate refs directly. The badges beside each field show compiled structural expectations while the inputs reflect the current graph value.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge className="border-slate-700 bg-slate-950 text-slate-300">{typeEntry.key}</Badge>
            <Badge className="border-slate-700 bg-slate-950 text-slate-300">{rows.length} slots</Badge>
            <Badge className="border-slate-700 bg-slate-950 text-slate-300">{entity.id}</Badge>
          </div>
        </div>
      </Section>

      <Section title="Field Editor">
        <div className="grid gap-3">
          {rows.map((row) => (
            <PredicateRow
              key={row.predicate.predicateId}
              pathLabel={row.pathLabel}
              predicate={row.predicate}
              typeKeyById={typeKeyById}
            />
          ))}
        </div>
      </Section>
    </div>
  );
}

function TypeInspector({
  client,
  entry,
  onOpenPredicate,
  store,
  typeKeyById,
}: {
  client: ExplorerClient;
  entry: TypeCatalogEntry;
  onOpenPredicate: (predicateId: string) => void;
  store: Store;
  typeKeyById: ReadonlyMap<string, string>;
}) {
  const typeRef = client.type.ref(entry.id) as unknown as AnyEntityRef;
  const fields = asNodeMetadataFields(typeRef.fields);
  const graphKey = useStoreSlotValue(store, entry.id, keyPredicateId);
  const graphName = usePredicateField(fields.name).value;
  const graphNameText =
    typeof graphName === "string" && graphName.length > 0 ? graphName : entry.name;

  const keyState = graphKey === entry.key ? "aligned" : graphKey ? "drifted" : "missing";
  const nameState =
    graphName === entry.name
      ? "aligned"
      : typeof graphName === "string" && graphName.length > 0
        ? "drifted"
        : "missing";

  return (
    <div className="space-y-4" data-explorer-panel="types">
      <Section title="Type">
        <div className="space-y-3">
          <div>
            <h3 className="text-xl font-semibold text-white">{graphNameText}</h3>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">
              Type metadata is editable here as graph data. The compiled field tree still comes from the checked-in namespace definition, so this panel makes metadata drift explicit instead of pretending live recompilation exists.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge className="border-slate-700 bg-slate-950 text-slate-300">{entry.kind}</Badge>
            <Badge className="border-slate-700 bg-slate-950 text-slate-300">{entry.key}</Badge>
            {entry.kind === "entity" ? (
              <Badge className="border-slate-700 bg-slate-950 text-slate-300">{entry.dataCount} nodes</Badge>
            ) : null}
          </div>
        </div>
      </Section>

      <Section title="Graph Metadata">
        <div className="grid gap-3">
          <PredicateRow pathLabel="metadata.name" predicate={fields.name} typeKeyById={typeKeyById} />
          <PredicateRow pathLabel="metadata.label" predicate={fields.label} typeKeyById={typeKeyById} />
          <PredicateRow
            pathLabel="metadata.description"
            predicate={fields.description}
            typeKeyById={typeKeyById}
          />
        </div>
      </Section>

      <Section title="Compiled Checks">
        <div className="grid gap-3 md:grid-cols-2">
          <DefinitionCheck
            check="type-key"
            compiled={entry.key}
            current={graphKey ?? "missing"}
            label="Key"
            state={keyState}
          />
          <DefinitionCheck
            check="type-name"
            compiled={entry.name}
            current={typeof graphName === "string" ? graphName : "missing"}
            label="Name"
            state={nameState}
          />
        </div>
      </Section>

      <Section
        title={entry.kind === "entity" ? "Compiled Field Tree" : entry.kind === "enum" ? "Enum Options" : "Scalar Definition"}
        right={
          entry.kind === "entity" ? (
            <Badge className="border-slate-700 bg-slate-950 text-slate-300">{entry.fieldDefs.length} fields</Badge>
          ) : entry.kind === "enum" ? (
            <Badge className="border-slate-700 bg-slate-950 text-slate-300">{entry.optionDefs.length} options</Badge>
          ) : null
        }
      >
        {entry.kind === "entity" ? (
          <div className="grid gap-3">
            {entry.fieldDefs.map((fieldDef) => (
              <div
                className="rounded-2xl border border-slate-800 bg-slate-950/80 p-3"
                data-explorer-schema-field={fieldDef.pathLabel}
                key={`${entry.id}:${fieldDef.pathLabel}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-sm font-medium text-slate-100">{fieldDef.pathLabel}</div>
                    <div className="font-mono text-[11px] text-slate-500">{fieldDef.key}</div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <Badge className="border-slate-700 bg-slate-900 text-slate-300">{formatCardinality(fieldDef.cardinality)}</Badge>
                    <Badge className="border-slate-700 bg-slate-900 text-slate-300">{typeKeyById.get(fieldDef.rangeId) ?? fieldDef.rangeId}</Badge>
                    <button
                      className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.16em] text-cyan-200"
                      data-explorer-open-predicate={fieldDef.predicateId}
                      onClick={() => onOpenPredicate(fieldDef.predicateId)}
                      type="button"
                    >
                      open predicate
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : entry.kind === "enum" ? (
          <div className="grid gap-3">
            {entry.optionDefs.map((option) => (
              <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-3" key={option.id}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-sm font-medium text-slate-100">{option.name ?? option.key}</div>
                    <div className="font-mono text-[11px] text-slate-500">{option.key}</div>
                  </div>
                  <Badge className="border-slate-700 bg-slate-900 text-slate-300">{option.id}</Badge>
                </div>
                {option.description ? <p className="mt-2 text-sm text-slate-400">{option.description}</p> : null}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState>
            Scalar types are codec-backed today. This panel still lets you inspect and edit the human metadata node without pretending the runtime can live-edit codecs.
          </EmptyState>
        )}
      </Section>
    </div>
  );
}

function PredicateInspector({
  client,
  entry,
  onOpenType,
  store,
  typeEntries,
  typeKeyById,
}: {
  client: ExplorerClient;
  entry: PredicateCatalogEntry;
  onOpenType: (typeId: string) => void;
  store: Store;
  typeEntries: readonly TypeCatalogEntry[];
  typeKeyById: ReadonlyMap<string, string>;
}) {
  const predicate = client.predicate.ref(entry.id) as unknown as AnyEntityRef;
  const fields = asPredicateMetadataFields(predicate.fields);
  const key = usePredicateField(fields.key).value;
  const range = usePredicateField(fields.range).value;
  const cardinality = usePredicateField(fields.cardinality).value;

  const keyState =
    key === entry.key ? "aligned" : typeof key === "string" && key.length > 0 ? "drifted" : "missing";
  const rangeState =
    range === entry.compiledRangeId
      ? "aligned"
      : typeof range === "string" && range.length > 0
        ? "drifted"
        : "missing";
  const cardinalityState =
    cardinality === compiledCardinalityIdByLiteral[entry.compiledCardinality]
      ? "aligned"
      : typeof cardinality === "string" && cardinality.length > 0
        ? "drifted"
        : "missing";
  const usageCount = store.facts(undefined, entry.id).length;

  return (
    <div className="space-y-4" data-explorer-panel="predicates">
      <Section title="Predicate">
        <div className="space-y-3">
          <div>
            <h3 className="text-xl font-semibold text-white">
              {typeof key === "string" && key.length > 0 ? key : entry.key}
            </h3>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">
              Predicate nodes are editable metadata. The compiled schema still drives live app field behavior, so changing this panel is intentionally visible as drift until full schema recompilation lands.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge className="border-slate-700 bg-slate-950 text-slate-300">{usageCount} asserted edges</Badge>
            <Badge className="border-slate-700 bg-slate-950 text-slate-300">{entry.owners.length} compiled uses</Badge>
            <Badge className="border-slate-700 bg-slate-950 text-slate-300">{entry.id}</Badge>
          </div>
        </div>
      </Section>

      <Section title="Graph Metadata">
        <div className="grid gap-3">
          <PredicateRow pathLabel="metadata.key" predicate={fields.key} typeKeyById={typeKeyById} />
          <PredicateRow pathLabel="metadata.name" predicate={fields.name} typeKeyById={typeKeyById} />
          <PredicateRow
            pathLabel="metadata.description"
            predicate={fields.description}
            typeKeyById={typeKeyById}
          />
          <PredicateRow
            customEditor={({ onMutationError, onMutationSuccess }) => (
              <PredicateRangeEditor
                onMutationError={onMutationError}
                onMutationSuccess={onMutationSuccess}
                options={typeEntries}
                predicate={fields.range}
              />
            )}
            pathLabel="metadata.range"
            predicate={fields.range}
            title="Range"
            typeKeyById={typeKeyById}
          />
          <PredicateRow
            pathLabel="metadata.cardinality"
            predicate={fields.cardinality}
            typeKeyById={typeKeyById}
          />
        </div>
      </Section>

      <Section title="Compiled Checks">
        <div className="grid gap-3 md:grid-cols-3">
          <DefinitionCheck
            check="predicate-key"
            compiled={entry.key}
            current={typeof key === "string" ? key : "missing"}
            label="Key"
            state={keyState}
          />
          <DefinitionCheck
            check="predicate-range"
            compiled={typeKeyById.get(entry.compiledRangeId) ?? entry.compiledRangeId}
            current={typeof range === "string" ? typeKeyById.get(range) ?? range : "missing"}
            label="Range"
            state={rangeState}
          />
          <DefinitionCheck
            check="predicate-cardinality"
            compiled={entry.compiledCardinality}
            current={formatGraphCardinality(typeof cardinality === "string" ? cardinality : undefined)}
            label="Cardinality"
            state={cardinalityState}
          />
        </div>
      </Section>

      <Section title="Compiled Uses">
        <div className="grid gap-3">
          {entry.owners.map((owner) => (
            <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-3" key={`${owner.typeId}:${owner.pathLabel}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-sm font-medium text-slate-100">{owner.pathLabel}</div>
                  <div className="text-xs text-slate-400">{owner.typeName}</div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge className="border-slate-700 bg-slate-900 text-slate-300">{owner.typeKey}</Badge>
                  <button
                    className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.16em] text-cyan-200"
                    data-explorer-open-type={owner.typeId}
                    onClick={() => onOpenType(owner.typeId)}
                    type="button"
                  >
                    open type
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

export function Explorer({ runtime }: { runtime?: ExplorerRuntime }) {
  const runtimeRef = useRef<ExplorerRuntime | null>(runtime ?? null);
  if (!runtimeRef.current) {
    runtimeRef.current = createExampleRuntime();
  }

  const clientRef = useRef<ExplorerClient | null>(null);
  if (!clientRef.current) {
    clientRef.current = createTypeClient(runtimeRef.current.store, explorerNamespace);
  }

  const graphRuntime = runtimeRef.current;
  const client = clientRef.current;

  const typeEntries = useMemo(() => buildTypeCatalog(graphRuntime.store), [graphRuntime.store]);
  const entityEntries = useMemo(() => buildEntityCatalog(client, graphRuntime.store), [client, graphRuntime.store]);
  const predicateEntries = useMemo(() => buildPredicateCatalog(client, typeEntries), [client, typeEntries]);
  const typeEntryById = useMemo(() => new Map(typeEntries.map((entry) => [entry.id, entry])), [typeEntries]);
  const typeKeyById = useMemo(() => new Map(typeEntries.map((entry) => [entry.id, entry.key])), [typeEntries]);
  const predicateEntryById = useMemo(
    () => new Map(predicateEntries.map((entry) => [entry.id, entry])),
    [predicateEntries],
  );
  const entityEntryById = useMemo(() => new Map(entityEntries.map((entry) => [entry.id, entry])), [entityEntries]);

  const [section, setSection] = useState<ExplorerSection>("entities");
  const [selectedEntityTypeId, setSelectedEntityTypeId] = useState(() => typeId(app.company));
  const [selectedEntityId, setSelectedEntityId] = useState(() => entityEntries[0]?.ids[0] ?? "");
  const [selectedTypeId, setSelectedTypeId] = useState(() => typeId(app.company));
  const [selectedPredicateId, setSelectedPredicateId] = useState(() => edgeId(app.company.fields.name));
  const [entityQuery, setEntityQuery] = useState("");
  const [typeQuery, setTypeQuery] = useState("");
  const [predicateQuery, setPredicateQuery] = useState("");

  const deferredEntityQuery = useDeferredValue(entityQuery.trim().toLowerCase());
  const deferredTypeQuery = useDeferredValue(typeQuery.trim().toLowerCase());
  const deferredPredicateQuery = useDeferredValue(predicateQuery.trim().toLowerCase());

  const selectedEntityType = entityEntryById.get(selectedEntityTypeId) ?? entityEntries[0] ?? null;

  const visibleEntityIds = useMemo(() => {
    if (!selectedEntityType) return [];
    return selectedEntityType.ids.filter((id) => matchesQuery(deferredEntityQuery, id, getNodeName(graphRuntime.store, id)));
  }, [deferredEntityQuery, graphRuntime.store, selectedEntityType]);

  const visibleTypes = useMemo(
    () => typeEntries.filter((entry) => matchesQuery(deferredTypeQuery, entry.key, entry.name, entry.kind)),
    [deferredTypeQuery, typeEntries],
  );

  const visiblePredicates = useMemo(
    () =>
      predicateEntries.filter((entry) =>
        matchesQuery(
          deferredPredicateQuery,
          entry.key,
          entry.owners.map((owner) => owner.pathLabel).join(" "),
          typeKeyById.get(entry.compiledRangeId),
        ),
      ),
    [deferredPredicateQuery, predicateEntries, typeKeyById],
  );

  useEffect(() => {
    if (!selectedEntityType) return;
    if (!visibleEntityIds.includes(selectedEntityId)) {
      setSelectedEntityId(visibleEntityIds[0] ?? "");
    }
  }, [selectedEntityId, selectedEntityType, visibleEntityIds]);

  useEffect(() => {
    if (!visibleTypes.some((entry) => entry.id === selectedTypeId)) {
      setSelectedTypeId(visibleTypes[0]?.id ?? "");
    }
  }, [selectedTypeId, visibleTypes]);

  useEffect(() => {
    if (!visiblePredicates.some((entry) => entry.id === selectedPredicateId)) {
      setSelectedPredicateId(visiblePredicates[0]?.id ?? "");
    }
  }, [selectedPredicateId, visiblePredicates]);

  useEffect(() => {
    if (!selectedEntityType) return;
    if (selectedEntityType.id === selectedEntityTypeId) return;
    setSelectedEntityTypeId(selectedEntityType.id);
  }, [selectedEntityType, selectedEntityTypeId]);

  const selectedEntity = selectedEntityType && selectedEntityId ? selectedEntityType.getRef(selectedEntityId) : null;
  const selectedTypeEntry = typeEntryById.get(selectedTypeId) ?? visibleTypes[0] ?? null;
  const selectedPredicateEntry = predicateEntryById.get(selectedPredicateId) ?? visiblePredicates[0] ?? null;

  function openType(typeIdValue: string): void {
    setSection("types");
    setSelectedTypeId(typeIdValue);
  }

  function openPredicate(predicateIdValue: string): void {
    setSection("predicates");
    setSelectedPredicateId(predicateIdValue);
  }

  return (
    <main className="grid min-h-screen grid-cols-[280px_340px_1fr] gap-4 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.12),_transparent_24%),linear-gradient(180deg,_#020617_0%,_#0f172a_100%)] p-4 text-slate-100">
      <div className="space-y-4">
        <Section title="Explorer">
          <div className="space-y-3">
            <div>
              <h1 className="text-lg font-semibold text-white">Graph Devtool</h1>
              <p className="mt-1 text-sm text-slate-400">
                One surface for live entity data, compiled schema shape, and editable schema metadata.
              </p>
            </div>
            <div className="space-y-2">
              <SectionNav count={entityEntries.length} label="Entities" mode="entities" onSelect={setSection} selected={section} />
              <SectionNav count={typeEntries.length} label="Types" mode="types" onSelect={setSection} selected={section} />
              <SectionNav count={predicateEntries.length} label="Predicates" mode="predicates" onSelect={setSection} selected={section} />
            </div>
          </div>
        </Section>

        {section === "entities" ? (
          <Section
            title="Entity Types"
            right={<Badge className="border-slate-700 bg-slate-950 text-slate-300">{entityEntries.length}</Badge>}
          >
            <div className="space-y-2">
              {entityEntries.map((entry) => (
                <ListButton
                  active={entry.id === selectedEntityType?.id}
                  key={entry.id}
                  onClick={() => {
                    setSelectedEntityTypeId(entry.id);
                    setSelectedEntityId(entry.ids[0] ?? "");
                  }}
                  props={{ "data-explorer-entity-type": entry.id }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="text-sm font-medium">{entry.name}</div>
                      <div className="font-mono text-[11px] text-slate-500">{entry.key}</div>
                    </div>
                    <Badge className="border-slate-700 bg-slate-900 text-slate-300">{entry.count}</Badge>
                  </div>
                </ListButton>
              ))}
            </div>
          </Section>
        ) : (
          <Section title="Mode Context">
            <div className="space-y-3 text-sm text-slate-400">
              <p>
                The explorer keeps compiled definitions and graph metadata side by side. When you edit schema nodes here, the drift checks stay visible until runtime schema recompilation exists.
              </p>
              <div className="flex flex-wrap gap-2">
                <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-200">aligned</Badge>
                <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-200">drifted</Badge>
                <Badge className="border-rose-500/30 bg-rose-500/10 text-rose-200">missing</Badge>
              </div>
            </div>
          </Section>
        )}
      </div>

      <div className="space-y-4">
        {section === "entities" ? (
          <Section
            title={selectedEntityType ? `${selectedEntityType.name} Nodes` : "Nodes"}
            right={<Badge className="border-slate-700 bg-slate-950 text-slate-300">{visibleEntityIds.length}</Badge>}
          >
            <input
              className="mb-3 w-full rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
              onChange={(event) => setEntityQuery(event.target.value)}
              placeholder="Filter by id or name"
              value={entityQuery}
            />
            <div className="space-y-2">
              {selectedEntityType && visibleEntityIds.length > 0 ? (
                visibleEntityIds.map((id) => (
                  <EntityListItem
                    active={id === selectedEntityId}
                    entity={selectedEntityType.getRef(id)}
                    key={id}
                    onSelect={() => setSelectedEntityId(id)}
                  />
                ))
              ) : (
                <EmptyState>No nodes match the current filter.</EmptyState>
              )}
            </div>
          </Section>
        ) : section === "types" ? (
          <Section
            title="Types"
            right={<Badge className="border-slate-700 bg-slate-950 text-slate-300">{visibleTypes.length}</Badge>}
          >
            <input
              className="mb-3 w-full rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
              onChange={(event) => setTypeQuery(event.target.value)}
              placeholder="Filter by key, name, or kind"
              value={typeQuery}
            />
            <div className="space-y-2">
              {visibleTypes.length > 0 ? (
                visibleTypes.map((entry) => (
                  <TypeListItem
                    active={entry.id === selectedTypeEntry?.id}
                    entry={entry}
                    key={entry.id}
                    onSelect={() => setSelectedTypeId(entry.id)}
                    store={graphRuntime.store}
                  />
                ))
              ) : (
                <EmptyState>No schema types match the current filter.</EmptyState>
              )}
            </div>
          </Section>
        ) : (
          <Section
            title="Predicates"
            right={<Badge className="border-slate-700 bg-slate-950 text-slate-300">{visiblePredicates.length}</Badge>}
          >
            <input
              className="mb-3 w-full rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
              onChange={(event) => setPredicateQuery(event.target.value)}
              placeholder="Filter by key, path, or range"
              value={predicateQuery}
            />
            <div className="space-y-2">
              {visiblePredicates.length > 0 ? (
                visiblePredicates.map((entry) => (
                  <PredicateListItem
                    active={entry.id === selectedPredicateEntry?.id}
                    entry={entry}
                    key={entry.id}
                    onSelect={() => setSelectedPredicateId(entry.id)}
                  />
                ))
              ) : (
                <EmptyState>No predicates match the current filter.</EmptyState>
              )}
            </div>
          </Section>
        )}
      </div>

      <div className="space-y-4 overflow-y-auto pr-1">
        {section === "entities" && selectedEntity && selectedEntityType ? (
          <EntityInspector entity={selectedEntity} typeEntry={selectedEntityType} typeKeyById={typeKeyById} />
        ) : null}

        {section === "types" && selectedTypeEntry ? (
          <TypeInspector
            client={client}
            entry={selectedTypeEntry}
            onOpenPredicate={openPredicate}
            store={graphRuntime.store}
            typeKeyById={typeKeyById}
          />
        ) : null}

        {section === "predicates" && selectedPredicateEntry ? (
          <PredicateInspector
            client={client}
            entry={selectedPredicateEntry}
            onOpenType={openType}
            store={graphRuntime.store}
            typeEntries={typeEntries}
            typeKeyById={typeKeyById}
          />
        ) : null}
      </div>
    </main>
  );
}
export function ExplorerSurface({
  graph,
  store,
  sync,
}: Pick<ExplorerRuntime, "graph" | "store" | "sync">) {
  const fallbackRuntimeRef = useRef<ExplorerRuntime | null>(null);
  if (!fallbackRuntimeRef.current) {
    fallbackRuntimeRef.current = createExampleRuntime();
  }

  return <Explorer runtime={{ ...fallbackRuntimeRef.current, graph, store, sync }} />;
}
