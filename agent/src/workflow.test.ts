import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { loadWorkflowFile, parseWorkflow, renderPrompt } from "./workflow.js";

test("parseWorkflow normalizes legacy WORKFLOW front matter and env-backed values", () => {
  process.env.LINEAR_API_KEY = "linear-token";
  process.env.LINEAR_PROJECT_SLUG = "project-slug";
  process.env.AGENT_WORKSPACE_ROOT = "/tmp/workspace";

  const result = parseWorkflow(`---
tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
  project_slug: $LINEAR_PROJECT_SLUG
workspace:
  root: $AGENT_WORKSPACE_ROOT
agent:
  max_turns: 1
---
Issue {{ issue.identifier }}: {{ issue.title }}
`);

  expect(result.ok).toBe(true);
  if (!result.ok) {
    return;
  }

  expect(result.value.entrypoint.kind).toBe("workflow");
  expect(result.value.tracker.apiKey).toBe("linear-token");
  expect(result.value.tracker.projectSlug).toBe("project-slug");
  expect(result.value.workspace.root).toBe("/tmp/workspace");
  expect(result.value.workspace.origin).toBeUndefined();
  expect(result.value.context.overrides).toEqual({});
  expect(result.value.agent.maxTurns).toBe(1);
});

test("loadWorkflowFile prefers io.json and io.md when both are present", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "workflow-"));
  process.env.LINEAR_API_KEY = "linear-token";
  process.env.LINEAR_PROJECT_SLUG = "project-slug";

  await writeFile(
    resolve(root, "io.json"),
    JSON.stringify(
      {
        agent: { maxTurns: 2 },
        brews: ["ripgrep"],
        tracker: {
          apiKey: "$LINEAR_API_KEY",
          kind: "linear",
          projectSlug: "$LINEAR_PROJECT_SLUG",
        },
        workspace: {
          root: "./workspace",
        },
      },
      null,
      2,
    ),
  );
  await writeFile(resolve(root, "io.md"), "IO {{ issue.identifier }}\n");
  await writeFile(
    resolve(root, "WORKFLOW.md"),
    `---
tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
workspace:
  root: ./legacy-workspace
---
WORKFLOW {{ issue.identifier }}
`,
  );

  try {
    const result = await loadWorkflowFile(undefined, root);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.entrypoint.kind).toBe("io");
    expect(result.value.entrypoint.configPath).toBe(resolve(root, "io.json"));
    expect(result.value.entrypoint.promptPath).toBe(resolve(root, "io.md"));
    expect(result.value.promptTemplate).toBe("IO {{ issue.identifier }}");
    expect(result.value.agent.maxTurns).toBe(2);
    expect(result.value.tracker.apiKey).toBe("linear-token");
    expect(result.value.tracker.projectSlug).toBe("project-slug");
    expect(result.value.workspace.root).toBe(resolve(root, "workspace"));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("loadWorkflowFile resolves builtin override paths from io.json", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "workflow-"));
  process.env.LINEAR_API_KEY = "linear-token";

  await mkdir(resolve(root, "io", "context"), { recursive: true });
  await writeFile(
    resolve(root, "io.json"),
    JSON.stringify(
      {
        context: {
          overrides: {
            "builtin:io.core.validation": "./io/context/validation.md",
          },
        },
        tracker: {
          apiKey: "$LINEAR_API_KEY",
          kind: "linear",
        },
        workspace: {
          root: "./workspace",
        },
      },
      null,
      2,
    ),
  );
  await writeFile(resolve(root, "io.md"), "IO {{ issue.identifier }}\n");

  try {
    const result = await loadWorkflowFile(undefined, root);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.context.overrides).toEqual({
      "builtin:io.core.validation": resolve(root, "io", "context", "validation.md"),
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("loadWorkflowFile reuses WORKFLOW.md prompt text when io.json has runtime config but io.md is absent", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "workflow-"));
  process.env.LINEAR_API_KEY = "linear-token";

  await writeFile(
    resolve(root, "io.json"),
    JSON.stringify(
      {
        tracker: {
          apiKey: "$LINEAR_API_KEY",
          kind: "linear",
        },
        workspace: {
          root: "./workspace",
        },
      },
      null,
      2,
    ),
  );
  await writeFile(
    resolve(root, "WORKFLOW.md"),
    `---
tracker:
  kind: linear
  api_key: ignored-token
workspace:
  root: ./legacy-workspace
---
WORKFLOW {{ issue.identifier }}
`,
  );

  try {
    const result = await loadWorkflowFile(undefined, root);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.entrypoint.kind).toBe("io");
    expect(result.value.entrypoint.configPath).toBe(resolve(root, "io.json"));
    expect(result.value.entrypoint.promptPath).toBe(resolve(root, "WORKFLOW.md"));
    expect(result.value.promptTemplate).toBe("WORKFLOW {{ issue.identifier }}");
    expect(result.value.tracker.apiKey).toBe("linear-token");
    expect(result.value.workspace.root).toBe(resolve(root, "workspace"));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("loadWorkflowFile falls back to WORKFLOW.md when io.md is absent", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "workflow-"));
  process.env.LINEAR_API_KEY = "linear-token";

  await writeFile(resolve(root, "io.json"), JSON.stringify({ brews: ["ripgrep"] }, null, 2));
  await writeFile(
    resolve(root, "WORKFLOW.md"),
    `---
tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
workspace:
  root: ./workspace
---
WORKFLOW {{ issue.identifier }}
`,
  );

  try {
    const result = await loadWorkflowFile(undefined, root);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.entrypoint.kind).toBe("workflow");
    expect(result.value.entrypoint.configPath).toBe(resolve(root, "WORKFLOW.md"));
    expect(result.value.promptTemplate).toBe("WORKFLOW {{ issue.identifier }}");
    expect(result.value.workspace.root).toBe(resolve(root, "workspace"));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("loadWorkflowFile uses io.json config with WORKFLOW.md prompt during migration", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "workflow-"));
  process.env.LINEAR_API_KEY = "linear-token";
  process.env.LINEAR_PROJECT_SLUG = "project-slug";

  await writeFile(
    resolve(root, "io.json"),
    JSON.stringify(
      {
        agent: { maxTurns: 2 },
        tracker: {
          apiKey: "$LINEAR_API_KEY",
          kind: "linear",
          projectSlug: "$LINEAR_PROJECT_SLUG",
        },
        workspace: {
          root: "./workspace",
        },
      },
      null,
      2,
    ),
  );
  await writeFile(
    resolve(root, "WORKFLOW.md"),
    `---
tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
workspace:
  root: ./legacy-workspace
---
WORKFLOW {{ issue.identifier }}
`,
  );

  try {
    const result = await loadWorkflowFile(undefined, root);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.entrypoint.kind).toBe("io");
    expect(result.value.entrypoint.configPath).toBe(resolve(root, "io.json"));
    expect(result.value.entrypoint.promptPath).toBe(resolve(root, "WORKFLOW.md"));
    expect(result.value.promptTemplate).toBe("WORKFLOW {{ issue.identifier }}");
    expect(result.value.agent.maxTurns).toBe(2);
    expect(result.value.tracker.projectSlug).toBe("project-slug");
    expect(result.value.workspace.root).toBe(resolve(root, "workspace"));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
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
  ).toThrow("Unknown prompt template variable: issue.missing");
});
