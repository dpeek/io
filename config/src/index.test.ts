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
    "project.managed-stream-comments": "./agent/io/managed-stream-comments.md",
    "project.managed-stream-backlog": "./agent/io/managed-stream-backlog.md",
    "project.managed-stream-contract": "./agent/io/managed-stream-contract.md",
    "project.module-stream-workflow-plan": "./agent/io/module-stream-workflow-plan.md",
    "project.overview": "./io/overview.md",
  });
  expect(config.context?.profiles?.backlog?.include).toContain("project.managed-stream-contract");
  expect(config.context?.profiles?.backlog?.include).toContain("project.managed-stream-backlog");
  expect(config.context?.profiles?.backlog?.include).toContain("project.managed-stream-comments");
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

test("repo managed stream backlog doc captures direct description refresh, expansion, and operator output rules", () => {
  const path = resolve(repoRoot, "./agent/io/managed-stream-backlog.md");
  const content = readFileSync(path, "utf8");

  expect(content).toContain("## Current Parent Brief Shape");
  expect(content).toContain("rewrites the parent description directly");
  expect(content).toContain("## Current Child Payload");
  expect(content).toContain("blockedBy");
  expect(content).toContain("state starts at `Todo`");
  expect(content).toContain(
    "the parent must move to `In Progress` before child execution can start",
  );
  expect(content).toContain("topped back up to a short tail rather than replanned from scratch");
  expect(content).toContain(
    "backlog refresh should avoid destructive rewrites of already active or completed children",
  );
  expect(content).toContain("## Current Guardrails");
  expect(content).toContain("operator review");
});

test("repo managed stream contract docs lock the label, comment, and current-approach workflow shapes", () => {
  const contract = readFileSync(resolve(repoRoot, "./agent/io/managed-stream-contract.md"), "utf8");
  const comments = readFileSync(resolve(repoRoot, "./agent/io/managed-stream-comments.md"), "utf8");
  const workflowPlan = readFileSync(
    resolve(repoRoot, "./agent/io/module-stream-workflow-plan.md"),
    "utf8",
  );

  expect(contract).toContain("## Current Managed Parent Contract");
  expect(contract).toContain("## Current Module Boundaries");
  expect(contract).toContain("## Current Ownership Split");
  expect(contract).toContain("The code already assumes shared ownership of the parent description");

  expect(comments).toContain("## Current Command Shape");
  expect(comments).toContain("@io <command>");
  expect(comments).toContain("`@io backlog`: may refresh the parent description");
  expect(comments).toContain("`@io status`");
  expect(comments).toContain("<!-- io-managed:comment-result -->");
  expect(comments).toContain("dryRun: true");

  expect(workflowPlan).toContain("## Current Workflow Surface");
  expect(workflowPlan).toContain("`io.ts` for runtime config plus `io.md` for prompt body");
  expect(workflowPlan).toContain("## Current Doc Reference Rules");
  expect(workflowPlan).toContain("## Current Prompt Model");
  expect(workflowPlan).toContain("exactly one configured module label");
  expect(workflowPlan).toContain("synthesized issue description context");
});

test("repo managed stream contract docs capture label, ownership, and comment rules", () => {
  const contractPath = resolve(repoRoot, "./agent/io/managed-stream-contract.md");
  const contract = readFileSync(contractPath, "utf8");
  expect(contract).toContain("- it has the `io` label");
  expect(contract).toContain("exactly one label that matches a configured module id");
  expect(contract).toContain("Module identity comes from `workflow.modules.<id>` in `io.ts`.");
  expect(contract).toContain("## Current Ownership Split");
  expect(contract).toContain("Humans still own:");
  expect(contract).toContain("The agent currently owns:");

  const commentsPath = resolve(repoRoot, "./agent/io/managed-stream-comments.md");
  const comments = readFileSync(commentsPath, "utf8");
  expect(comments).toContain("@io backlog");
  expect(comments).toContain("@io status");
  expect(comments).toContain("the first non-empty line is always the command line");
  expect(comments).not.toContain("@io focus");

  const planPath = resolve(repoRoot, "./agent/io/module-stream-workflow-plan.md");
  const plan = readFileSync(planPath, "utf8");
  expect(plan).toContain("## Current Constraints");
  expect(plan).toContain("workflow loading is repo-local and file-based");
  expect(plan).toContain("## Future Work Suggestions");
});
