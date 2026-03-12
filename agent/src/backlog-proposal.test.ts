import { expect, test } from "bun:test";
import { resolve } from "node:path";

import { rewriteManagedBacklogDescription } from "./backlog-proposal.js";
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
        docs: ["./agent/io/overview.md"],
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

## Current vs Roadmap

Current code already improves operator utility and planning/context quality, while the remaining work is mostly around richer observability and operator tooling.

## Good Changes In This Stream

- quality of backlog/spec refinement
- automatic creation of better child-task structure
`,
        id: "./agent/io/overview.md",
        label: "./agent/io/overview.md",
        order: 2,
        overridden: false,
        path: resolve(root, "agent", "io", "overview.md"),
        source: "repo-path",
      },
    ],
  };
}

test("rewriteManagedBacklogDescription normalizes the parent description toward the shared template", () => {
  const root = "/repo";
  const description = `## Objective

Turn a fresh parent issue into a durable planning brief.

## Current Focus

- define stable managed sections
- implement proposal generation in the backlog path
- preserve human-authored decisions on rerun

## Constraints

- Keep it useful, not verbose.
`;

  const rewritten = rewriteManagedBacklogDescription({
    bundle: createBundle(root),
    issue: createIssue(description),
    repoRoot: root,
    workflow: createWorkflow(root),
  });

  expect(rewritten.startsWith("## Objective")).toBe(true);
  expect(rewritten).toContain("## Current Focus");
  expect(rewritten).toContain("## Constraints");
  expect(rewritten).toContain("## Proof Surfaces");
  expect(rewritten).toContain("./io/overview.md");
  expect(rewritten).toContain("Keep it useful, not verbose.");
  expect(rewritten).toContain("## Work Options");
  expect(rewritten).toContain("1. **Define stable managed sections**");
  expect(rewritten).toContain("2. **Implement proposal generation in the backlog");
  expect(rewritten).toContain(
    "Alignment: Turn a fresh parent issue into a durable planning brief.",
  );
  expect(rewritten).toContain("## Deferred");
});

test("rewriteManagedBacklogDescription refreshes managed sections and preserves useful human sections", () => {
  const root = "/repo";
  const original = `## Objective

Turn a fresh parent issue into a durable planning brief.

## Current Focus

- old state

## Constraints

- old constraint

## Work Options

1. **Old option**
   Focus: old focus
   Alignment: old alignment

## Decisions

- Keep the operator summary outside the managed block.
`;

  const rewritten = rewriteManagedBacklogDescription({
    bundle: createBundle(root),
    issue: createIssue(original),
    repoRoot: root,
    workflow: createWorkflow(root),
  });

  expect(rewritten).toContain("## Objective");
  expect(rewritten).toContain("## Current Focus");
  expect(rewritten).toContain("## Constraints");
  expect(rewritten).toContain("## Decisions");
  expect(rewritten).toContain("Keep the operator summary outside the managed block.");
  expect(rewritten).toContain("Keep the operator summary outside the managed block.");
  expect(rewritten).toContain("## Work Options");
});

test("rewriteManagedBacklogDescription drops legacy module goals paths from the refreshed brief", () => {
  const root = "/repo";
  const original = `## Objective

Make the managed graph stream flow portable on graph.

## Proof Surfaces

- ./graph/io/goals.md
- ./graph/io/overview.md

## Constraints

- Keep the next slice easy to review.
`;

  const rewritten = rewriteManagedBacklogDescription({
    bundle: createBundle(root),
    issue: {
      ...createIssue(original),
      identifier: "OPE-133",
      labels: ["io", "agent"],
    },
    repoRoot: root,
    workflow: createWorkflow(root),
  });

  expect(rewritten).toContain("## Proof Surfaces");
  expect(rewritten).not.toContain("./graph/io/goals.md");
  expect(rewritten).toContain("./agent");
  expect(rewritten).toContain("./agent/io/overview.md");
});
