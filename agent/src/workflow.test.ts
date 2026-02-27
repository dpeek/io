import { expect, test } from "bun:test";

import { parseWorkflow, renderPrompt } from "./workflow.js";

test("parseWorkflow normalizes front matter and env-backed values", () => {
  process.env.LINEAR_API_KEY = "linear-token";
  process.env.LINEAR_PROJECT_SLUG = "project-slug";
  process.env.SYMPHONY_WORKSPACE_ROOT = "/tmp/workspace";

  const result = parseWorkflow(`---
tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
  project_slug: $LINEAR_PROJECT_SLUG
workspace:
  root: $SYMPHONY_WORKSPACE_ROOT
agent:
  max_turns: 1
---
Issue {{ issue.identifier }}: {{ issue.title }}
`);

  expect(result.ok).toBe(true);
  if (!result.ok) {
    return;
  }

  expect(result.value.tracker.apiKey).toBe("linear-token");
  expect(result.value.tracker.projectSlug).toBe("project-slug");
  expect(result.value.workspace.root).toBe("/tmp/workspace");
  expect(result.value.agent.maxTurns).toBe(1);
});

test("renderPrompt fails on unknown variables", () => {
  expect(() =>
    renderPrompt("Issue {{ issue.identifier }} {{ issue.missing }}", {
      issue: {
        blockedBy: [],
        createdAt: "2024-01-01T00:00:00.000Z",
        description: "",
        id: "1",
        identifier: "OS-1",
        labels: [],
        priority: 1,
        state: "Todo",
        title: "Example",
        updatedAt: "2024-01-01T00:00:00.000Z",
      },
    }),
  ).toThrow("Unknown workflow template variable: issue.missing");
});
