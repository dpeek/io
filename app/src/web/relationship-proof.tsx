import { useRef } from "react";

import { app, core, createExampleRuntime, type EntityRef } from "#graph";

import { PredicateFieldEditor, PredicateFieldView } from "./bindings.js";
import { usePredicateField } from "./predicate.js";

type PersonRef = EntityRef<typeof app.person, typeof app & typeof core>;

function RelationshipProofSidebar({
  person,
}: {
  person: PersonRef;
}) {
  const name = usePredicateField(person.fields.name).value;
  const worksAt = usePredicateField(person.fields.worksAt).value;
  const linkedIds = Array.isArray(worksAt) ? worksAt : [];

  return (
    <aside className="space-y-4 rounded-[1.75rem] border border-white/10 bg-slate-950 px-5 py-4 text-slate-100 shadow-xl shadow-slate-900/15">
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-[0.24em] text-cyan-300">Reference policy</p>
        <h2 className="text-lg font-semibold">{typeof name === "string" ? name : person.id}</h2>
        <p className="text-sm text-slate-300">
          Existing companies can be linked and unlinked directly from the typed relationship field.
        </p>
      </div>
      <div className="grid gap-2 rounded-2xl border border-white/10 bg-white/5 p-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="text-slate-300">selection</span>
          <code>existing-only</code>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-slate-300">create-and-link</span>
          <code>follow-up</code>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-slate-300">linked entities</span>
          <span>{linkedIds.length}</span>
        </div>
      </div>
      <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs text-slate-300">
        <p className="uppercase tracking-[0.2em] text-slate-400">Current entity ids</p>
        <p>{linkedIds.length ? linkedIds.join(", ") : "none"}</p>
      </div>
    </aside>
  );
}

export function RelationshipProofSurface({
  person,
}: {
  person: PersonRef;
}) {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.18),_transparent_32%),linear-gradient(180deg,_#f8fafc_0%,_#dbeafe_100%)] px-4 py-8 text-slate-950 dark:bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.18),_transparent_28%),linear-gradient(180deg,_#020617_0%,_#0f172a_100%)] dark:text-slate-50">
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[minmax(0,1.35fr)_320px]">
        <section className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/85 shadow-2xl shadow-slate-900/10 backdrop-blur dark:border-slate-800 dark:bg-slate-950/70">
          <div className="border-b border-slate-200/80 px-6 py-5 dark:border-slate-800">
            <p className="text-xs uppercase tracking-[0.24em] text-cyan-700 dark:text-cyan-300">
              Entity-reference proof
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">Person relationships</h1>
                <p className="mt-1 max-w-2xl text-sm text-slate-600 dark:text-slate-300">
                  <code>person.worksAt</code> stays reference-aware: it links existing companies by
                  entity id instead of rendering like an embedded object editor.
                </p>
              </div>
              <div className="flex gap-2 text-xs text-slate-500 dark:text-slate-400">
                <a className="rounded-full border border-current/20 px-3 py-1" href="/">
                  Company
                </a>
                <a
                  className="rounded-full border border-current/20 px-3 py-1"
                  href="?surface=explorer"
                >
                  Explorer
                </a>
                <a
                  className="rounded-full border border-current/20 px-3 py-1"
                  href="?surface=outliner"
                >
                  Outliner
                </a>
              </div>
            </div>
          </div>
          <div className="grid gap-4 px-6 py-6 md:grid-cols-2">
            <section className="grid gap-3 rounded-[1.5rem] border border-slate-200/80 bg-slate-50/90 p-4 dark:border-slate-800 dark:bg-slate-900/50">
              <div>
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  Current linked companies
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  View output stays on relationship identities and company labels.
                </p>
              </div>
              <PredicateFieldView predicate={person.fields.worksAt} />
            </section>
            <section className="grid gap-3 rounded-[1.5rem] border border-slate-200/80 bg-slate-50/90 p-4 dark:border-slate-800 dark:bg-slate-900/50">
              <div>
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  Edit related companies
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Select and remove existing companies. Inline creation stays out of scope here.
                </p>
              </div>
              <PredicateFieldEditor predicate={person.fields.worksAt} />
            </section>
          </div>
        </section>
        <RelationshipProofSidebar person={person} />
      </div>
    </main>
  );
}

export function RelationshipProofPage() {
  const runtimeRef = useRef<ReturnType<typeof createExampleRuntime> | null>(null);
  if (!runtimeRef.current) {
    runtimeRef.current = createExampleRuntime();
  }

  const person = runtimeRef.current.graph.person.ref(runtimeRef.current.ids.alice);
  return <RelationshipProofSurface person={person} />;
}
