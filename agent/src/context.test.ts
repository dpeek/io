import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_BACKLOG_BUILTIN_DOC_IDS, DEFAULT_EXECUTE_BUILTIN_DOC_IDS } from "./builtins.js";
import { renderContextBundle, resolveIssueContext } from "./context.js";
import { resolveIssueRouting } from "./issue-routing.js";
import type { AgentIssue, PreparedWorkspace, Workflow } from "./types.js";
import { loadWorkflowFile, renderPrompt } from "./workflow.js";

function createWorkflow(root: string, promptPath: string): Workflow {
  return {
    agent: {
      maxConcurrentAgents: 1,
      maxRetryBackoffMs: 1_000,
      maxTurns: 1,
    },
    codex: {
      approvalPolicy: "never",
      command: "codex app-server",
      readTimeoutMs: 5_000,
      stallTimeoutMs: 60_000,
      threadSandbox: "workspace-write",
      turnTimeoutMs: 60_000,
    },
    context: {
      docs: {
        "project.architecture": resolve(root, "io", "context", "architecture.md"),
        "project.backlog": resolve(root, "io", "context", "backlog.md"),
        "project.overview": resolve(root, "io", "context", "overview.md"),
      },
      overrides: {},
      profiles: {
        backlog: {
          include: [...DEFAULT_BACKLOG_BUILTIN_DOC_IDS, "project.backlog"],
          includeEntrypoint: true,
        },
        execute: {
          include: [...DEFAULT_EXECUTE_BUILTIN_DOC_IDS],
          includeEntrypoint: true,
        },
      },
    },
    entrypoint: {
      configPath: resolve(root, "io.ts"),
      kind: "io",
      promptPath,
    },
    hooks: {
      timeoutMs: 60_000,
    },
    issues: {
      defaultAgent: "execute",
      defaultProfile: "execute",
      routing: [],
    },
    modules: {},
    polling: {
      intervalMs: 30_000,
    },
    entrypointContent: "LOCAL {{ selection.agent }} {{ selection.profile }}",
    tracker: {
      activeStates: ["Todo"],
      endpoint: "https://api.linear.app/graphql",
      kind: "linear",
      terminalStates: ["Done"],
    },
    workspace: {
      root,
    },
  };
}

function createIssue(description: string): AgentIssue {
  return {
    blockedBy: [],
    createdAt: "2024-01-01T00:00:00.000Z",
    description,
    hasChildren: false,
    hasParent: false,
    id: "1",
    identifier: "OPE-61",
    labels: [],
    priority: 3,
    projectSlug: "io",
    state: "Todo",
    title: "Issue context",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };
}

function createWorkspace(root: string): PreparedWorkspace {
  return {
    branchName: "io/ope-61",
    controlPath: root,
    createdNow: true,
    originPath: root,
    path: resolve(root, "workspace"),
    workerId: "OPE-61",
  };
}

test("resolveIssueContext applies issue hints after repo defaults and profile docs", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "context-"));
  const promptPath = resolve(root, "io.md");
  await mkdir(resolve(root, "io", "context"), { recursive: true });
  await writeFile(promptPath, "LOCAL {{ selection.agent }} {{ selection.profile }}\n");
  await writeFile(resolve(root, "io", "context", "backlog.md"), "BACKLOG PROFILE DOC\n");
  await writeFile(resolve(root, "io", "context", "architecture.md"), "ARCHITECTURE DOC\n");
  await writeFile(resolve(root, "io", "context", "overview.md"), "OVERVIEW DOC\n");
  await writeFile(resolve(root, "io", "context", "hint-extra.md"), "HINT EXTRA DOC\n");
  await writeFile(resolve(root, "io", "context", "linked.md"), "LINKED DOC\n");

  try {
    const issue = createIssue(`## Summary

<!-- io
agent: backlog
docs:
  - project.architecture
  - ./io/context/hint-extra.md
  - project.missing
-->

Important refs:

- \`project.overview\`
- \`./io/context/linked.md\`
- \`builtin:io.core.validation\`
`);
    const workflow = createWorkflow(root, promptPath);
    const resolved = await resolveIssueContext({
      baseSelection: { agent: "execute", profile: "execute" },
      issue,
      repoRoot: root,
      workflow,
    });
    const rendered = renderPrompt(renderContextBundle(resolved.bundle), {
      attempt: 1,
      issue: resolved.issue,
      selection: resolved.selection,
      worker: { count: 1, id: issue.identifier, index: 0 },
      workspace: createWorkspace(root),
    });

    expect(resolved.selection).toEqual({
      agent: "backlog",
      profile: "backlog",
    });
    expect(resolved.bundle.docs.map((doc) => doc.id)).toEqual([
      "builtin:io.agent.backlog.default",
      "builtin:io.context.discovery",
      "builtin:io.linear.status-updates",
      "builtin:io.core.git-safety",
      "context.entrypoint",
      "project.backlog",
      "project.architecture",
      "./io/context/hint-extra.md",
      "project.overview",
      "./io/context/linked.md",
      "builtin:io.core.validation",
      "issue.context",
    ]);
    expect(resolved.warnings).toEqual(["Unresolved issue doc reference: project.missing"]);
    expect(rendered).toContain("You are the IO Backlog Agent.");
    expect(rendered).not.toContain("You are the IO Execution Agent.");
    expect(rendered).toContain("LOCAL backlog backlog");
    expect(rendered).toContain("BACKLOG PROFILE DOC");
    expect(rendered).toContain("ARCHITECTURE DOC");
    expect(rendered).toContain("HINT EXTRA DOC");
    expect(rendered).toContain("OVERVIEW DOC");
    expect(rendered).toContain("LINKED DOC");
    expect(rendered).toContain("run the repo's required validation before declaring the work done");
    expect(rendered).toContain("Issue Description:");
    expect(rendered).toContain("Important refs:");
    expect(rendered).not.toContain("<!-- io");

    expect(rendered.indexOf("You are the IO Backlog Agent.")).toBeLessThan(
      rendered.indexOf("LOCAL backlog backlog"),
    );
    expect(rendered.indexOf("LOCAL backlog backlog")).toBeLessThan(
      rendered.indexOf("BACKLOG PROFILE DOC"),
    );
    expect(rendered.indexOf("BACKLOG PROFILE DOC")).toBeLessThan(
      rendered.indexOf("ARCHITECTURE DOC"),
    );
    expect(rendered.indexOf("LINKED DOC")).toBeLessThan(rendered.indexOf("Issue Description:"));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("resolveIssueContext supports doc-id overrides and profile entrypoint opt-out", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "context-"));
  await mkdir(resolve(root, "io", "context"), { recursive: true });
  await writeFile(resolve(root, "io.md"), "LOCAL {{ issue.identifier }}\n");
  await writeFile(resolve(root, "io", "context", "architecture.md"), "ARCHITECTURE DOC\n");
  await writeFile(resolve(root, "io", "context", "architecture-override.md"), "OVERRIDDEN DOC\n");

  try {
    const workflow = createWorkflow(root, resolve(root, "io.md"));
    workflow.context.overrides["project.architecture"] = resolve(
      root,
      "io",
      "context",
      "architecture-override.md",
    );
    workflow.context.profiles.execute = {
      include: ["project.architecture"],
      includeEntrypoint: false,
    };

    const resolved = await resolveIssueContext({
      baseSelection: { agent: "execute", profile: "execute" },
      issue: createIssue("Implement override behavior"),
      repoRoot: root,
      workflow,
    });

    expect(
      resolved.bundle.docs.map((doc) => ({
        id: doc.id,
        overridden: doc.overridden,
        path: doc.path,
        source: doc.source,
      })),
    ).toEqual([
      {
        id: "project.architecture",
        overridden: true,
        path: resolve(root, "io", "context", "architecture-override.md"),
        source: "registered",
      },
      {
        id: "issue.context",
        overridden: false,
        path: undefined,
        source: "synthesized",
      },
    ]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("repo backlog context points at the current stream workflow docs", async () => {
  const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
  process.env.LINEAR_API_KEY = "linear-token";
  process.env.LINEAR_PROJECT_SLUG = "io";

  const workflowResult = await loadWorkflowFile(undefined, repoRoot);
  expect(workflowResult.ok).toBe(true);
  if (!workflowResult.ok) {
    return;
  }

  const issue: AgentIssue = {
    blockedBy: [],
    createdAt: "2024-01-01T00:00:00.000Z",
    description: "Refine the agent stream backlog",
    hasChildren: true,
    hasParent: false,
    id: "1",
    identifier: "OPE-129",
    labels: ["planning", "io", "agent"],
    priority: 2,
    projectSlug: "io",
    state: "Todo",
    title: "Agent stream backlog",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };

  const resolved = await resolveIssueContext({
    baseSelection: resolveIssueRouting(
      workflowResult.value.issues,
      issue,
      workflowResult.value.modules,
    ),
    issue,
    repoRoot,
    workflow: workflowResult.value,
  });
  const rendered = renderPrompt(renderContextBundle(resolved.bundle), {
    attempt: 1,
    issue: resolved.issue,
    selection: resolved.selection,
    worker: { count: 1, id: issue.identifier, index: 0 },
    workspace: {
      branchName: "io/ope-129",
      controlPath: repoRoot,
      createdNow: true,
      originPath: repoRoot,
      path: resolve(repoRoot, ".io", "workers", issue.identifier, "repo"),
      workerId: issue.identifier,
    },
  });

  expect(resolved.selection).toEqual({
    agent: "backlog",
    profile: "backlog",
  });
  expect(resolved.bundle.docs.map((doc) => doc.id)).toContain("project.overview");
  expect(resolved.bundle.docs.map((doc) => doc.id)).toContain("project.backlog");
  expect(resolved.bundle.docs.map((doc) => doc.id)).toContain("project.goals");
  expect(resolved.bundle.docs.map((doc) => doc.id)).toContain("./agent/io/overview.md");
  expect(resolved.bundle.docs.map((doc) => doc.id)).toContain(
    "./agent/io/module-stream-workflow-plan.md",
  );
  expect(rendered).toContain("three-level Linear workflow");
  expect(rendered).toContain("Stream");
  expect(rendered).toContain("Feature");
  expect(rendered).toContain("Task");
  expect(rendered).toContain("do not use comment-driven workflows");
  expect(rendered).toContain("Current code centers on a three-level issue model");
  expect(rendered).not.toContain("@io backlog");
  expect(rendered).not.toContain("managed-stream");
});

test("repo config allows shared repo docs in stream issue descriptions without warning", async () => {
  const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
  process.env.LINEAR_API_KEY = "linear-token";
  process.env.LINEAR_PROJECT_SLUG = "io";

  const workflowResult = await loadWorkflowFile(undefined, repoRoot);
  expect(workflowResult.ok).toBe(true);
  if (!workflowResult.ok) {
    return;
  }

  const issue: AgentIssue = {
    blockedBy: [],
    createdAt: "2024-01-01T00:00:00.000Z",
    description: "Keep the stream description aligned with `./io/overview.md`.",
    hasChildren: true,
    hasParent: false,
    id: "1",
    identifier: "OPE-134",
    labels: ["io", "agent"],
    priority: 3,
    projectSlug: "io",
    state: "Todo",
    title: "Stream shared-doc refresh",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };

  const resolved = await resolveIssueContext({
    baseSelection: resolveIssueRouting(
      workflowResult.value.issues,
      issue,
      workflowResult.value.modules,
    ),
    issue,
    repoRoot,
    workflow: workflowResult.value,
  });

  expect(resolved.warnings).not.toContain(
    "Issue doc reference is outside module scope: ./io/overview.md",
  );
});

test("resolveIssueContext adds module docs and limits repo-path refs to module scope", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "context-"));
  const promptPath = resolve(root, "io.md");
  await mkdir(resolve(root, "agent", "doc"), { recursive: true });
  await mkdir(resolve(root, "graph", "doc"), { recursive: true });
  await mkdir(resolve(root, "io"), { recursive: true });
  await writeFile(promptPath, "LOCAL {{ selection.agent }} {{ selection.profile }}\n");
  await writeFile(resolve(root, "agent", "doc", "module-default.md"), "MODULE DEFAULT DOC\n");
  await writeFile(resolve(root, "agent", "doc", "linked.md"), "MODULE LINKED DOC\n");
  await writeFile(resolve(root, "graph", "doc", "outside.md"), "OUTSIDE MODULE DOC\n");
  await writeFile(resolve(root, "io", "shared.md"), "SHARED DOC\n");

  try {
    const workflow = createWorkflow(root, promptPath);
    workflow.modules = {
      agent: {
        allowedSharedPaths: [resolve(root, "io")],
        docs: ["./agent/doc/module-default.md"],
        id: "agent",
        path: resolve(root, "agent"),
      },
    };

    const resolvedWithLabels = await resolveIssueContext({
      baseSelection: { agent: "execute", profile: "execute" },
      issue: {
        ...createIssue(`Issue refs:

- \`./agent/doc/linked.md\`
- \`./io/shared.md\`
- \`./graph/doc/outside.md\`
`),
        labels: ["io", "agent"],
      },
      repoRoot: root,
      workflow,
    });

    expect(resolvedWithLabels.bundle.docs.map((doc) => doc.id)).toEqual([
      "builtin:io.agent.execute.default",
      "builtin:io.context.discovery",
      "builtin:io.linear.status-updates",
      "builtin:io.core.validation",
      "builtin:io.core.git-safety",
      "context.entrypoint",
      "./agent/doc/module-default.md",
      "./agent/doc/linked.md",
      "./io/shared.md",
      "issue.context",
    ]);
    expect(resolvedWithLabels.warnings).toEqual([
      "Issue doc reference is outside module scope: ./graph/doc/outside.md",
    ]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("resolveIssueContext assembles the graph module bundle and keeps refs within graph scope", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "context-"));
  const promptPath = resolve(root, "io.md");
  await mkdir(resolve(root, "agent", "doc"), { recursive: true });
  await mkdir(resolve(root, "graph", "io"), { recursive: true });
  await mkdir(resolve(root, "io"), { recursive: true });
  await writeFile(promptPath, "LOCAL {{ selection.agent }} {{ selection.profile }}\n");
  await writeFile(resolve(root, "graph", "io", "overview.md"), "GRAPH IO OVERVIEW DOC\n");
  await writeFile(resolve(root, "graph", "io", "architecture.md"), "GRAPH ARCHITECTURE DOC\n");
  await writeFile(resolve(root, "graph", "io", "linked.md"), "GRAPH LINKED DOC\n");
  await writeFile(resolve(root, "io", "shared.md"), "SHARED DOC\n");
  await writeFile(resolve(root, "agent", "doc", "outside.md"), "AGENT OUTSIDE DOC\n");

  try {
    const workflow = createWorkflow(root, promptPath);
    workflow.modules = {
      graph: {
        allowedSharedPaths: [resolve(root, "io")],
        docs: ["./graph/io/overview.md", "./graph/io/overview.md", "./graph/io/architecture.md"],
        id: "graph",
        path: resolve(root, "graph"),
      },
    };

    const resolved = await resolveIssueContext({
      baseSelection: { agent: "execute", profile: "execute" },
      issue: {
        ...createIssue(`Issue refs:

- \`./graph/io/linked.md\`
- \`./io/shared.md\`
- \`./agent/doc/outside.md\`
`),
        hasChildren: true,
        labels: ["io", "graph"],
      },
      repoRoot: root,
      workflow,
    });

    expect(resolved.selection).toEqual({
      agent: "execute",
      profile: "execute",
    });
    expect(resolved.bundle.docs.map((doc) => doc.id)).toEqual([
      "builtin:io.agent.execute.default",
      "builtin:io.context.discovery",
      "builtin:io.linear.status-updates",
      "builtin:io.core.validation",
      "builtin:io.core.git-safety",
      "context.entrypoint",
      "./graph/io/overview.md",
      "./graph/io/architecture.md",
      "./graph/io/linked.md",
      "./io/shared.md",
      "issue.context",
    ]);
    expect(resolved.warnings).toEqual([
      "Issue doc reference is outside module scope: ./agent/doc/outside.md",
    ]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
