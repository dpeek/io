import type { WorkflowReviewLiveSync } from "./workflow-review-live-sync.js";

export type WorkflowReviewRefreshLoopOptions = {
  readonly liveSync: WorkflowReviewLiveSync;
  readonly onRefresh: () => void;
  readonly onError?: (error: unknown) => void;
  readonly pollIntervalMs?: number;
};

export type WorkflowReviewRefreshLoopHandle = {
  stop(): Promise<void>;
};

const defaultPollIntervalMs = 5_000;

export async function startWorkflowReviewRefreshLoop({
  liveSync,
  onError,
  onRefresh,
  pollIntervalMs = defaultPollIntervalMs,
}: WorkflowReviewRefreshLoopOptions): Promise<WorkflowReviewRefreshLoopHandle> {
  let stopped = false;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let settlePoll: Promise<void> = Promise.resolve();

  const schedulePoll = () => {
    if (stopped) {
      return;
    }
    pollTimer = setTimeout(runPoll, pollIntervalMs);
  };

  const runPoll = () => {
    settlePoll = (async () => {
      try {
        const result = await liveSync.poll();
        if (stopped) {
          return;
        }
        if (result.action !== "none") {
          onRefresh();
        }
      } catch (error) {
        if (!stopped) {
          onError?.(error);
        }
      } finally {
        schedulePoll();
      }
    })();
  };

  await liveSync.register();
  schedulePoll();

  return {
    async stop() {
      stopped = true;
      if (pollTimer) {
        clearTimeout(pollTimer);
      }
      await settlePoll;
      await liveSync.remove();
    },
  };
}
