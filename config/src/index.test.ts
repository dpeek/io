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
  });
  expect(config.context?.profiles?.backlog?.include).toContain("project.backlog");
  expect(config.context?.profiles?.backlog?.include).toContain("project.goals");
  expect(config.context?.profiles?.backlog?.include).toContain("project.overview");
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
  const workflowPlan = readFileSync(
    resolve(repoRoot, "./agent/io/module-stream-workflow-plan.md"),
    "utf8",
  );

  expect(backlog).toContain("You are the IO backlog editor for the three-level Linear workflow.");
  expect(backlog).toContain("Stream");
  expect(backlog).toContain("Feature");
  expect(backlog).toContain("Task");
  expect(backlog).toContain("do not use comment-driven workflows");
  expect(backlog).toContain("## Roadmap");

  expect(goals).toContain("# Stream Workflow Goals");
  expect(goals).toContain("three-level stream/feature/task model");
  expect(goals).not.toContain("Current Approach Stream");
  expect(goals).not.toContain("2-level parent/child hierarchy");

  expect(overview).toContain("the stream/feature/task backlog workflow");
  expect(overview).toContain("./backlog.md");
  expect(overview).not.toContain("managed-stream-contract");

  expect(workflowPlan).toContain("## Current Workflow Surface");
  expect(workflowPlan).toContain("## Current Doc Reference Rules");
  expect(workflowPlan).toContain("## Current Prompt Model");
  expect(workflowPlan).not.toContain("managed-parent detection");
  expect(workflowPlan).not.toContain("OPE-121 Proof Status");
});

test("legacy managed-stream docs are clearly marked as retained implementation notes", () => {
  const contract = readFileSync(resolve(repoRoot, "./agent/io/managed-stream-contract.md"), "utf8");
  const backlog = readFileSync(resolve(repoRoot, "./agent/io/managed-stream-backlog.md"), "utf8");
  const comments = readFileSync(resolve(repoRoot, "./agent/io/managed-stream-comments.md"), "utf8");

  expect(contract).toContain("# Legacy Managed Stream Contract");
  expect(contract).toContain("It is not the current default workflow surface.");
  expect(contract).toContain("- it has the `io` label");
  expect(contract).toContain("exactly one label that matches a configured module id");
  expect(contract).toContain("The retained automation still owns:");

  expect(backlog).toContain("# Legacy Managed Stream Backlog Refresh");
  expect(backlog).toContain("default planning workflow");
  expect(backlog).toContain("## Historical Stream Brief Shape");
  expect(backlog).toContain("Roadmap");
  expect(backlog).toContain("stream description directly");

  expect(comments).toContain("# Legacy Managed Stream Comments");
  expect(comments).toContain("not the current default workflow surface");
  expect(comments).toContain("@io backlog");
  expect(comments).toContain("@io status");
  expect(comments).toContain("the first non-empty line is always the command line");
  expect(comments).toContain("<!-- io-managed:comment-result -->");
  expect(comments).not.toContain("@io focus");
});
