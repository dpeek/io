import { Profiler, useLayoutEffect, useRef, useSyncExternalStore } from "react";

import { app, core, createExampleRuntime, type EntityRef, type PredicateRef } from "#graph";

import { PredicateFieldEditor } from "./bindings.js";

type CompanyRef = EntityRef<typeof app.company, typeof app & typeof core>;

const companyFieldOrder = ["name", "status", "website", "foundedYear"] as const;

type CompanyFieldKey = (typeof companyFieldOrder)[number];

type CompanyFieldSpec = {
  id: CompanyFieldKey;
  label: string;
  helper: string;
  required: boolean;
  predicate: PredicateRef<any, any>;
};

type InvalidationCheck = {
  fieldId: CompanyFieldKey;
  changedIds: string[];
  holds: boolean;
};

type RenderProbeSnapshot = {
  counts: Readonly<Record<string, number>>;
  lastCheck?: InvalidationCheck;
};

type RenderProbeStore = {
  beginCheck(fieldId: CompanyFieldKey): void;
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

function getFieldHelper(predicate: PredicateRef<any, any>): string {
  const field = predicate.field as { cardinality: string; range: string };
  const required = field.cardinality === "one" ? "required" : "optional";
  const rangeValues = predicate.rangeType?.values as { key: string; name?: string } | undefined;
  const range = rangeValues?.name ?? rangeValues?.key ?? field.range;
  return `${required} ${range}`;
}

function getCompanyFieldSpecs(company: CompanyRef): CompanyFieldSpec[] {
  return companyFieldOrder.map((fieldId) => {
    const predicate = company.fields[fieldId];
    return {
      id: fieldId,
      label: getFieldLabel(predicate),
      helper: getFieldHelper(predicate),
      predicate,
      required: predicate.field.cardinality === "one",
    };
  });
}

function useRenderProbeSnapshot(store: RenderProbeStore): RenderProbeSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

function CompanyFieldRow({
  field,
  store,
}: {
  field: CompanyFieldSpec;
  store: RenderProbeStore;
}) {
  const probeId = `field:${field.id}`;
  return (
    <label
      className="grid gap-2 rounded-2xl border border-slate-300/80 bg-white/80 p-4 shadow-sm shadow-slate-900/5 backdrop-blur dark:border-slate-800 dark:bg-slate-950/70"
      data-proof-field={field.id}
      onChangeCapture={() => {
        store.beginCheck(field.id);
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{field.label}</span>
        <span className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
          {field.required ? "Required" : "Optional"}
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
    </label>
  );
}

function useCommitProbe(id: string, store: RenderProbeStore) {
  useLayoutEffect(() => {
    store.recordCommit(id);
  });
}

function CompanyProofFields({
  fields,
  store,
}: {
  fields: readonly CompanyFieldSpec[];
  store: RenderProbeStore;
}) {
  useCommitProbe("surface", store);

  return (
    <div className="grid gap-4 px-6 py-6 md:grid-cols-2">
      {fields.map((field) => (
        <CompanyFieldRow field={field} key={field.id} store={store} />
      ))}
    </div>
  );
}

function CompanyProofInstrumentation({
  fields,
  store,
}: {
  fields: readonly CompanyFieldSpec[];
  store: RenderProbeStore;
}) {
  const snapshot = useRenderProbeSnapshot(store);
  const changedLabels = snapshot.lastCheck?.changedIds.map((id) =>
    id === "surface" ? "surface" : id.replace("field:", ""),
  );

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
    </aside>
  );
}

export function CompanyProofSurface({
  company,
}: {
  company: CompanyRef;
}) {
  const fields = getCompanyFieldSpecs(company);
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
              Schema-driven web proof
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">Company editor</h1>
                <p className="mt-1 max-w-2xl text-sm text-slate-600 dark:text-slate-300">
                  Generated from typed predicate refs for <code>name</code>, <code>status</code>,{" "}
                  <code>website</code>, and optional <code>foundedYear</code>.
                </p>
              </div>
              <div className="flex gap-2 text-xs text-slate-500 dark:text-slate-400">
                <a className="rounded-full border border-current/20 px-3 py-1" href="?surface=explorer">
                  Explorer
                </a>
                <a className="rounded-full border border-current/20 px-3 py-1" href="?surface=outliner">
                  Outliner
                </a>
              </div>
            </div>
          </div>
          <CompanyProofFields fields={fields} store={store} />
        </section>
        <CompanyProofInstrumentation fields={fields} store={store} />
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
  return <CompanyProofSurface company={company} />;
}
