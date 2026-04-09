import { Badge } from "@io/web/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@io/web/card";
import { Empty, EmptyDescription } from "@io/web/empty";

import type { ExplorerSync } from "./model.js";
import {
  describeSyncError,
  formatPendingTransactionSummary,
  formatRetainedHistoryPolicy,
  formatScopedTransactionLabel,
  formatStreamActivityDetail,
  formatStreamActivityTitle,
  streamActivityClass,
  syncStatusClass,
  useExplorerSyncSnapshot,
} from "./sync.js";

export function ExplorerSyncInspector({ sync }: { sync: ExplorerSync }) {
  const { pendingTransactions, state } = useExplorerSyncSnapshot(sync);
  const recentActivities = [...state.recentActivities].reverse();
  const errorMessage = describeSyncError(state.error);

  return (
    <Card className="border-border/70 bg-card/95 flex h-full min-h-0 flex-col border shadow-sm">
      <CardHeader className="border-border/60 border-b">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <CardTitle>Branch</CardTitle>
          </div>
          <Badge
            className={syncStatusClass(state.status)}
            data-explorer-stream-status={state.status}
            variant="outline"
          >
            {state.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-4" data-explorer-stream="">
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline">{state.cursor ?? "no cursor"}</Badge>
          <Badge variant="outline">{state.freshness}</Badge>
          <Badge variant="outline">{state.completeness}</Badge>
          <Badge
            className={
              pendingTransactions.length > 0
                ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
            }
            data-explorer-stream-pending-count={String(pendingTransactions.length)}
            variant="outline"
          >
            {pendingTransactions.length} pending
          </Badge>
        </div>

        {errorMessage ? (
          <div
            className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-100"
            data-explorer-stream-error={state.status}
          >
            {errorMessage}
          </div>
        ) : null}

        <div className="grid gap-2 text-sm text-slate-400">
          <div className="flex items-center justify-between gap-3">
            <span>Cursor</span>
            <code className="text-xs text-slate-200" data-explorer-stream-cursor="">
              {state.cursor ?? "unset"}
            </code>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span>Last sync</span>
            <span data-explorer-stream-last-sync="">
              {state.lastSyncedAt ? "captured" : "not yet"}
            </span>
          </div>
          {state.diagnostics ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <span>Retained base</span>
                <code
                  className="text-xs text-slate-200"
                  data-explorer-stream-retained-base-cursor=""
                >
                  {state.diagnostics.retainedBaseCursor}
                </code>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Retention</span>
                <span data-explorer-stream-retained-history-policy="">
                  {formatRetainedHistoryPolicy(state.diagnostics.retainedHistoryPolicy)}
                </span>
              </div>
            </>
          ) : null}
        </div>

        <div className="space-y-2">
          <div className="text-xs font-medium tracking-[0.16em] text-slate-500 uppercase">
            Pending Writes
          </div>
          {pendingTransactions.length > 0 ? (
            <div className="space-y-2">
              {pendingTransactions.map((transaction) => (
                <div
                  className="rounded-2xl border border-slate-800 bg-slate-950/80 p-3"
                  data-explorer-stream-pending-tx={transaction.id}
                  key={transaction.id}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <code className="text-xs text-slate-200">{transaction.id}</code>
                    <Badge variant="outline">{formatPendingTransactionSummary(transaction)}</Badge>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty className="border-border bg-muted/20 flex-none p-4">
              <EmptyDescription className="text-sm">
                Local optimistic writes are fully reconciled.
              </EmptyDescription>
            </Empty>
          )}
        </div>

        <div className="space-y-2">
          <div className="text-xs font-medium tracking-[0.16em] text-slate-500 uppercase">
            Recent Activity
          </div>
          {recentActivities.length > 0 ? (
            <div className="space-y-2">
              {recentActivities.map((activity, index) => (
                <div
                  className="rounded-2xl border border-slate-800 bg-slate-950/80 p-3"
                  data-explorer-stream-activity={activity.kind}
                  key={`${activity.kind}:${activity.cursor}:${activity.at.getTime()}:${index}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="text-sm font-medium text-slate-100">
                        {formatStreamActivityTitle(activity)}
                      </div>
                      <div className="text-xs text-slate-400">
                        {formatStreamActivityDetail(activity)}
                      </div>
                    </div>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <Badge className={streamActivityClass(activity.kind)} variant="outline">
                        {activity.kind}
                      </Badge>
                      <Badge variant="outline">{activity.freshness}</Badge>
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {activity.kind === "incremental"
                      ? activity.txIds.map((txId, index) => {
                          const writeScope = activity.writeScopes[index];

                          return (
                            <Badge
                              className="border-cyan-500/20 bg-cyan-500/5 tracking-normal text-cyan-100 normal-case"
                              data-explorer-stream-activity-tx={txId}
                              {...(writeScope
                                ? { "data-explorer-stream-activity-write-scope": writeScope }
                                : {})}
                              key={txId}
                              variant="outline"
                            >
                              {writeScope ? formatScopedTransactionLabel(txId, writeScope) : txId}
                            </Badge>
                          );
                        })
                      : null}
                    {activity.kind === "write" ? (
                      <Badge
                        className="border-emerald-500/20 bg-emerald-500/5 tracking-normal text-emerald-100 normal-case"
                        data-explorer-stream-activity-tx={activity.txId}
                        data-explorer-stream-activity-write-scope={activity.writeScope}
                        variant="outline"
                      >
                        {formatScopedTransactionLabel(activity.txId, activity.writeScope)}
                      </Badge>
                    ) : null}
                    {activity.kind === "fallback" ? (
                      <Badge
                        className="border-rose-500/20 bg-rose-500/5 tracking-normal text-rose-100 normal-case"
                        variant="outline"
                      >
                        {activity.fallbackReason}
                      </Badge>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty className="border-border bg-muted/20 flex-none p-4">
              <EmptyDescription className="text-sm">
                No authoritative delivery has been observed yet.
              </EmptyDescription>
            </Empty>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
