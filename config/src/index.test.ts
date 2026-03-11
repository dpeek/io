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
  expect(config.context?.entrypoint).toBe("./io.md");
  expect(config.context?.docs).toEqual({
    "project.architecture": "./llm/topic/architecture.md",
    "project.managed-stream-comments": "./llm/topic/managed-stream-comments.md",
    "project.managed-stream-backlog": "./llm/topic/managed-stream-backlog.md",
    "project.managed-stream-goals": "./llm/topic/goals.md",
    "project.module-stream-workflow-plan": "./llm/topic/module-stream-workflow-plan.md",
    "project.overview": "./llm/topic/project-overview.md",
    "project.workflow-migration": "./llm/topic/workflow-migration.md",
  });
  expect(config.context?.profiles?.backlog?.include).toContain("project.managed-stream-goals");
  expect(config.context?.profiles?.backlog?.include).toContain("project.managed-stream-backlog");
  expect(config.context?.profiles?.backlog?.include).toContain("project.managed-stream-comments");
  expect(config.context?.profiles?.backlog?.include).toContain("project.workflow-migration");
  expect(config.modules?.agent).toEqual({
    allowedSharedPaths: ["./llm/topic"],
    docs: ["./llm/topic/agent.md", "./agent/doc/stream-workflow.md"],
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
  const path = resolve(repoRoot, "./llm/topic/managed-stream-backlog.md");
  const content = readFileSync(path, "utf8");

  expect(content).toContain("## Stable Parent Brief Payload");
  expect(content).toContain("io-managed:backlog-proposal:start");
  expect(content).toContain("## Stable Child Payload");
  expect(content).toContain("blockedBy");
  expect(content).toContain("top the stream back up to about five planned tasks");
  expect(content).toContain("Do not destructively rewrite children that are already active or completed.");
  expect(content).toContain("## Cross-Module Exception");
  expect(content).toContain("## Operator-Visible Output");
});

test("repo managed stream contract docs lock the label, comment, and workflow shapes", () => {
  const goals = readFileSync(resolve(repoRoot, "./llm/topic/goals.md"), "utf8");
  const comments = readFileSync(resolve(repoRoot, "./llm/topic/managed-stream-comments.md"), "utf8");
  const workflowPlan = readFileSync(
    resolve(repoRoot, "./llm/topic/module-stream-workflow-plan.md"),
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
  expect(workflowPlan).toContain("## Implementation Order");
  expect(workflowPlan).toContain("./managed-stream-backlog.md");
  expect(workflowPlan).toContain("./managed-stream-comments.md");
  expect(workflowPlan).toContain("../../agent/doc/stream-workflow.md");
});

test("repo managed stream contract docs capture label, ownership, and comment rules", () => {
  const goalsPath = resolve(repoRoot, "./llm/topic/goals.md");
  const goals = readFileSync(goalsPath, "utf8");
  expect(goals).toContain("labels include `io`");
  expect(goals).toContain("exactly one configured module label");
  expect(goals).toContain("<!-- io-managed:focus:start -->");
  expect(goals).toContain("Human-owned:");
  expect(goals).toContain("Agent-owned:");

  const commentsPath = resolve(repoRoot, "./llm/topic/managed-stream-comments.md");
  const comments = readFileSync(commentsPath, "utf8");
  expect(comments).toContain("@io focus");
  expect(comments).toContain("@io backlog");
  expect(comments).toContain("@io status");
  expect(comments).toContain("the first non-empty line starts with `@io `");

  const planPath = resolve(repoRoot, "./llm/topic/module-stream-workflow-plan.md");
  const plan = readFileSync(planPath, "utf8");
  expect(plan).toContain("## Locked Contract");
  expect(plan).toContain("## Implementation Order");
  expect(plan).toContain("## Out Of Scope For The First Cut");
});
