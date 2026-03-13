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
    "project.overview": "./io/overview.md",
  });
  expect(config.context?.profiles?.backlog?.include).toContain("project.backlog");
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

test("repo backlog doc captures the manual stream-feature-task workflow", () => {
  const path = resolve(repoRoot, "./io/backlog.md");
  const content = readFileSync(path, "utf8");

  expect(content).toContain("You are the IO backlog editor for the three-level Linear workflow.");
  expect(content).toContain("1. `Stream`");
  expect(content).toContain("2. `Feature`");
  expect(content).toContain("3. `Task`");
  expect(content).toContain("do not use comment-driven workflows");
  expect(content).toContain("do not ask the supervisor to run backlog work automatically");
  expect(content).toContain("do not plan parallel tasks inside a single feature");
  expect(content).toContain("the user confirms");
});

test("repo workflow docs describe explicit routing and omit comment-driven backlog hooks", () => {
  const workflowPlan = readFileSync(
    resolve(repoRoot, "./agent/io/module-stream-workflow-plan.md"),
    "utf8",
  );

  expect(workflowPlan).toContain("## Current Workflow Surface");
  expect(workflowPlan).toContain("`io.ts` for runtime config plus `io.md` for prompt body");
  expect(workflowPlan).toContain("## Current Doc Reference Rules");
  expect(workflowPlan).toContain("## Current Prompt Model");
  expect(workflowPlan).toContain("first matching explicit routing rule");
  expect(workflowPlan).toContain("fallback repo defaults");
  expect(workflowPlan).toContain("synthesized issue description context");
  expect(workflowPlan).not.toContain("@io");
  expect(workflowPlan).toContain("## Current Constraints");
  expect(workflowPlan).toContain("workflow loading is repo-local and file-based");
  expect(workflowPlan).toContain("## Future Work Suggestions");
});
