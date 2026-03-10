import { Profiler, useLayoutEffect, useRef, useSyncExternalStore } from "react";

import {
  app,
  core,
  createExampleRuntime,
  fieldGroupPath,
  type EntityRef,
  type PredicateRef,
} from "#graph";

import { PredicateFieldEditor } from "./bindings.js";
import {
  getPredicateEntityReferencePolicy,
  getPredicateEntityReferenceSelection,
  usePredicateField,
} from "./predicate.js";

type CompanyRef = EntityRef<typeof app.company, typeof app & typeof core>;
type PersonRef = EntityRef<typeof app.person, typeof app & typeof core>;

type ProofFieldSpec = {
  id: string;
  label: string;
  helper: string;
  requirement: "Required" | "Optional" | "Many";
  predicate: PredicateRef<any, any>;
  layout?: "default" | "full";
};

type ProofSectionSpec = {
  description: string;
  fields: readonly ProofFieldSpec[];
  id: string;
  title: string;
};

type InvalidationCheck = {
  changedIds: string[];
  fieldId: string;
  holds: boolean;
};

type RenderProbeSnapshot = {
  counts: Readonly<Record<string, number>>;
  lastCheck?: InvalidationCheck;
};

type RenderProbeStore = {
  beginCheck(fieldId: string): void;
  getSnapshot(): RenderProbeSnapshot;
  recordCommit(id: string): void;
  subscribe(listener: () => void): () => void;
};

function createRenderProbeStore(trackIds: readonly string[]): RenderProbeStore {
  const listeners = new Set<() => void>();
  let counts = Object.fromEntries(trackIds.map((id) => [id, 0])) as Record<string, number>;
  let lastCheck: InvalidationCheck | undefined;
  let token = 0;
  let snapshot: RenderProbeSnapshot = { counts, lastCheck };
  let settleTimer: ReturnType<typeof setTimeout> | undefined;

  function emit() {
    for (const listener of listeners) listener();
  }

  function publish() {
    snapshot = { counts, lastCheck };
    emit();
  }

  return {
    beginCheck(fieldId) {
      const baseline = { ...counts };
      const currentToken = ++token;
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        if (currentToken !== token) return;
        const changedIds = trackIds.filter((id) => (counts[id] ?? 0) > (baseline[id] ?? 0));
        lastCheck = {
          fieldId,
          changedIds,
          holds:
            changedIds.length > 0 &&
            changedIds.every((id) => id === `field:${fieldId}`),
        };
        publish();
      }, 0);
    },
    getSnapshot() {
      return snapshot;
    },
    recordCommit(id) {
      counts = {
        ...counts,
        [id]: (counts[id] ?? 0) + 1,
      };
      publish();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function getFieldLabel(predicate: PredicateRef<any, any>): string {
  const field = predicate.field as { key: string; meta?: { label?: string } };
  return field.meta?.label ?? field.key;
}

function getFieldRequirement(predicate: PredicateRef<any, any>): ProofFieldSpec["requirement"] {
  if (predicate.field.cardinality === "one") return "Required";
  if (predicate.field.cardinality === "many") return "Many";
  return "Optional";
}

function getFieldRangeLabel(predicate: PredicateRef<any, any>): string {
  const field = predicate.field as { range: string };
  const rangeValues = predicate.rangeType?.values as { key: string; name?: string } | undefined;
  return rangeValues?.name ?? rangeValues?.key ?? field.range;
}

function getFieldHelper(
  predicate: PredicateRef<any, any>,
  prefix?: string,
): string {
  const range = getFieldRangeLabel(predicate);
  const base = predicate.field.cardinality === "many" ? `many ${range}` : `${getFieldRequirement(predicate).toLowerCase()} ${range}`;
  return prefix ? `${prefix} • ${base}` : base;
}

function createFieldSpec(input: {
  helperPrefix?: string;
  id: string;
  layout?: "default" | "full";
  predicate: PredicateRef<any, any>;
}): ProofFieldSpec {
  return {
    id: input.id,
    label: getFieldLabel(input.predicate),
    helper: getFieldHelper(input.predicate, input.helperPrefix),
    layout: input.layout,
    predicate: input.predicate,
    requirement: getFieldRequirement(input.predicate),
  };
}

function getProofSections(company: CompanyRef, person: PersonRef): ProofSectionSpec[] {
  const addressPath = fieldGroupPath(company.fields.address).join(".");
  const relationshipPolicy = getPredicateEntityReferencePolicy(person.fields.worksAt.field);

  return [
    {
      id: "company",
      title: "Company fields",
      description:
        "The original proof fields stay on direct predicate refs while unordered tags keep collection-aware editing.",
      fields: [
        createFieldSpec({ id: "name", predicate: company.fields.name }),
        createFieldSpec({ id: "status", predicate: company.fields.status }),
        createFieldSpec({ id: "website", predicate: company.fields.website }),
        createFieldSpec({ id: "foundedYear", predicate: company.fields.foundedYear }),
        createFieldSpec({
          id: "tags",
          predicate: company.fields.tags,
          helperPrefix: `${company.fields.tags.collection.kind} collection`,
        }),
      ],
    },
    {
      id: "address",
      title: "Nested address leaves",
      description:
        "Traversal enters the nested address group, but each editor below still binds to one leaf predicate ref.",
      fields: [
        createFieldSpec({
          id: `${addressPath}.address_line1`,
          predicate: company.fields.address.address_line1,
          helperPrefix: `${addressPath} leaf`,
        }),
        createFieldSpec({
          id: `${addressPath}.locality`,
          predicate: company.fields.address.locality,
          helperPrefix: `${addressPath} leaf`,
        }),
        createFieldSpec({
          id: `${addressPath}.postal_code`,
          predicate: company.fields.address.postal_code,
          helperPrefix: `${addressPath} leaf`,
        }),
      ],
    },
    {
      id: "relationships",
      title: "Relationships",
      description:
        "Reference editing stays explicit: the generic editor links existing companies by id instead of projecting embedded snapshots.",
      fields: [
        createFieldSpec({
          id: "worksAt",
          predicate: person.fields.worksAt,
          helperPrefix: relationshipPolicy ? `${relationshipPolicy.selection} policy` : undefined,
          layout: "full",
        }),
      ],
    },
  ];
}

function getEntityReferenceLabel(entity: { id: string; get(): Record<string, unknown> }): string {
  const snapshot = entity.get();
  const name = snapshot.name;
  if (typeof name === "string" && name.length > 0) return name;
  const label = snapshot.label;
  if (typeof label === "string" && label.length > 0) return label;
  return entity.id;
}

function useRenderProbeSnapshot(store: RenderProbeStore): RenderProbeSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

function ProofFieldRow({
  field,
  store,
}: {
  field: ProofFieldSpec;
  store: RenderProbeStore;
}) {
  const probeId = `field:${field.id}`;
  return (
    <section
      className={`grid gap-2 rounded-2xl border border-slate-300/80 bg-white/80 p-4 shadow-sm shadow-slate-900/5 backdrop-blur dark:border-slate-800 dark:bg-slate-950/70${field.layout === "full" ? " md:col-span-2" : ""}`}
      data-proof-field={field.id}
      onChangeCapture={() => {
        store.beginCheck(field.id);
      }}
      onClickCapture={(event) => {
        const target = event.target as { getAttribute?: (name: string) => string | null };
        if (!target.getAttribute?.("data-proof-mutation")) return;
        store.beginCheck(field.id);
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{field.label}</span>
        <span className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
          {field.requirement}
        </span>
      </div>
      <span className="text-xs text-slate-500 dark:text-slate-400">{field.helper}</span>
      <Profiler
        id={probeId}
        onRender={(id) => {
          store.recordCommit(id);
        }}
      >
        <PredicateFieldEditor predicate={field.predicate} />
      </Profiler>
    </section>
  );
}

function useCommitProbe(id: string, store: RenderProbeStore) {
  useLayoutEffect(() => {
    store.recordCommit(id);
  });
}

function CompanyProofFields({
  sections,
  store,
}: {
  sections: readonly ProofSectionSpec[];
  store: RenderProbeStore;
}) {
  useCommitProbe("surface", store);

  return (
    <div className="grid gap-6 px-6 py-6">
      {sections.map((section) => (
        <section
          className="grid gap-4 rounded-[1.75rem] border border-slate-200/80 bg-slate-50/80 p-5 dark:border-slate-800 dark:bg-slate-900/50"
          key={section.id}
        >
          <div className="space-y-1">
            <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              {section.title}
            </h2>
            <p className="max-w-3xl text-sm text-slate-600 dark:text-slate-300">
              {section.description}
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {section.fields.map((field) => (
              <ProofFieldRow field={field} key={field.id} store={store} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function CompanyProofInstrumentation({
  company,
  fields,
  person,
  store,
}: {
  company: CompanyRef;
  fields: readonly ProofFieldSpec[];
  person: PersonRef;
  store: RenderProbeStore;
}) {
  const snapshot = useRenderProbeSnapshot(store);
  const changedLabels = snapshot.lastCheck?.changedIds.map((id) =>
    id === "surface" ? "surface" : id.replace("field:", ""),
  );
  const addressPath = fieldGroupPath(company.fields.address).join(".");
  const tagsValue = usePredicateField(company.fields.tags).value;
  const worksAtValue = usePredicateField(person.fields.worksAt).value;
  const relationshipPolicy = getPredicateEntityReferencePolicy(person.fields.worksAt.field);
  const selectedCompanies = getPredicateEntityReferenceSelection(person.fields.worksAt, worksAtValue);
  const tagCount = Array.isArray(tagsValue) ? tagsValue.length : 0;

  return (
    <aside className="space-y-4 rounded-[1.75rem] border border-slate-300/80 bg-slate-950 px-5 py-4 text-slate-100 shadow-xl shadow-slate-900/15">
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-[0.24em] text-cyan-300">Rerender proof</p>
        <p
          className="text-sm text-slate-300"
          data-proof-last-check={
            snapshot.lastCheck
              ? snapshot.lastCheck.holds
                ? "holds"
                : "failed"
              : "pending"
          }
        >
          {snapshot.lastCheck
            ? snapshot.lastCheck.holds
              ? `Predicate-local invalidation held for ${snapshot.lastCheck.fieldId}.`
              : `Predicate-local invalidation widened on ${snapshot.lastCheck.fieldId}.`
            : "Edit a field to record the invalidation boundary."}
        </p>
      </div>
      <div className="grid gap-2 rounded-2xl border border-white/10 bg-white/5 p-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="text-slate-300">surface</span>
          <span data-proof-count="surface">{snapshot.counts.surface ?? 0}</span>
        </div>
        {fields.map((field) => (
          <div className="flex items-center justify-between gap-3" key={field.id}>
            <span className="text-slate-300">{field.id}</span>
            <span data-proof-count={field.id}>{snapshot.counts[`field:${field.id}`] ?? 0}</span>
          </div>
        ))}
      </div>
      <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs text-slate-300">
        <p className="uppercase tracking-[0.2em] text-slate-400">Last changed probes</p>
        <p data-proof-changed={changedLabels?.join(",") ?? "pending"}>
          {changedLabels?.length ? changedLabels.join(", ") : "pending"}
        </p>
      </div>
      <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-slate-200">
        <div className="flex items-center justify-between gap-3">
          <span className="text-slate-300">nested path</span>
          <code>{addressPath}</code>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-slate-300">tags semantics</span>
          <code>{company.fields.tags.collection.kind}</code>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-slate-300">tags count</span>
          <span>{tagCount}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-slate-300">relationship policy</span>
          <code>{relationshipPolicy?.selection ?? "none"}</code>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-slate-300">create-and-link</span>
          <code>{relationshipPolicy?.create === false ? "disabled" : "enabled"}</code>
        </div>
      </div>
      <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs text-slate-300">
        <p className="uppercase tracking-[0.2em] text-slate-400">Linked companies</p>
        <ul className="mt-2 grid gap-2" data-proof-linked-companies="">
          {selectedCompanies.length ? (
            selectedCompanies.map(({ entity, id }) => (
              <li className="flex items-center justify-between gap-3" key={id}>
                <span>{getEntityReferenceLabel(entity)}</span>
                <code>{id}</code>
              </li>
            ))
          ) : (
            <li>none</li>
          )}
        </ul>
      </div>
    </aside>
  );
}

export function CompanyProofSurface({
  company,
  person,
}: {
  company: CompanyRef;
  person: PersonRef;
}) {
  const sections = getProofSections(company, person);
  const fields = sections.flatMap((section) => section.fields);
  const storeRef = useRef<RenderProbeStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = createRenderProbeStore([
      "surface",
      ...fields.map((field) => `field:${field.id}`),
    ]);
  }
  const store = storeRef.current;

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.18),_transparent_32%),linear-gradient(180deg,_#f8fafc_0%,_#e2e8f0_100%)] px-4 py-8 text-slate-950 dark:bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.18),_transparent_28%),linear-gradient(180deg,_#020617_0%,_#0f172a_100%)] dark:text-slate-50">
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[minmax(0,1.35fr)_320px]">
        <section className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/85 shadow-2xl shadow-slate-900/10 backdrop-blur dark:border-slate-800 dark:bg-slate-950/70">
          <div className="border-b border-slate-200/80 px-6 py-5 dark:border-slate-800">
            <p className="text-xs uppercase tracking-[0.24em] text-cyan-700 dark:text-cyan-300">
              Schema-driven Milestone 4 proof
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">Address, tags, and relationships</h1>
                <p className="mt-1 max-w-2xl text-sm text-slate-600 dark:text-slate-300">
                  One focused surface combines direct company fields, nested <code>address</code>{" "}
                  leaves, unordered <code>tags</code>, and reference-aware <code>person.worksAt</code>{" "}
                  editing through typed predicate refs.
                </p>
              </div>
              <div className="flex gap-2 text-xs text-slate-500 dark:text-slate-400">
                <a className="rounded-full border border-current/20 px-3 py-1" href="?surface=query">
                  Query proof
                </a>
                <a
                  className="rounded-full border border-current/20 px-3 py-1"
                  href="?surface=relationships"
                >
                  Relationship focus
                </a>
                <a className="rounded-full border border-current/20 px-3 py-1" href="?surface=explorer">
                  Explorer
                </a>
                <a className="rounded-full border border-current/20 px-3 py-1" href="?surface=outliner">
                  Outliner
                </a>
              </div>
            </div>
          </div>
          <CompanyProofFields sections={sections} store={store} />
        </section>
        <CompanyProofInstrumentation company={company} fields={fields} person={person} store={store} />
      </div>
    </main>
  );
}

export function CompanyProofPage() {
  const runtimeRef = useRef<ReturnType<typeof createExampleRuntime> | null>(null);
  if (!runtimeRef.current) {
    runtimeRef.current = createExampleRuntime();
  }

  const company = runtimeRef.current.graph.company.ref(runtimeRef.current.ids.acme);
  const person = runtimeRef.current.graph.person.ref(runtimeRef.current.ids.alice);
  return <CompanyProofSurface company={company} person={person} />;
}
