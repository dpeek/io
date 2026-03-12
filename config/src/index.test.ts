import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "bun:test";

import config from "./index.js";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

test("@io/config re-exports the repo root config", () => {
  expect(config.install?.brews).toContain("ripgrep");
});

test("@io/config exposes the repo context bundle and routing defaults", () => {
  expect(config.context?.entrypoint).toBe("./io/overview.md");
  expect(config.context?.docs).toEqual({
    "project.focus": "./io/goals.md",
    "project.managed-stream-comments": "./agent/io/managed-stream-comments.md",
    "project.managed-stream-backlog": "./agent/io/managed-stream-backlog.md",
    "project.managed-stream-goals": "./agent/io/managed-stream-goals.md",
    "project.module-stream-workflow-plan": "./agent/io/module-stream-workflow-plan.md",
    "project.overview": "./io/overview.md",
  });
  expect(config.context?.profiles?.backlog?.include).toContain("project.focus");
  expect(config.context?.profiles?.backlog?.include).toContain("project.managed-stream-goals");
  expect(config.context?.profiles?.backlog?.include).toContain("project.managed-stream-backlog");
  expect(config.context?.profiles?.backlog?.include).toContain("project.managed-stream-comments");
  expect(config.modules?.agent).toEqual({
    allowedSharedPaths: ["./io"],
    docs: ["./agent/io/overview.md", "./agent/io/goals.md", "./agent/doc/stream-workflow.md"],
    path: "./agent",
  });
  expect(config.issues).toEqual({
    defaultAgent: "execute",
    defaultProfile: "execute",
    routing: [
      {
        agent: "backlog",
        if: {
          labelsAny: ["backlog", "planning"],
        },
        profile: "backlog",
      },
    ],
  });

  for (const path of Object.values(config.context?.docs ?? {})) {
    expect(existsSync(resolve(repoRoot, path))).toBe(true);
  }
  for (const module of Object.values(config.modules ?? {})) {
    expect(existsSync(resolve(repoRoot, module.path))).toBe(true);
  }
});

test("repo managed stream backlog doc captures expansion, maintenance, and operator output rules", () => {
  const path = resolve(repoRoot, "./agent/io/managed-stream-backlog.md");
  const content = readFileSync(path, "utf8");

  expect(content).toContain("## Stable Parent Brief Payload");
  expect(content).toContain("io-managed:backlog-proposal:start");
  expect(content).toContain("## Stable Child Payload");
  expect(content).toContain("blockedBy");
  expect(content).toContain("current-approach bootstrap seeds new child issues in `Todo`");
  expect(content).toContain("keeps seeded `Todo`");
  expect(content).toContain("top the stream back up to about five planned tasks");
  expect(content).toContain(
    "Do not destructively rewrite children that are already active or completed.",
  );
  expect(content).toContain("## Cross-Module Exception");
  expect(content).toContain("## Operator-Visible Output");
});

test("repo managed stream contract docs lock the label, comment, and current-approach workflow shapes", () => {
  const goals = readFileSync(resolve(repoRoot, "./agent/io/managed-stream-goals.md"), "utf8");
  const comments = readFileSync(resolve(repoRoot, "./agent/io/managed-stream-comments.md"), "utf8");
  const workflowPlan = readFileSync(
    resolve(repoRoot, "./agent/io/module-stream-workflow-plan.md"),
    "utf8",
  );

  expect(goals).toContain("## Managed Parent Label Contract");
  expect(goals).toContain("## Module Identity Contract");
  expect(goals).toContain("## Repo-Wide Focus Document Shape");
  expect(goals).toContain("## Parent Issue Managed-Section Model");
  expect(goals).toContain("io-managed:<section-id>:start");
  expect(goals).toContain("backlog-proposal");

  expect(comments).toContain("## Accepted Command Shape");
  expect(comments).toContain("@io <command>");
  expect(comments).toContain("### `@io backlog`");
  expect(comments).toContain("### `@io focus`");
  expect(comments).toContain("### `@io status`");
  expect(comments).toContain("<!-- io-managed:comment-result -->");
  expect(comments).toContain("dryRun: true");

  expect(workflowPlan).toContain("## Stable Contract Sources");
  expect(workflowPlan).toContain("## Current Runtime Baseline");
  expect(workflowPlan).toContain("## Current Approach Linear Contract");
  expect(workflowPlan).toContain("## Proof Surface");
  expect(workflowPlan).toContain("./managed-stream-backlog.md");
  expect(workflowPlan).toContain("./managed-stream-comments.md");
  expect(workflowPlan).toContain("../doc/stream-workflow.md");
  expect(workflowPlan).toContain("only auto-runs children whose parent is `In Progress`");
  expect(workflowPlan).toContain("successful parent backlog runs move the parent to `In Review`");
});

test("repo managed stream contract docs capture label, ownership, and comment rules", () => {
  const goalsPath = resolve(repoRoot, "./agent/io/managed-stream-goals.md");
  const goals = readFileSync(goalsPath, "utf8");
  expect(goals).toContain("the issue has the `io` label");
  expect(goals).toContain("exactly one module label that matches a configured module id");
  expect(goals).toContain("./io/goals.md");
  expect(goals).toContain("Reserved section ids for later");
  expect(goals).toContain("Human-owned:");
  expect(goals).toContain("Agent-owned:");

  const commentsPath = resolve(repoRoot, "./agent/io/managed-stream-comments.md");
  const comments = readFileSync(commentsPath, "utf8");
  expect(comments).toContain("@io focus");
  expect(comments).toContain("@io backlog");
  expect(comments).toContain("@io status");
  expect(comments).toContain("the first non-empty line must start with `@io `");
  expect(comments).toContain("./io/goals.md");

  const planPath = resolve(repoRoot, "./agent/io/module-stream-workflow-plan.md");
  const plan = readFileSync(planPath, "utf8");
  expect(plan).toContain("## Stable Contract Sources");
  expect(plan).toContain("## Done Means");
  expect(plan).toContain("new streams bootstrap with parent `In Review` and children in `Todo`");
  expect(plan).toContain("## Out Of Scope For This Slice");
});

test("repo current focus doc captures the phase gate and separated transitions", () => {
  const focus = readFileSync(resolve(repoRoot, "./io/goals.md"), "utf8");

  expect(focus).toContain("# Current Approach Stream");
  expect(focus).toContain("Keep parent `Todo` as the only automatic backlog-entry phase");
  expect(focus).toContain("Treat parent `In Review` as the safe bootstrap");
  expect(focus).toContain("Seed new implementation children in `Todo`");
  expect(focus).toContain("Keep parent and child Linear transitions separate");
  expect(focus).toContain("child execution still lands on `Done`");
  expect(focus).toContain("Do not auto-run child issues unless their parent stream is `In Progress`");
  expect(focus).toContain("Keep one active child per stream");
});
