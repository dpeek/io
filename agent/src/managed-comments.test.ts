import { expect, test } from "bun:test";

import {
  hashManagedCommentBody,
  parseManagedComment,
  renderManagedCommentReply,
} from "./managed-comments.js";

const issue = {
  blockedBy: [],
  createdAt: "2024-01-01T00:00:00.000Z",
  description: "",
  hasChildren: false,
  hasParent: false,
  id: "issue-1",
  identifier: "OPE-126",
  labels: ["io", "agent"],
  priority: 2,
  state: "Todo",
  title: "Managed stream",
  updatedAt: "2024-01-01T00:00:00.000Z",
};

test("parseManagedComment accepts the stable line plus YAML shape", () => {
  const parsed = parseManagedComment({
    body: `@io backlog
docs:
  - ./llm/topic/goals.md
dryRun: true
note: refresh`,
    commentId: "comment-1",
    createdAt: "2024-01-02T00:00:00.000Z",
    issue,
    updatedAt: "2024-01-02T00:00:00.000Z",
  });

  expect(parsed).toEqual({
    body: `@io backlog
docs:
  - ./llm/topic/goals.md
dryRun: true
note: refresh`,
    bodyHash: hashManagedCommentBody(`@io backlog
docs:
  - ./llm/topic/goals.md
dryRun: true
note: refresh`),
    command: "backlog",
    commentId: "comment-1",
    createdAt: "2024-01-02T00:00:00.000Z",
    issue,
    payload: {
      docs: ["./llm/topic/goals.md"],
      dryRun: true,
      note: "refresh",
    },
    updatedAt: "2024-01-02T00:00:00.000Z",
  });
});

test("parseManagedComment rejects unknown YAML keys", () => {
  const parsed = parseManagedComment({
    body: `@io status
invalid: true`,
    commentId: "comment-2",
    createdAt: "2024-01-02T00:00:00.000Z",
    issue,
    updatedAt: "2024-01-02T00:00:00.000Z",
  });

  expect(parsed).toMatchObject({
    commentId: "comment-2",
    error: "Unknown top-level keys: invalid.",
  });
});

test("renderManagedCommentReply keeps the stable operator-facing shape", () => {
  expect(
    renderManagedCommentReply({
      command: "backlog",
      issueIdentifier: "OPE-126",
      lines: ["Updated the parent managed brief."],
      result: "updated",
    }),
  ).toBe(`<!-- io-managed:comment-result -->
Command: backlog
Result: updated
Target: OPE-126

- Updated the parent managed brief.`);
});
