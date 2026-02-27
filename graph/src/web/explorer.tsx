import { useMemo, useState } from "react";

import { app, core, createExampleRuntime, edgeId, isFieldsOutput, typeId } from "#graph";
import type { AnyTypeOutput, Cardinality, EdgeOutput, ScalarTypeOutput } from "#graph";

const runtime = createExampleRuntime();
const { store } = runtime;
const allTypes = [...Object.values(core), ...Object.values(app)];
const scalarByKey = new Map<string, ScalarTypeOutput<any>>();
const typeByKey = new Map<string, AnyTypeOutput>();

for (const typeDef of allTypes) {
  typeByKey.set(typeDef.values.key, typeDef);
  typeByKey.set(typeId(typeDef), typeDef);
  if (typeDef.kind === "scalar") {
    scalarByKey.set(typeDef.values.key, typeDef);
    scalarByKey.set(typeId(typeDef), typeDef);
  }
}

const keyPredicate = core.predicate.fields.key as EdgeOutput;
const rangePredicate = core.predicate.fields.range as EdgeOutput;
const cardinalityPredicate = core.predicate.fields.cardinality as EdgeOutput;
const typePredicate = core.node.fields.type as EdgeOutput;
const namePredicate = core.node.fields.name as EdgeOutput;

type TypeSummary = {
  id: string;
  idLabel: string;
  count: number;
};

type NodeSummary = {
  id: string;
  idLabel: string;
  name: string;
  typeId?: string;
  typeIdLabel?: string;
};

type FlatField = {
  path: string;
  id?: string;
  idLabel?: string;
  range: string;
  rangeLabel: string;
  cardinality: Cardinality;
};

type SchemaResponse = {
  entityTypes: Array<{
    id: string;
    idLabel: string;
    fields: FlatField[];
  }>;
  scalars: Array<{ id: string; idLabel: string }>;
};

type NodeDetails = {
  summary: NodeSummary;
  outgoing: Array<{
    edgeId: string;
    predicate: {
      id: string;
      idLabel: string;
      key?: string;
      name?: string;
      range?: string;
      rangeLabel?: string;
      cardinality?: string;
    };
    objectRaw: string;
    objectValue: unknown;
    objectNode?: NodeSummary;
  }>;
  incoming: Array<{
    edgeId: string;
    subject: NodeSummary;
    predicate: {
      id: string;
      idLabel: string;
      key?: string;
      name?: string;
      range?: string;
      rangeLabel?: string;
      cardinality?: string;
    };
  }>;
};

function getFirstObject(subject: string, predicate: string): string | undefined {
  return store.facts(subject, predicate)[0]?.o;
}

const keyByIdCache = new Map<string, string | undefined>();

function keyForId(id: string): string | undefined {
  const cached = keyByIdCache.get(id);
  if (cached !== undefined) return cached;
  const key = getFirstObject(id, edgeId(keyPredicate));
  keyByIdCache.set(id, key);
  return key;
}

function labelForId(id: string): string {
  return keyForId(id) ?? id;
}

function getNodeName(id: string): string {
  const name = getFirstObject(id, edgeId(namePredicate));
  return name ?? id;
}

function getNodeTypeKeys(id: string): string[] {
  return store.facts(id, edgeId(typePredicate)).map((edge) => edge.o);
}

function getPrimaryTypeKey(id: string): string | undefined {
  const typeKeys = getNodeTypeKeys(id);
  return typeKeys.find((typeKey) => typeKey !== typeId(core.predicate)) ?? typeKeys[0];
}

function summarizeNode(id: string): NodeSummary {
  const typeIdValue = getPrimaryTypeKey(id);
  return {
    id,
    idLabel: labelForId(id),
    name: getNodeName(id),
    typeId: typeIdValue,
    typeIdLabel: typeIdValue ? labelForId(typeIdValue) : undefined,
  };
}

function flattenFields(tree: unknown, path: string[] = [], out: FlatField[] = []): FlatField[] {
  if (!isFieldsOutput(tree)) return out;
  for (const [fieldName, value] of Object.entries(tree as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const edgeDef = value as Partial<EdgeOutput> & { id?: string };
    if (
      typeof edgeDef.key === "string" &&
      typeof edgeDef.range === "string" &&
      typeof edgeDef.cardinality === "string"
    ) {
      out.push({
        path: [...path, fieldName].join("."),
        id: edgeDef.id,
        idLabel: edgeDef.id ? labelForId(edgeDef.id) : undefined,
        range: edgeDef.range,
        rangeLabel: labelForId(edgeDef.range),
        cardinality: edgeDef.cardinality as Cardinality,
      });
      continue;
    }
    if (isFieldsOutput(value)) flattenFields(value, [...path, fieldName], out);
  }
  return out;
}

function isScalarRange(range: string): boolean {
  return scalarByKey.has(range);
}

function decodeByRange(raw: string, range: string): unknown {
  const scalar = scalarByKey.get(range);
  if (!scalar) return raw;
  const value = scalar.decode(raw);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof URL) return value.toString();
  return value;
}

function getPredicateMeta(predicateId: string) {
  const keyRaw = getFirstObject(predicateId, edgeId(keyPredicate));
  const nameRaw = getFirstObject(predicateId, edgeId(namePredicate));
  const rangeRaw = getFirstObject(predicateId, edgeId(rangePredicate));
  const cardinalityRaw = getFirstObject(predicateId, edgeId(cardinalityPredicate));
  return {
    id: predicateId,
    idLabel: labelForId(predicateId),
    key: typeof keyRaw === "string" ? keyRaw : undefined,
    name: typeof nameRaw === "string" ? nameRaw : undefined,
    range: typeof rangeRaw === "string" ? rangeRaw : undefined,
    rangeLabel: typeof rangeRaw === "string" ? labelForId(rangeRaw) : undefined,
    cardinality: typeof cardinalityRaw === "string" ? (cardinalityRaw as Cardinality) : undefined,
  };
}

function getNodeDetails(id: string): NodeDetails {
  const summary = summarizeNode(id);
  const outgoing = store.facts(id).map((edge) => {
    const predicate = getPredicateMeta(edge.p);
    const objectValue =
      predicate.range && isScalarRange(predicate.range)
        ? decodeByRange(edge.o, predicate.range)
        : edge.o;
    const objectNode =
      predicate.range && !isScalarRange(predicate.range) ? summarizeNode(edge.o) : undefined;
    return {
      edgeId: edge.id,
      predicate,
      objectRaw: edge.o,
      objectValue,
      objectNode,
    };
  });

  const incoming = store.facts(undefined, undefined, id).map((edge) => ({
    edgeId: edge.id,
    subject: summarizeNode(edge.s),
    predicate: getPredicateMeta(edge.p),
  }));

  return { summary, outgoing, incoming };
}

function buildSchema(): SchemaResponse {
  const appTypes = Object.values(app) as AnyTypeOutput[];
  const entityTypes = appTypes
    .filter(
      (typeDef): typeDef is Extract<AnyTypeOutput, { kind: "entity" }> => typeDef.kind === "entity",
    )
    .map((typeDef) => ({
      id: typeId(typeDef),
      idLabel: labelForId(typeId(typeDef)),
      fields: flattenFields(typeDef.fields),
    }));
  const scalarDefs = allTypes.filter((typeDef) => typeDef.kind === "scalar");
  const scalars = scalarDefs.map((scalar) => ({
    id: typeId(scalar),
    idLabel: labelForId(typeId(scalar)),
  }));
  return { entityTypes, scalars };
}

function buildTypes(): TypeSummary[] {
  return Object.values(app).map((typeDef) => ({
    id: typeId(typeDef),
    idLabel: labelForId(typeId(typeDef)),
    count: store.facts(undefined, edgeId(typePredicate), typeId(typeDef)).length,
  }));
}

function queryNodes(selectedType: string, query: string): NodeSummary[] {
  const requestedTypeId = typeByKey.get(selectedType)
    ? typeId(typeByKey.get(selectedType) as AnyTypeOutput)
    : selectedType;
  const q = query.trim().toLowerCase();
  const nodeIds = store
    .facts(undefined, edgeId(typePredicate), requestedTypeId)
    .map((edge) => edge.s);
  return nodeIds
    .map((id) => summarizeNode(id))
    .filter((node) => {
      if (!q) return true;
      return node.id.toLowerCase().includes(q) || node.name.toLowerCase().includes(q);
    });
}

function Section({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900 p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
        {right ?? null}
      </div>
      {children}
    </section>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
      {children}
    </span>
  );
}

export function Explorer() {
  const schema = useMemo(() => buildSchema(), []);
  const types = useMemo(() => buildTypes(), []);

  const [selectedType, setSelectedType] = useState(() => types[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const nodes = useMemo(() => queryNodes(selectedType, query), [selectedType, query]);
  const [selectedNodeId, setSelectedNodeId] = useState("");

  const selectedTypeSchema = useMemo(() => {
    if (!selectedType) return null;
    return schema.entityTypes.find((typeDef) => typeDef.id === selectedType) ?? null;
  }, [schema.entityTypes, selectedType]);

  const selectedNodeDetails = useMemo(() => {
    if (!selectedNodeId) return null;
    return getNodeDetails(selectedNodeId);
  }, [selectedNodeId]);

  return (
    <main className="grid h-full grid-cols-[240px_320px_1fr] gap-3 p-3">
      <div className="space-y-3 overflow-y-auto">
        <Section title="Types">
          <div className="space-y-1">
            {types.map((typeDef) => (
              <button
                key={typeDef.id}
                onClick={() => {
                  setSelectedType(typeDef.id);
                  setSelectedNodeId("");
                }}
                className={
                  "w-full rounded px-2 py-1.5 text-left text-sm transition " +
                  (selectedType === typeDef.id
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-800 text-slate-200 hover:bg-slate-700")
                }
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs">{typeDef.idLabel}</span>
                  <Badge>{typeDef.count}</Badge>
                </div>
              </button>
            ))}
          </div>
        </Section>
        <Section
          title="Schema"
          right={
            selectedTypeSchema ? <Badge>{selectedTypeSchema.fields.length} fields</Badge> : null
          }
        >
          {selectedTypeSchema ? (
            <div className="space-y-2">
              {selectedTypeSchema.fields.map((field) => (
                <div
                  key={field.id ?? field.path}
                  className="rounded border border-slate-800 bg-slate-950 p-2 text-xs"
                >
                  <div className="font-mono text-indigo-300">{field.path}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {field.id ? <Badge>{field.idLabel}</Badge> : null}
                    <Badge>{field.cardinality}</Badge>
                    <Badge>{field.rangeLabel}</Badge>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">No schema selected.</p>
          )}
        </Section>
      </div>

      <div className="space-y-3 overflow-y-auto">
        <Section title="Nodes" right={<Badge>{nodes.length}</Badge>}>
          <input
            className="mb-2 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
            value={query}
            onInput={(event) => setQuery(event.currentTarget.value)}
            placeholder="Filter by id or name..."
          />
          <div className="space-y-1">
            {nodes.map((node) => {
              const isActive = selectedNodeId === node.id;
              return (
                <button
                  key={node.id}
                  onClick={() => setSelectedNodeId(node.id)}
                  className={
                    "w-full rounded px-2 py-1.5 text-left text-sm transition " +
                    (isActive
                      ? "bg-emerald-600 text-white"
                      : "bg-slate-800 text-slate-200 hover:bg-slate-700")
                  }
                >
                  <div>{node.name}</div>
                  <div className="font-mono text-xs opacity-80">{node.idLabel}</div>
                </button>
              );
            })}
          </div>
        </Section>
      </div>

      <div className="space-y-3 overflow-y-auto">
        <Section title="Inspector">
          {selectedNodeDetails ? (
            <>
              <div className="mb-3 rounded border border-slate-800 bg-slate-950 p-3">
                <div className="text-lg font-semibold">{selectedNodeDetails.summary.name}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Badge>{selectedNodeDetails.summary.typeIdLabel ?? "Unknown type"}</Badge>
                  <Badge>{selectedNodeDetails.summary.idLabel}</Badge>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-slate-300">Outgoing</h4>
                  <div className="space-y-2">
                    {selectedNodeDetails.outgoing.map((edge) => (
                      <div
                        key={edge.edgeId}
                        className="rounded border border-slate-800 bg-slate-950 p-2 text-xs"
                      >
                        <div className="mb-1 font-mono text-indigo-300">
                          {edge.predicate.idLabel}
                        </div>
                        <div className="mb-1 flex flex-wrap gap-1">
                          {edge.predicate.cardinality ? (
                            <Badge>{edge.predicate.cardinality}</Badge>
                          ) : null}
                          {edge.predicate.rangeLabel ? (
                            <Badge>{edge.predicate.rangeLabel}</Badge>
                          ) : null}
                        </div>
                        {edge.objectNode ? (
                          <button
                            onClick={() => setSelectedNodeId(edge.objectNode?.id ?? "")}
                            className="w-full rounded border border-slate-700 bg-slate-900 p-2 text-left hover:border-emerald-400"
                          >
                            <div>{edge.objectNode.name}</div>
                            <div className="font-mono text-[11px] text-slate-400">
                              {edge.objectNode.idLabel}
                            </div>
                          </button>
                        ) : (
                          <div className="rounded border border-slate-700 bg-slate-900 p-2 font-mono">
                            {String(edge.objectValue)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h4 className="mb-2 text-sm font-semibold text-slate-300">Incoming</h4>
                  <div className="space-y-2">
                    {selectedNodeDetails.incoming.map((edge) => (
                      <div
                        key={edge.edgeId}
                        className="rounded border border-slate-800 bg-slate-950 p-2 text-xs"
                      >
                        <div className="mb-1 font-mono text-violet-300">
                          {edge.predicate.idLabel}
                        </div>
                        <button
                          onClick={() => setSelectedNodeId(edge.subject.id)}
                          className="w-full rounded border border-slate-700 bg-slate-900 p-2 text-left hover:border-violet-400"
                        >
                          <div>{edge.subject.name}</div>
                          <div className="font-mono text-[11px] text-slate-400">
                            {edge.subject.idLabel}
                          </div>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-400">Select a node to inspect it.</p>
          )}
        </Section>
      </div>
    </main>
  );
}
