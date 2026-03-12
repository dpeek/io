import { expect, test } from "bun:test";
import { resolve } from "node:path";

import {
  MANAGED_BACKLOG_PROPOSAL_END,
  MANAGED_BACKLOG_PROPOSAL_START,
  rewriteManagedBacklogDescription,
} from "./backlog-proposal.js";
import type { AgentIssue, ResolvedContextBundle, Workflow } from "./types.js";

function createIssue(description: string): AgentIssue {
  return {
    blockedBy: [],
    createdAt: "2024-01-01T00:00:00.000Z",
    description,
    hasChildren: false,
    hasParent: false,
    id: "1",
    identifier: "OPE-127",
    labels: ["io", "agent"],
    priority: 2,
    projectSlug: "io",
    state: "Todo",
    title: "Managed backlog proposal",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };
}

function createWorkflow(root: string): Pick<Workflow, "modules"> {
  return {
    modules: {
      agent: {
        allowedSharedPaths: [resolve(root, "io", "topic")],
        docs: ["./agent/io/goals.md"],
        id: "agent",
        path: resolve(root, "agent"),
      },
    },
  };
}

function createBundle(root: string): ResolvedContextBundle {
  return {
    docs: [
      {
        content: `# Project Overview

## What Has Landed

- typed repo config in \`io.ts\`
- built-in docs, profiles, and issue routing
- retained runtime state and stream-based worktree orchestration

## When changing this repo

- keep runtime behavior, repo docs, and tests in sync
- prefer the smallest change that still proves the contract end to end
`,
        id: "project.overview",
        label: "project.overview",
        order: 1,
        overridden: false,
        path: resolve(root, "io", "overview.md"),
        source: "registered",
      },
      {
        content: `# IO Agent Stream

## Current Focus

- improve operator utility
- improve planning and context quality

## Good Changes In This Stream

- quality of backlog/spec refinement
- automatic creation of better child-task structure
`,
        id: "./agent/io/goals.md",
        label: "./agent/io/goals.md",
        order: 2,
        overridden: false,
        path: resolve(root, "io", "goals.md"),
        source: "repo-path",
      },
    ],
  };
}

test("rewriteManagedBacklogDescription appends a stable managed brief on first write", () => {
  const root = "/repo";
  const description = `## Outcome

Turn a fresh parent issue into a durable planning brief.

## Deliverables

- define stable managed sections
- implement proposal generation in the backlog path
- preserve human-authored decisions on rerun

## Notes

- Keep it useful, not verbose.
`;

  const rewritten = rewriteManagedBacklogDescription({
    bundle: createBundle(root),
    issue: createIssue(description),
    repoRoot: root,
    workflow: createWorkflow(root),
  });

  expect(rewritten.startsWith("## Outcome")).toBe(true);
  expect(rewritten).toContain(MANAGED_BACKLOG_PROPOSAL_START);
  expect(rewritten).toContain("## Managed Brief");
  expect(rewritten).toContain("### Current Module State");
  expect(rewritten).toContain("typed repo config in `io.ts`");
  expect(rewritten).toContain("### Constraints");
  expect(rewritten).toContain("Keep it useful, not verbose.");
  expect(rewritten).toContain("### Work Options");
  expect(rewritten).toContain("1. **Define stable managed sections**");
  expect(rewritten).toContain("2. **Implement proposal generation in the backlog");
  expect(rewritten).toContain("Alignment: quality of backlog/spec refinement");
  expect(rewritten.trimEnd().endsWith(MANAGED_BACKLOG_PROPOSAL_END)).toBe(true);
});

test("rewriteManagedBacklogDescription rewrites only the managed block on rerun", () => {
  const root = "/repo";
  const original = `## Outcome

Turn a fresh parent issue into a durable planning brief.

${MANAGED_BACKLOG_PROPOSAL_START}
## Managed Brief

### Current Module State
- old state

### Constraints
- old constraint

### Work Options
1. **Old option**
   Focus: old focus
   Alignment: old alignment
${MANAGED_BACKLOG_PROPOSAL_END}

## Decisions

- Keep the operator summary outside the managed block.
`;

  const rewritten = rewriteManagedBacklogDescription({
    bundle: createBundle(root),
    issue: createIssue(original),
    repoRoot: root,
    workflow: createWorkflow(root),
  });

  expect(rewritten.split(MANAGED_BACKLOG_PROPOSAL_START)).toHaveLength(2);
  expect(rewritten).not.toContain("old state");
  expect(rewritten).not.toContain("old option");
  expect(rewritten).toContain("## Decisions");
  expect(rewritten).toContain("Keep the operator summary outside the managed block.");
  expect(rewritten).toContain("quality of backlog/spec refinement");
  expect(rewritten.indexOf(MANAGED_BACKLOG_PROPOSAL_START)).toBeLessThan(
    rewritten.indexOf("## Decisions"),
  );
});
