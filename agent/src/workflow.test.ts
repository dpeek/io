import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { DEFAULT_EXECUTE_BUILTIN_DOC_IDS } from "./builtins.js";
import { resolveIssueRouting } from "./issue-routing.js";
import { loadWorkflowFile, renderPrompt } from "./workflow.js";

async function mkdtempInRepo(prefix: string) {
  return mkdtemp(resolve(process.cwd(), prefix));
}

async function writeIoTsConfig(root: string, config: Record<string, unknown>) {
  await writeFile(resolve(root, "io.ts"), `export default ${JSON.stringify(config, null, 2)};\n`);
}

test("loadWorkflowFile loads io.ts and io.md by default", async () => {
  const root = await mkdtempInRepo(".workflow-");
  process.env.LINEAR_API_KEY = "linear-token";
  process.env.LINEAR_PROJECT_SLUG = "project-slug";

  await mkdir(resolve(root, "io", "context"), { recursive: true });
  await writeIoTsConfig(root, {
    agent: { maxTurns: 3 },
    context: {
      docs: {
        "project.overview": "./io/context/overview.md",
      },
      profiles: {
        execute: {
          include: ["builtin:io.agent.execute.default", "project.overview"],
        },
      },
    },
    install: { brews: ["bat"] },
    issues: {
      defaultAgent: "execute",
      routing: [
        {
          agent: "backlog",
          if: { labelsAny: ["planning"] },
          profile: "backlog",
        },
      ],
    },
    tracker: {
      apiKey: "$LINEAR_API_KEY",
      kind: "linear",
      projectSlug: "$LINEAR_PROJECT_SLUG",
    },
    workspace: {
      root: "./workspace",
    },
  });
  await writeFile(resolve(root, "io.md"), "IO {{ issue.identifier }}\n");
  await writeFile(resolve(root, "io", "context", "overview.md"), "PROJECT OVERVIEW\n");

  try {
    const result = await loadWorkflowFile(undefined, root);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.entrypoint.kind).toBe("io");
    expect(result.value.entrypoint.configPath).toBe(resolve(root, "io.ts"));
    expect(result.value.entrypoint.promptPath).toBe(resolve(root, "io.md"));
    expect(result.value.entrypointContent).toBe("IO {{ issue.identifier }}");
    expect(result.value.agent.maxTurns).toBe(3);
    expect(result.value.issues).toEqual({
      defaultAgent: "execute",
      defaultProfile: "execute",
      routing: [
        {
          agent: "backlog",
          if: {
            labelsAny: ["planning"],
          },
          profile: "backlog",
        },
      ],
    });
    expect(result.value.context.docs).toEqual({
      "project.overview": resolve(root, "io", "context", "overview.md"),
    });
    expect(result.value.context.profiles.execute).toEqual({
      include: ["builtin:io.agent.execute.default", "project.overview"],
      includeEntrypoint: true,
    });
    expect(result.value.tracker.apiKey).toBe("linear-token");
    expect(result.value.tracker.projectSlug).toBe("project-slug");
    expect(result.value.workspace.root).toBe(resolve(root, "workspace"));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("loadWorkflowFile rejects legacy entrypoint paths", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "workflow-"));
  await writeIoTsConfig(root, {
    tracker: {
      apiKey: "$LINEAR_API_KEY",
      kind: "linear",
    },
    workspace: {
      root: "./workspace",
    },
  });
  await writeFile(resolve(root, "io.md"), "IO {{ issue.identifier }}\n");
  await writeFile(resolve(root, "io.json"), "{}\n");
  await writeFile(resolve(root, "WORKFLOW.md"), "legacy\n");

  try {
    const ioJsonResult = await loadWorkflowFile("io.json", root);
    expect(ioJsonResult.ok).toBe(false);
    if (ioJsonResult.ok) {
      return;
    }
    expect(ioJsonResult.errors).toEqual([
      {
        message: "Unsupported entrypoint path: io.json. Expected io.ts or io.md.",
        path: "$",
      },
    ]);

    const workflowResult = await loadWorkflowFile("WORKFLOW.md", root);
    expect(workflowResult.ok).toBe(false);
    if (workflowResult.ok) {
      return;
    }
    expect(workflowResult.errors).toEqual([
      {
        message: "Unsupported entrypoint path: WORKFLOW.md. Expected io.ts or io.md.",
        path: "$",
      },
    ]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("loadWorkflowFile resolves builtin override paths from io.ts", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "workflow-"));
  process.env.LINEAR_API_KEY = "linear-token";

  await mkdir(resolve(root, "io", "context"), { recursive: true });
  await writeIoTsConfig(root, {
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
  });
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

test("loadWorkflowFile resolves registered docs and merges default context profiles", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "workflow-"));
  process.env.LINEAR_API_KEY = "linear-token";

  await mkdir(resolve(root, "io", "context"), { recursive: true });
  await writeIoTsConfig(root, {
    context: {
      docs: {
        "project.architecture": "./io/context/architecture.md",
      },
      profiles: {
        backlog: {
          include: ["builtin:io.agent.backlog.default", "project.architecture"],
        },
      },
    },
    tracker: {
      apiKey: "$LINEAR_API_KEY",
      kind: "linear",
    },
    workspace: {
      root: "./workspace",
    },
  });
  await writeFile(resolve(root, "io.md"), "IO {{ issue.identifier }}\n");
  await writeFile(resolve(root, "io", "context", "architecture.md"), "ARCHITECTURE\n");

  try {
    const result = await loadWorkflowFile(undefined, root);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.context.docs).toEqual({
      "project.architecture": resolve(root, "io", "context", "architecture.md"),
    });
    expect(result.value.context.profiles.backlog).toEqual({
      include: ["builtin:io.agent.backlog.default", "project.architecture"],
      includeEntrypoint: true,
    });
    expect(result.value.context.profiles.execute).toEqual({
      include: [...DEFAULT_EXECUTE_BUILTIN_DOC_IDS],
      includeEntrypoint: true,
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("loadWorkflowFile preserves profile entrypoint opt-out", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "workflow-"));
  process.env.LINEAR_API_KEY = "linear-token";

  await writeIoTsConfig(root, {
    context: {
      profiles: {
        execute: {
          include: ["builtin:io.agent.execute.default"],
          includeEntrypoint: false,
        },
      },
    },
    tracker: {
      apiKey: "$LINEAR_API_KEY",
      kind: "linear",
    },
    workspace: {
      root: "./workspace",
    },
  });
  await writeFile(resolve(root, "io.md"), "IO {{ issue.identifier }}\n");

  try {
    const result = await loadWorkflowFile(undefined, root);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.context.profiles.execute).toEqual({
      include: ["builtin:io.agent.execute.default"],
      includeEntrypoint: false,
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("loadWorkflowFile parses issue routing defaults and normalized rules from io.ts", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "workflow-"));

  await writeIoTsConfig(root, {
    issues: {
      defaultAgent: "execute",
      routing: [
        {
          agent: "backlog",
          if: {
            hasChildren: false,
            hasParent: true,
            labelsAll: ["Planning", "Docs"],
            labelsAny: ["docs"],
            projectSlugIn: ["IO"],
            stateIn: ["Todo", "In Progress"],
          },
          profile: "backlog",
        },
      ],
    },
    tracker: {
      apiKey: "$LINEAR_API_KEY",
      kind: "linear",
    },
    workspace: {
      root: "./workspace",
    },
  });
  await writeFile(resolve(root, "io.md"), "IO {{ issue.identifier }}\n");

  try {
    const result = await loadWorkflowFile(undefined, root);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.issues).toEqual({
      defaultAgent: "execute",
      defaultProfile: "execute",
      routing: [
        {
          agent: "backlog",
          if: {
            hasChildren: false,
            hasParent: true,
            labelsAll: ["planning", "docs"],
            labelsAny: ["docs"],
            projectSlugIn: ["io"],
            stateIn: ["todo", "in progress"],
          },
          profile: "backlog",
        },
      ],
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("loadWorkflowFile normalizes modules without implicit backlog routing", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "workflow-"));

  await mkdir(resolve(root, "agent", "doc"), { recursive: true });
  await mkdir(resolve(root, "io"), { recursive: true });
  await writeIoTsConfig(root, {
    modules: {
      agent: {
        allowedSharedPaths: ["./io"],
        docs: ["./agent/doc/stream-workflow.md"],
        path: "./agent",
      },
    },
    tracker: {
      apiKey: "$LINEAR_API_KEY",
      kind: "linear",
    },
    workspace: {
      root: "./workspace",
    },
  });
  await writeFile(resolve(root, "io.md"), "IO {{ issue.identifier }}\n");

  try {
    const result = await loadWorkflowFile(undefined, root);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.modules).toEqual({
      agent: {
        allowedSharedPaths: [resolve(root, "io")],
        docs: ["./agent/doc/stream-workflow.md"],
        id: "agent",
        path: resolve(root, "agent"),
      },
    });
    expect(
      resolveIssueRouting(
        result.value.issues,
        {
          blockedBy: [],
          createdAt: "2024-01-01T00:00:00.000Z",
          description: "",
          hasChildren: true,
          hasParent: false,
          id: "1",
          identifier: "OPE-124",
          labels: ["io", "agent"],
          priority: 2,
          projectSlug: "io",
          state: "Todo",
          title: "Managed parent",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
        result.value.modules,
      ),
    ).toEqual({
      agent: "execute",
      profile: "execute",
    });
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
        hasChildren: false,
        hasParent: false,
        id: "1",
        identifier: "OS-1",
        labels: [],
        priority: 1,
        projectSlug: "io",
        state: "Todo",
        title: "Example",
        updatedAt: "2024-01-01T00:00:00.000Z",
      },
    }),
  ).toThrow("Unknown prompt template variable: issue.missing");
});
