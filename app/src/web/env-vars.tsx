import { useState } from "react";

import {
  envVarNameRequiredMessage,
  newEnvVarSecretRequiredMessage,
  type SaveEnvVarInput,
  type SaveEnvVarResult,
} from "../env-vars.js";
import { type AppRuntime, useAppRuntime } from "./runtime.js";
import { hrefForAppRoute } from "./routes.js";

type EnvVarRouteRuntime = Pick<AppRuntime, "graph"> & {
  readonly sync: {
    sync(): Promise<unknown>;
  };
};

type EnvVarSummary = {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly updatedAt?: Date;
  readonly secretId?: string;
  readonly secretVersion?: number;
  readonly lastRotatedAt?: Date;
};

type EnvVarDraft = {
  readonly description: string;
  readonly name: string;
  readonly secretValue: string;
};

function trimOptionalString(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function listEnvVars(graph: EnvVarRouteRuntime["graph"]): EnvVarSummary[] {
  return graph.envVar
    .list()
    .map((envVar) => {
      const secret = envVar.secret ? graph.secretRef.get(envVar.secret) : undefined;
      return {
        id: envVar.id,
        name: envVar.name,
        description: envVar.description,
        updatedAt: envVar.updatedAt,
        secretId: envVar.secret,
        secretVersion: secret?.version,
        lastRotatedAt: secret?.lastRotatedAt,
      } satisfies EnvVarSummary;
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function createEnvVarDraft(summary?: EnvVarSummary): EnvVarDraft {
  return {
    description: summary?.description ?? "",
    name: summary?.name ?? "",
    secretValue: "",
  };
}

function formatTimestamp(value: Date | undefined): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "Not recorded";
  return value.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

async function postEnvVarMutation(input: SaveEnvVarInput): Promise<SaveEnvVarResult> {
  const response = await fetch("/api/env-vars", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });

  const payload = (await response.json().catch(() => undefined)) as
    | { readonly error?: string }
    | SaveEnvVarResult
    | undefined;

  if (!response.ok) {
    throw new Error(
      typeof payload === "object" && payload && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : `Env-var save failed with ${response.status} ${response.statusText}.`,
    );
  }

  return payload as SaveEnvVarResult;
}

export function EnvVarSettingsSurface({
  runtime,
  submitEnvVar = postEnvVarMutation,
}: {
  readonly runtime?: EnvVarRouteRuntime;
  readonly submitEnvVar?: (input: SaveEnvVarInput) => Promise<SaveEnvVarResult>;
}) {
  const resolvedRuntime = runtime ?? useAppRuntime();
  const [mode, setMode] = useState<
    { readonly kind: "edit"; readonly id: string } | { readonly kind: "new" }
  >(() => {
    const seededEnvVar = listEnvVars(resolvedRuntime.graph)[0];
    return seededEnvVar ? { kind: "edit", id: seededEnvVar.id } : { kind: "new" };
  });
  const [draft, setDraft] = useState<EnvVarDraft>(() => {
    const seededEnvVar = listEnvVars(resolvedRuntime.graph)[0];
    return createEnvVarDraft(seededEnvVar);
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const envVars = listEnvVars(resolvedRuntime.graph);
  const selected =
    mode.kind === "edit" ? envVars.find((envVar) => envVar.id === mode.id) : undefined;

  async function handleSubmit() {
    const name = draft.name.trim();
    const description = trimOptionalString(draft.description);
    const secretValue = trimOptionalString(draft.secretValue);

    if (!name) {
      setError(envVarNameRequiredMessage);
      setStatus("");
      return;
    }
    if (mode.kind === "new" && !secretValue) {
      setError(newEnvVarSecretRequiredMessage);
      setStatus("");
      return;
    }

    setBusy(true);
    setError("");
    setStatus("");

    try {
      const result = await submitEnvVar({
        id: mode.kind === "edit" ? mode.id : undefined,
        name,
        description,
        secretValue,
      });
      await resolvedRuntime.sync.sync();

      const nextSummary = listEnvVars(resolvedRuntime.graph).find(
        (envVar) => envVar.id === result.envVarId,
      );
      setMode({ kind: "edit", id: result.envVarId });
      setDraft(createEnvVarDraft(nextSummary));
      setStatus(
        result.created
          ? `Created ${name}.`
          : result.rotated
            ? `Rotated secret for ${name}.`
            : `Saved ${name}.`,
      );
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.14),_transparent_30%),radial-gradient(circle_at_bottom_right,_rgba(249,115,22,0.14),_transparent_34%),linear-gradient(180deg,_#f8fafc_0%,_#e2e8f0_100%)] px-4 py-8 text-slate-950">
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="grid gap-4 rounded-[2rem] border border-white/80 bg-white/88 p-5 shadow-2xl shadow-slate-900/10 backdrop-blur">
          <div className="space-y-2">
            <p className="text-xs tracking-[0.24em] text-cyan-700 uppercase">Operator settings</p>
            <h1 className="text-2xl font-semibold tracking-tight">Environment variables</h1>
            <p className="text-sm text-slate-600">
              The client graph only sees safe metadata. Secret plaintext stays behind the authority
              route and never rehydrates into the browser runtime.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-slate-500">
            <a
              className="rounded-full border border-current/20 px-3 py-1"
              href={hrefForAppRoute("company")}
            >
              Company
            </a>
            <a
              className="rounded-full border border-current/20 px-3 py-1"
              href={hrefForAppRoute("explorer")}
            >
              Explorer
            </a>
          </div>
          <button
            className="rounded-2xl border border-cyan-300/80 bg-cyan-50 px-4 py-3 text-left text-sm font-medium text-cyan-950"
            data-env-var-new="button"
            onClick={() => {
              setMode({ kind: "new" });
              setDraft(createEnvVarDraft());
              setError("");
              setStatus("");
            }}
            type="button"
          >
            New variable
          </button>
          <div className="grid gap-2">
            {envVars.length === 0 ? (
              <div
                className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500"
                data-env-var-empty="true"
              >
                No environment variables yet.
              </div>
            ) : (
              envVars.map((envVar) => {
                const active = mode.kind === "edit" && mode.id === envVar.id;
                return (
                  <button
                    key={envVar.id}
                    className={`grid gap-1 rounded-2xl border px-4 py-3 text-left text-sm ${
                      active
                        ? "border-cyan-500 bg-cyan-50 text-cyan-950"
                        : "border-slate-200 bg-white text-slate-700"
                    }`}
                    data-env-var-item={envVar.id}
                    onClick={() => {
                      setMode({ kind: "edit", id: envVar.id });
                      setDraft(createEnvVarDraft(envVar));
                      setError("");
                      setStatus("");
                    }}
                    type="button"
                  >
                    <span className="font-medium">{envVar.name}</span>
                    <span className="text-xs text-slate-500">
                      {envVar.secretId ? `v${envVar.secretVersion ?? 1}` : "No secret set"}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </aside>
        <section className="overflow-hidden rounded-[2rem] border border-white/80 bg-white/90 shadow-2xl shadow-slate-900/10 backdrop-blur">
          <div className="border-b border-slate-200/80 px-6 py-5">
            <p className="text-xs tracking-[0.24em] text-orange-700 uppercase">
              Authority-backed mutation
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">
                  {mode.kind === "new" ? "Create env var" : selected?.name ?? "Edit env var"}
                </h2>
                <p className="mt-1 max-w-2xl text-sm text-slate-600">
                  Listing and metadata live in the synced graph. Secret value writes cross one
                  explicit server route and sync back as opaque state only.
                </p>
              </div>
              <div
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600"
                data-env-var-form-mode={mode.kind}
              >
                {mode.kind === "new" ? "create" : "edit"}
              </div>
            </div>
          </div>
          <div className="grid gap-6 px-6 py-6 lg:grid-cols-[minmax(0,1fr)_280px]">
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                void handleSubmit();
              }}
            >
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-slate-900">Variable name</span>
                <input
                  className="rounded-2xl border border-slate-300 bg-white px-4 py-3"
                  data-env-var-input="name"
                  onChange={(event) => {
                    setDraft((current) => ({ ...current, name: event.target.value }));
                  }}
                  placeholder="OPENAI_API_KEY"
                  value={draft.name}
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-slate-900">Description</span>
                <textarea
                  className="min-h-32 rounded-2xl border border-slate-300 bg-white px-4 py-3"
                  data-env-var-input="description"
                  onChange={(event) => {
                    setDraft((current) => ({ ...current, description: event.target.value }));
                  }}
                  placeholder="Primary operator credential for model calls"
                  value={draft.description}
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-slate-900">
                  {mode.kind === "new" ? "Secret value" : "Rotate secret"}
                </span>
                <input
                  className="rounded-2xl border border-slate-300 bg-white px-4 py-3"
                  data-env-var-input="secret"
                  onChange={(event) => {
                    setDraft((current) => ({ ...current, secretValue: event.target.value }));
                  }}
                  placeholder={
                    mode.kind === "new"
                      ? "Paste the plaintext value once"
                      : "Leave blank to keep the current secret"
                  }
                  type="password"
                  value={draft.secretValue}
                />
              </label>
              {error ? (
                <p
                  className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900"
                  data-env-var-error="true"
                >
                  {error}
                </p>
              ) : null}
              {status ? (
                <p
                  className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
                  data-env-var-status="true"
                >
                  {status}
                </p>
              ) : null}
              <button
                className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-400"
                data-env-var-submit="button"
                disabled={busy}
                type="submit"
              >
                {busy ? "Saving..." : mode.kind === "new" ? "Create variable" : "Save changes"}
              </button>
            </form>
            <aside className="grid gap-3 rounded-[1.6rem] border border-slate-200 bg-slate-50/90 p-4">
              <div>
                <p className="text-sm font-medium text-slate-900">Replicated metadata</p>
                <p className="mt-1 text-xs text-slate-500">
                  This is the safe graph slice the browser can inspect after sync.
                </p>
              </div>
              <div className="grid gap-2 text-sm text-slate-700">
                <div className="flex items-center justify-between gap-3">
                  <span>Secret status</span>
                  <span data-env-var-secret-status="">
                    {selected?.secretId ? "Present" : "Missing"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Secret version</span>
                  <span data-env-var-secret-version="">
                    {selected?.secretVersion === undefined ? "Not set" : `v${selected.secretVersion}`}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Last rotated</span>
                  <span data-env-var-last-rotated="">
                    {formatTimestamp(selected?.lastRotatedAt)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Updated</span>
                  <span data-env-var-updated-at="">{formatTimestamp(selected?.updatedAt)}</span>
                </div>
              </div>
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-3 py-3 text-xs text-slate-500">
                Plaintext never appears in this panel, the synced graph payload, or the generic
                explorer unless an explicit authority policy is added later.
              </div>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}

export function EnvVarSettingsPage() {
  return <EnvVarSettingsSurface />;
}
