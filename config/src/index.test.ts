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
  const docs = config.context?.docs as Record<string, string> | undefined;
  expect(docs).toEqual({
    "project.backlog": "./io/backlog.md",
    "project.goals": "./io/goals.md",
    "project.module-stream-workflow-plan": "./agent/io/module-stream-workflow-plan.md",
    "project.overview": "./io/overview.md",
    "project.workflow": "./io/workflow.md",
  });
  expect(config.context?.profiles?.backlog?.include).toContain("project.backlog");
  expect(config.context?.profiles?.backlog?.include).toContain("project.goals");
  expect(config.context?.profiles?.backlog?.include).toContain("project.overview");
  expect(config.context?.profiles?.backlog?.include).toContain("project.workflow");
  expect(config.context?.profiles?.execute?.include).toContain("project.workflow");
  expect(config.modules?.agent).toEqual({
    allowedSharedPaths: ["./io"],
    docs: ["./agent/io/overview.md", "./agent/io/module-stream-workflow-plan.md"],
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

test("repo workflow docs point backlog work at the three-level stream model", () => {
  const backlog = readFileSync(resolve(repoRoot, "./io/backlog.md"), "utf8");
  const goals = readFileSync(resolve(repoRoot, "./io/goals.md"), "utf8");
  const overview = readFileSync(resolve(repoRoot, "./io/overview.md"), "utf8");
  const workflow = readFileSync(resolve(repoRoot, "./io/workflow.md"), "utf8");
  const agentOverview = readFileSync(resolve(repoRoot, "./agent/io/overview.md"), "utf8");
  const workflowPlan = readFileSync(
    resolve(repoRoot, "./agent/io/module-stream-workflow-plan.md"),
    "utf8",
  );

  expect(workflow).toContain("# Stream Feature Task Workflow");
  expect(workflow).toContain("`Stream -> Feature -> Task`");
  expect(workflow).toContain("Humans own:");
  expect(workflow).toContain("The agent/runtime owns:");
  expect(workflow).toContain("Current Gaps And Compatibility Notes");
  expect(workflow).toContain("selecting released leaf issues for execution");
  expect(workflow).toContain("feature branch onto the current stream branch head");

  expect(backlog).toContain("You are the IO backlog editor for the three-level Linear workflow.");
  expect(backlog).toContain("Stream");
  expect(backlog).toContain("Feature");
  expect(backlog).toContain("Task");
  expect(backlog).toContain("do not use comment-driven workflows");
  expect(backlog).toContain("./workflow.md");
  expect(backlog).toContain("## Roadmap");

  expect(goals).toContain("# Stream Workflow Goals");
  expect(goals).toContain("three-level stream/feature/task model");
  expect(goals).not.toContain("Current Approach Stream");
  expect(goals).not.toContain("2-level parent/child hierarchy");

  expect(overview).toContain("the stream/feature/task workflow contract");
  expect(overview).toContain("./workflow.md");
  expect(overview).toContain("./backlog.md");

  expect(agentOverview).toContain("../../io/workflow.md");
  expect(agentOverview).toContain("reconciles `Done` features by squashing");

  expect(workflowPlan).toContain("## Current Workflow Surface");
  expect(workflowPlan).toContain("## Current Doc Reference Rules");
  expect(workflowPlan).toContain("## Current Prompt Model");
  expect(workflowPlan).toContain("../../io/workflow.md");
  expect(workflowPlan).not.toContain("managed-parent detection");
  expect(workflowPlan).not.toContain("OPE-121 Proof Status");
});
