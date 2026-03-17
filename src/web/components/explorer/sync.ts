import { GraphValidationError } from "@io/core/graph";
import { createContext, useEffect, useState } from "react";

import type { ExplorerSync, ExplorerSyncSnapshot } from "./model.js";

export const ExplorerSyncContext = createContext<ExplorerSync | null>(null);

export function useExplorerSyncSnapshot(sync: ExplorerSync): ExplorerSyncSnapshot {
  const [snapshot, setSnapshot] = useState<ExplorerSyncSnapshot>(() => ({
    pendingTransactions: sync.getPendingTransactions(),
    state: sync.getState(),
  }));

  useEffect(() => {
    function refresh(): void {
      setSnapshot({
        pendingTransactions: sync.getPendingTransactions(),
        state: sync.getState(),
      });
    }

    refresh();
    return sync.subscribe(refresh);
  }, [sync]);

  return snapshot;
}

export function syncStatusClass(status: ReturnType<ExplorerSync["getState"]>["status"]): string {
  if (status === "ready") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  if (status === "error") return "border-rose-500/30 bg-rose-500/10 text-rose-100";
  if (status === "pushing") return "border-cyan-500/30 bg-cyan-500/10 text-cyan-200";
  if (status === "syncing") return "border-sky-500/30 bg-sky-500/10 text-sky-200";
  return "border-slate-700 bg-slate-900 text-slate-300";
}

export function streamActivityClass(
  kind: ReturnType<ExplorerSync["getState"]>["recentActivities"][number]["kind"],
): string {
  if (kind === "fallback") return "border-rose-500/30 bg-rose-500/10 text-rose-100";
  if (kind === "incremental") return "border-cyan-500/30 bg-cyan-500/10 text-cyan-200";
  if (kind === "write") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  return "border-slate-700 bg-slate-900 text-slate-300";
}

export function formatPendingTransactionSummary(
  transaction: ExplorerSyncSnapshot["pendingTransactions"][number],
): string {
  let assertCount = 0;
  let retractCount = 0;

  for (const operation of transaction.ops) {
    if (operation.op === "assert") {
      assertCount += 1;
      continue;
    }
    retractCount += 1;
  }

  const parts: string[] = [];
  if (assertCount > 0) parts.push(`${assertCount} assert`);
  if (retractCount > 0) parts.push(`${retractCount} retract`);
  return parts.join(", ") || "0 ops";
}

export function formatStreamActivityTitle(
  activity: ExplorerSyncSnapshot["state"]["recentActivities"][number],
): string {
  if (activity.kind === "total") return "Total snapshot applied";
  if (activity.kind === "incremental") {
    return activity.transactionCount > 0
      ? `Incremental batch applied (${activity.transactionCount})`
      : "Incremental poll confirmed head cursor";
  }
  if (activity.kind === "write") return `Authoritative write applied (${activity.txId})`;
  return `Snapshot recovery required (${activity.reason})`;
}

export function formatStreamActivityDetail(
  activity: ExplorerSyncSnapshot["state"]["recentActivities"][number],
): string {
  if (activity.kind === "total") {
    return `cursor ${activity.cursor}`;
  }
  if (activity.kind === "incremental") {
    return `after ${activity.after} -> ${activity.cursor}`;
  }
  if (activity.kind === "write") {
    return activity.replayed ? `replayed at ${activity.cursor}` : `cursor ${activity.cursor}`;
  }
  return `after ${activity.after} -> ${activity.cursor}`;
}

export function describeSyncError(error: unknown): string | null {
  if (error instanceof GraphValidationError) {
    return error.result.issues[0]?.message ?? error.message;
  }
  if (error instanceof Error) return error.message;
  if (typeof error === "string" && error.length > 0) return error;
  return null;
}
