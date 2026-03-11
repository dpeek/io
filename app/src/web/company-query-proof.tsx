import { useRef, useState } from "react";

import {
  app,
  core,
  createExampleRuntime,
  type EntityRef,
  type PredicateRef,
} from "#graph";

import {
  FilterOperandEditor,
  compileWebFilterQuery,
  defaultWebFilterResolver,
  type ActiveWebFilterClause,
  type WebFieldFilterResolution,
  type WebFilterOperatorResolution,
} from "./bindings.js";
import { formatPredicateValue } from "./predicate.js";

type CompanyRef = EntityRef<typeof app.company, typeof app & typeof core>;
type AnyPredicate = PredicateRef<any, any>;
type AnyFilterResolution = Extract<WebFieldFilterResolution<any, any>, { status: "resolved" }>;
type AnyFilterOperator = WebFilterOperatorResolution<any, any, any>;
type AnyActiveClause = ActiveWebFilterClause<any, any, any>;

type QueryRowSpec = {
  helper: string;
  id: string;
  label: string;
  predicate: AnyPredicate;
  readValue: (company: CompanyRef) => unknown;
  resolution: AnyFilterResolution;
};

type QueryRowState = {
  operand: unknown;
  operatorKey: string;
};

function getFieldLabel(predicate: AnyPredicate): string {
  const field = predicate.field as { key: string; meta?: { label?: string } };
  return field.meta?.label ?? field.key;
}

function getFieldRangeLabel(predicate: AnyPredicate): string {
  const rangeValues = predicate.rangeType?.values as { key: string; name?: string } | undefined;
  return rangeValues?.name ?? rangeValues?.key ?? predicate.field.range;
}

function createQueryRowSpec(input: {
  id: string;
  predicate: AnyPredicate;
  readValue: (company: CompanyRef) => unknown;
}): QueryRowSpec {
  const resolution = defaultWebFilterResolver.resolvePredicate(input.predicate);
  if (resolution.status !== "resolved") {
    throw new Error(`Missing filter resolution for "${input.predicate.field.key}"`);
  }

  return {
    id: input.id,
    label: getFieldLabel(input.predicate),
    helper: `${getFieldRangeLabel(input.predicate)} • ${resolution.operators.length} operators`,
    predicate: input.predicate,
    readValue: input.readValue,
    resolution,
  };
}

function getCompanyQueryRows(company: CompanyRef): QueryRowSpec[] {
  return [
    createQueryRowSpec({
      id: "name",
      predicate: company.fields.name,
      readValue: (candidate) => candidate.fields.name.get(),
    }),
    createQueryRowSpec({
      id: "status",
      predicate: company.fields.status,
      readValue: (candidate) => candidate.fields.status.get(),
    }),
    createQueryRowSpec({
      id: "website",
      predicate: company.fields.website,
      readValue: (candidate) => candidate.fields.website.get(),
    }),
    createQueryRowSpec({
      id: "foundedYear",
      predicate: company.fields.foundedYear,
      readValue: (candidate) => candidate.fields.foundedYear.get(),
    }),
  ];
}

function createInitialRowState(rows: readonly QueryRowSpec[]): Record<string, QueryRowState> {
  return Object.fromEntries(
    rows.map((row) => [
      row.id,
      {
        operatorKey: row.resolution.defaultOperator,
        operand: undefined,
      },
    ]),
  );
}

function getRowState(row: QueryRowSpec, rowState: Record<string, QueryRowState>): QueryRowState {
  return (
    rowState[row.id] ?? {
      operatorKey: row.resolution.defaultOperator,
      operand: undefined,
    }
  );
}

function getActiveClauses(
  rows: readonly QueryRowSpec[],
  rowState: Record<string, QueryRowState>,
): AnyActiveClause[] {
  return rows.flatMap((row) => {
    const state = rowState[row.id];
    if (!state || state.operand === undefined) return [];

    const operator = row.resolution.resolveOperator(state.operatorKey as never);
    if (!operator) return [];

    return [
      {
        predicate: row.predicate,
        operator: operator as AnyFilterOperator,
        operand: state.operand,
      } satisfies AnyActiveClause,
    ];
  });
}

function renderCompanySummary(company: CompanyRef) {
  const name = company.fields.name.get();
  const status = formatPredicateValue(company.fields.status, company.fields.status.get());
  const website = company.fields.website.get();
  const foundedYear = company.fields.foundedYear.get();

  return {
    foundedYear: foundedYear === undefined ? "Unspecified" : String(foundedYear),
    name,
    status,
    website: website.toString(),
  };
}

function QueryFilterRow({
  row,
  state,
  onOperandChange,
  onOperatorChange,
}: {
  row: QueryRowSpec;
  state: QueryRowState;
  onOperandChange: (value: unknown) => void;
  onOperatorChange: (operatorKey: string) => void;
}) {
  const operator = row.resolution.resolveOperator(state.operatorKey as never);
  if (!operator) {
    return (
      <section
        className="grid gap-3 rounded-[1.4rem] border border-rose-300/70 bg-rose-50/80 p-4 text-sm text-rose-900"
        data-company-query-row={row.id}
      >
        <p>{row.label}</p>
        <p data-company-query-status="unsupported">unsupported operator</p>
      </section>
    );
  }

  return (
    <section
      className="grid gap-3 rounded-[1.4rem] border border-stone-300/80 bg-white/90 p-4 shadow-sm shadow-stone-900/5"
      data-company-query-predicate-id={row.predicate.predicateId}
      data-company-query-row={row.id}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-stone-950">{row.label}</p>
          <p className="text-xs text-stone-500">{row.helper}</p>
        </div>
        <code className="rounded-full bg-stone-100 px-2 py-1 text-[11px] text-stone-600">
          {row.predicate.field.key}
        </code>
      </div>
      <div className="grid gap-3 md:grid-cols-[180px_minmax(0,1fr)]">
        <label className="grid gap-1 text-xs uppercase tracking-[0.2em] text-stone-500">
          Operator
          <select
            className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm tracking-normal text-stone-950"
            data-company-query-control="operator"
            onChange={(event) => {
              onOperatorChange(event.target.value);
            }}
            value={state.operatorKey}
          >
            {row.resolution.operators.map((candidate) => (
              <option key={candidate.key} value={candidate.key}>
                {candidate.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs uppercase tracking-[0.2em] text-stone-500">
          Operand
          <div className="rounded-xl border border-stone-300 bg-white px-3 py-2">
            <FilterOperandEditor
              onChange={(value) => {
                onOperandChange(value);
              }}
              operator={operator as AnyFilterOperator}
              value={state.operand as never}
            />
          </div>
        </label>
      </div>
    </section>
  );
}

export function CompanyQueryProofSurface({
  companies,
  querySource,
}: {
  companies: readonly CompanyRef[];
  querySource: CompanyRef;
}) {
  const rows = getCompanyQueryRows(querySource);
  const [rowState, setRowState] = useState<Record<string, QueryRowState>>(() => createInitialRowState(rows));
  const activeClauses = getActiveClauses(rows, rowState);
  const runtime = compileWebFilterQuery<CompanyRef>({
    entityTypeKey: app.company.values.key,
    clauses: activeClauses,
    readValue(company, clause) {
      const row = rows.find((candidate) => candidate.predicate.field.key === clause.predicateKey);
      return row?.readValue(company);
    },
  });
  const matches = companies.filter((company) => runtime.matches(company));
  const loweredQuery = JSON.stringify(runtime.query, null, 2);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.18),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(16,185,129,0.16),_transparent_34%),linear-gradient(180deg,_#fafaf9_0%,_#e7e5e4_100%)] px-4 py-8 text-stone-950">
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[minmax(0,1.25fr)_340px]">
        <section className="overflow-hidden rounded-[2rem] border border-white/80 bg-white/85 shadow-2xl shadow-stone-900/10 backdrop-blur">
          <div className="border-b border-stone-200/80 px-6 py-5">
            <p className="text-xs uppercase tracking-[0.24em] text-emerald-700">Schema-driven Milestone 5 proof</p>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">Company query builder</h1>
                <p className="mt-1 max-w-2xl text-sm text-stone-600">
                  Filter rows resolve directly from <code>company.fields.*</code> predicate refs, reuse the generic
                  filter resolver, and lower into one small runtime query plan for the demo list below.
                </p>
              </div>
              <div className="flex gap-2 text-xs text-stone-500">
                <a className="rounded-full border border-current/20 px-3 py-1" href="?surface=query">
                  Query
                </a>
                <a className="rounded-full border border-current/20 px-3 py-1" href="?surface=company">
                  Company proof
                </a>
                <a className="rounded-full border border-current/20 px-3 py-1" href="?surface=explorer">
                  Explorer
                </a>
              </div>
            </div>
          </div>
          <div className="grid gap-6 px-6 py-6">
            <section className="grid gap-4">
              {rows.map((row) => {
                const currentState = getRowState(row, rowState);
                return (
                  <QueryFilterRow
                    key={row.id}
                    onOperandChange={(operand) => {
                      setRowState((current) => {
                        const nextState = getRowState(row, current);
                        return {
                          ...current,
                          [row.id]: {
                            ...nextState,
                            operand,
                          },
                        };
                      });
                    }}
                    onOperatorChange={(operatorKey) => {
                      setRowState((current) => ({
                        ...current,
                        [row.id]: {
                          operatorKey,
                          operand: undefined,
                        },
                      }));
                    }}
                    row={row}
                    state={currentState}
                  />
                );
              })}
            </section>
            <section className="grid gap-4 rounded-[1.6rem] border border-stone-200 bg-stone-50/85 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold tracking-tight">Matching companies</h2>
                  <p className="text-sm text-stone-600">
                    Active clauses: <span data-company-query-clause-count="">{runtime.query.clauses.length}</span>
                  </p>
                </div>
                <div
                  className="rounded-full bg-stone-900 px-3 py-1 text-xs uppercase tracking-[0.2em] text-stone-50"
                  data-company-query-match-count=""
                >
                  {matches.length} matches
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {matches.length ? (
                  matches.map((company) => {
                    const summary = renderCompanySummary(company);
                    return (
                      <article
                        className="grid gap-3 rounded-[1.25rem] border border-stone-200 bg-white p-4"
                        data-company-query-match={company.id}
                        key={company.id}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <h3 className="text-base font-semibold text-stone-950">{summary.name}</h3>
                          <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs text-emerald-800">
                            {summary.status}
                          </span>
                        </div>
                        <div className="grid gap-2 text-sm text-stone-600">
                          <div className="flex items-center justify-between gap-3">
                            <span>Founded</span>
                            <span>{summary.foundedYear}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span>Website</span>
                            <a className="text-emerald-700" href={summary.website}>
                              {summary.website}
                            </a>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span>Id</span>
                            <code className="text-xs text-stone-500">{company.id}</code>
                          </div>
                        </div>
                      </article>
                    );
                  })
                ) : (
                  <div
                    className="rounded-[1.25rem] border border-dashed border-stone-300 bg-white/80 p-6 text-sm text-stone-500 md:col-span-2"
                    data-company-query-empty=""
                  >
                    No companies match the active filter plan.
                  </div>
                )}
              </div>
            </section>
          </div>
        </section>
        <aside className="space-y-4 rounded-[2rem] border border-stone-900/10 bg-stone-950 px-5 py-4 text-stone-100 shadow-xl shadow-stone-900/15">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.24em] text-amber-300">Lowered query</p>
            <p className="text-sm text-stone-300">
              The demo compiles active filter rows into one <code>AND</code> plan keyed by predicate id and operator
              contract.
            </p>
          </div>
          <pre
            className="overflow-x-auto rounded-[1.5rem] border border-white/10 bg-white/5 p-4 text-xs text-stone-200"
            data-company-query-json=""
          >
            {loweredQuery}
          </pre>
          <div className="grid gap-3 rounded-[1.5rem] border border-white/10 bg-white/5 p-4 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-stone-300">entity type</span>
              <code>{runtime.query.entityTypeKey}</code>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-stone-300">combinator</span>
              <code>{runtime.query.combinator}</code>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-stone-300">sample ref</span>
              <code>{querySource.id}</code>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

export function CompanyQueryProofPage() {
  const runtimeRef = useRef<ReturnType<typeof createExampleRuntime> | null>(null);
  if (!runtimeRef.current) {
    runtimeRef.current = createExampleRuntime();
    runtimeRef.current.graph.company.create({
      name: "Atlas Labs",
      status: app.status.values.active.id,
      foundedYear: 2015,
      website: new URL("https://atlas.io"),
    });
  }

  const companies = runtimeRef.current.graph.company
    .list()
    .map(({ id }) => runtimeRef.current!.graph.company.ref(id));
  const querySource = runtimeRef.current.graph.company.ref(runtimeRef.current.ids.acme);

  return <CompanyQueryProofSurface companies={companies} querySource={querySource} />;
}
