import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { HandledManagedComment, ManagedCommentState, ManagedCommentTrigger } from "./types.js";
import { resolveIssueRuntimePath } from "./workspace.js";

const COMMENT_STATE_FILENAME = "comment-state.json";

function resolveCommentStatePath(rootDir: string, issueIdentifier: string) {
  return resolve(resolveIssueRuntimePath(rootDir, issueIdentifier), COMMENT_STATE_FILENAME);
}

export async function readManagedCommentState(rootDir: string, issueIdentifier: string) {
  try {
    const text = await readFile(resolveCommentStatePath(rootDir, issueIdentifier), "utf8");
    const parsed = JSON.parse(text) as ManagedCommentState;
    return {
      comments: Array.isArray(parsed.comments) ? parsed.comments : [],
    } satisfies ManagedCommentState;
  } catch {
    return { comments: [] } satisfies ManagedCommentState;
  }
}

export function hasHandledManagedComment(
  state: ManagedCommentState,
  trigger: Pick<ManagedCommentTrigger, "bodyHash" | "commentId">,
) {
  return state.comments.some(
    (entry) => entry.commentId === trigger.commentId && entry.bodyHash === trigger.bodyHash,
  );
}

export async function recordHandledManagedComment(
  rootDir: string,
  issueIdentifier: string,
  trigger: Pick<ManagedCommentTrigger, "bodyHash" | "commentId">,
  handledAt = new Date().toISOString(),
) {
  const runtimePath = resolveIssueRuntimePath(rootDir, issueIdentifier);
  await mkdir(runtimePath, { recursive: true });

  const state = await readManagedCommentState(rootDir, issueIdentifier);
  const retained = state.comments.filter((entry) => entry.commentId !== trigger.commentId);
  const next: ManagedCommentState = {
    comments: [...retained, { bodyHash: trigger.bodyHash, commentId: trigger.commentId, handledAt }]
      .sort((left, right) => left.handledAt.localeCompare(right.handledAt))
      .slice(-200),
  };

  await writeFile(
    resolveCommentStatePath(rootDir, issueIdentifier),
    JSON.stringify(next, null, 2),
    "utf8",
  );
  return next;
}

export function listHandledManagedComments(state: ManagedCommentState): HandledManagedComment[] {
  return [...state.comments];
}
