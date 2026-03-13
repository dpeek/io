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
    title: "Stream backlog proposal",
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

Current code centers on a three-level issue model with stream-owned planning and feature-owned execution branches.

## Good Changes In This Stream

- clearer stream planning guidance
- tighter execution context for follow-on tasks
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

test("rewriteManagedBacklogDescription normalizes the stream description toward the shared template", () => {
  const root = "/repo";
  const description = `## Summary

- Turn a fresh stream issue into a durable planning brief.
- Keep the planning surface aligned with current workflow docs.

## Focus

- define stable stream sections
- implement proposal generation in the backlog path
- preserve human-authored decisions on rerun

## Guardrails

- Keep it useful, not verbose.
`;

  const rewritten = rewriteManagedBacklogDescription({
    bundle: createBundle(root),
    issue: createIssue(description),
    repoRoot: root,
    workflow: createWorkflow(root),
  });

  expect(rewritten.startsWith("## Summary")).toBe(true);
  expect(rewritten).toContain("## Focus");
  expect(rewritten).toContain("## Goals");
  expect(rewritten).toContain("## Roadmap");
  expect(rewritten).toContain("## Guardrails");
  expect(rewritten).toContain("## References");
  expect(rewritten).toContain("./io/overview.md");
  expect(rewritten).toContain("Keep it useful, not verbose.");
  expect(rewritten).toContain("1. **Define stable stream sections**");
  expect(rewritten).toContain("2. **Implement proposal generation in the backlog");
  expect(rewritten).toContain(
    "Outcome: Define the next agent outcome clearly enough for follow-on feature and task work.",
  );
});

test("rewriteManagedBacklogDescription refreshes stream sections and preserves useful human sections", () => {
  const root = "/repo";
  const original = `## Summary

- Turn a fresh stream issue into a durable planning brief.

## Focus

- old state

## Guardrails

- old constraint

## Roadmap

1. **Old option**
   Scope: old focus
   Outcome: old alignment

## Decisions

- Keep the operator summary outside the generated roadmap.
`;

  const rewritten = rewriteManagedBacklogDescription({
    bundle: createBundle(root),
    issue: createIssue(original),
    repoRoot: root,
    workflow: createWorkflow(root),
  });

  expect(rewritten).toContain("## Summary");
  expect(rewritten).toContain("## Focus");
  expect(rewritten).toContain("## Goals");
  expect(rewritten).toContain("## Guardrails");
  expect(rewritten).toContain("## Decisions");
  expect(rewritten).toContain("Keep the operator summary outside the generated roadmap.");
  expect(rewritten).toContain("## Roadmap");
});

test("rewriteManagedBacklogDescription drops legacy module goals paths from the refreshed brief", () => {
  const root = "/repo";
  const original = `## Summary

- Make the graph stream flow portable.

## References

- ./graph/io/goals.md
- ./graph/io/overview.md

## Guardrails

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

  expect(rewritten).toContain("## References");
  expect(rewritten).not.toContain("./graph/io/goals.md");
  expect(rewritten).toContain("./agent");
  expect(rewritten).toContain("./agent/io/overview.md");
});
