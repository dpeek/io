import { expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  DEFAULT_EXECUTE_BUILTIN_DOC_IDS,
  resolveBuiltinDoc,
} from "./builtins.js";
import { resolveIssueRouting } from "./issue-routing.js";
import { AgentService, pickCandidateIssues } from "./service.js";
import type { AgentSessionEvent } from "./session-events.js";
import { LinearTrackerAdapter, normalizeLinearIssue } from "./tracker/linear.js";
import type { AgentIssue, PreparedWorkspace } from "./types.js";
import { renderPrompt } from "./workflow.js";

function createIssue(overrides: Partial<AgentIssue> = {}): AgentIssue {
  return {
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
    ...overrides,
  };
}

function createTaskIssue(overrides: Partial<AgentIssue> = {}): AgentIssue {
  return createIssue({
    grandparentIssueId: "stream-1",
    grandparentIssueIdentifier: "OPE-12",
    grandparentIssueState: "In Progress",
    grandparentIssueTitle: "Example stream",
    hasParent: true,
    id: "task-1",
    identifier: "OPE-54",
    parentIssueId: "feature-1",
    parentIssueIdentifier: "OPE-34",
    parentIssueState: "In Progress",
    parentIssueTitle: "Example feature",
    priority: 0,
    title: "Example task",
    ...overrides,
  });
}

function buildExpectedPrompt(
  builtinIds: readonly string[],
  promptPath: string,
  promptTemplate: string,
  issue: Parameters<typeof renderPrompt>[1]["issue"],
  workspace: PreparedWorkspace,
  selection?: Parameters<typeof renderPrompt>[1]["selection"],
) {
  return renderPrompt(
    [
      ...builtinIds.map((id) => `<!-- ${id} -->\n${resolveBuiltinDoc(id)!.content.trim()}`),
      `<!-- ${promptPath} -->\n${promptTemplate.trim()}`,
      issue.description
        ? "<!-- issue.context -->\nIssue Description:\n\n{{ issue.description }}"
        : "",
    ].join("\n\n"),
    {
      attempt: 1,
      issue,
      selection,
      worker: { count: 1, id: issue.identifier, index: 0 },
      workspace,
    },
  );
}

async function writeServiceTestRepo(root: string, overrides: Record<string, unknown> = {}) {
  await writeFile(
    resolve(root, "io.ts"),
    `export default ${JSON.stringify(
      {
        agent: { maxConcurrentAgents: 1 },
        tracker: {
          apiKey: "$LINEAR_API_KEY",
          kind: "linear",
          projectSlug: "$LINEAR_PROJECT_SLUG",
        },
        workspace: {
          root: resolve(root, "workspace"),
        },
        ...overrides,
      },
      null,
      2,
    )};\n`,
  );
  await writeFile(resolve(root, "io.md"), "Issue {{ issue.identifier }}\n");
  process.env.LINEAR_API_KEY = "linear-token";
  process.env.LINEAR_PROJECT_SLUG = "project-slug";
}

async function writeIoTsConfig(root: string, config: Record<string, unknown>) {
  await writeFile(resolve(root, "io.ts"), `export default ${JSON.stringify(config, null, 2)};\n`);
}

test("normalizeLinearIssue lowercases labels and fills defaults", () => {
  const issue = normalizeLinearIssue({
    children: {
      nodes: [{ id: "child-1" }],
    },
    createdAt: "2024-01-01T00:00:00.000Z",
    description: null,
    id: "1",
    identifier: "OS-7",
    inverseRelations: {
      nodes: [
        {
          relatedIssue: { id: "2", state: { name: "In Review" } },
          type: "blocks",
        },
        {
          relatedIssue: { id: "1", state: { name: "Todo" } },
          type: "blocks",
        },
        {
          relatedIssue: { id: "3", state: { name: "Done" } },
          type: "blocks",
        },
        {
          relatedIssue: { id: "4", state: { name: "Todo" } },
          type: "related",
        },
      ],
    },
    labels: { nodes: [{ name: "Bug" }, { name: " P1 " }, null] },
    parent: { id: "parent-1", identifier: "OS-1", state: { name: "In Progress" } },
    priority: 2,
    project: { slugId: "OpenSurf" },
    state: { name: "Todo" },
    title: "Fix integration",
    updatedAt: "2024-01-01T00:00:00.000Z",
  });
  expect(issue.labels).toEqual(["bug", "p1"]);
  expect(issue.description).toBe("");
  expect(issue.blockedBy).toEqual(["2"]);
  expect(issue.projectSlug).toBe("OpenSurf");
  expect(issue.hasParent).toBe(true);
  expect(issue.hasChildren).toBe(true);
  expect(issue.parentIssueId).toBe("parent-1");
  expect(issue.parentIssueIdentifier).toBe("OS-1");
  expect(issue.parentIssueState).toBe("In Progress");
  expect(issue.teamId).toBeUndefined();
});

test("normalizeLinearIssue leaves parent stream fields empty for standalone issues", () => {
  const issue = normalizeLinearIssue({
    children: {
      nodes: [],
    },
    createdAt: "2024-01-01T00:00:00.000Z",
    description: "Standalone stream",
    id: "10",
    identifier: "OPE-147",
    inverseRelations: {
      nodes: [],
    },
    labels: { nodes: [{ name: "io" }, { name: "agent" }] },
    parent: {
      id: "   ",
      identifier: "OPE-147",
      state: { name: "In Review" },
    },
    priority: 0,
    project: { slugId: "io" },
    state: { name: "In Review" },
    team: { id: "team-1" },
    title: "Current Approach Stream",
    updatedAt: "2024-01-01T00:00:00.000Z",
  });

  expect(issue.hasParent).toBe(false);
  expect(issue.parentIssueId).toBeUndefined();
  expect(issue.parentIssueIdentifier).toBeUndefined();
  expect(issue.parentIssueState).toBeUndefined();
  expect(issue.teamId).toBe("team-1");
});

test("LinearTrackerAdapter fetches parent stream state for child issue candidates", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: { query?: string; variables?: Record<string, unknown> } | undefined;
  globalThis.fetch = mock(async (_input, init) => {
    requestBody = JSON.parse(String(init?.body ?? "{}")) as typeof requestBody;

    return new Response(
      JSON.stringify({
        data: {
          issues: {
            nodes: [
              {
                children: { nodes: [] },
                createdAt: "2024-01-02T00:00:00.000Z",
                description: "Child execution issue",
                id: "child-1",
                identifier: "OPE-149",
                inverseRelations: { nodes: [] },
                labels: { nodes: [{ name: "agent" }] },
                parent: {
                  id: "parent-1",
                  identifier: "OPE-147",
                  state: { name: "In Review" },
                },
                priority: 0,
                project: { slugId: "io" },
                state: { name: "Todo" },
                team: { id: "team-1" },
                title: "Teach candidate issues to carry parent stream state",
                updatedAt: "2024-01-02T00:00:00.000Z",
              },
              {
                children: { nodes: [{ id: "child-1" }] },
                createdAt: "2024-01-01T00:00:00.000Z",
                description: "Managed parent",
                id: "parent-1",
                identifier: "OPE-147",
                inverseRelations: { nodes: [] },
                labels: { nodes: [{ name: "io" }, { name: "agent" }] },
                parent: null,
                priority: 0,
                project: { slugId: "io" },
                state: { name: "In Review" },
                team: { id: "team-1" },
                title: "Current Approach Stream",
                updatedAt: "2024-01-01T00:00:00.000Z",
              },
            ],
            pageInfo: {
              endCursor: null,
              hasNextPage: false,
            },
          },
        },
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;

  try {
    const tracker = new LinearTrackerAdapter({
      activeStates: ["Todo", "In Review"],
      apiKey: "token",
      endpoint: "https://linear.invalid/graphql",
      kind: "linear",
      projectSlug: "io",
      terminalStates: ["Done"],
    });

    const issues = await tracker.fetchCandidateIssues();

    expect(requestBody?.query).toContain("parent {");
    expect(requestBody?.query).toContain("identifier");
    expect(requestBody?.query).toContain("state { name }");
    expect(issues).toHaveLength(2);
    expect(issues[0]).toMatchObject({
      hasParent: true,
      identifier: "OPE-149",
      parentIssueId: "parent-1",
      parentIssueIdentifier: "OPE-147",
      parentIssueState: "In Review",
    });
    expect(issues[1]).toMatchObject({
      hasChildren: true,
      hasParent: false,
      identifier: "OPE-147",
    });
    expect(issues[1]?.parentIssueId).toBeUndefined();
    expect(issues[1]?.parentIssueIdentifier).toBeUndefined();
    expect(issues[1]?.parentIssueState).toBeUndefined();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("pickCandidateIssues prefers unblocked todo issues by priority", () => {
  const selected = pickCandidateIssues(
    [
      createIssue({
        blockedBy: ["OS-1"],
        id: "3",
        identifier: "OS-3",
        priority: 5,
        state: "Todo",
        title: "Blocked",
      }),
      createIssue({
        id: "2",
        identifier: "OS-2",
        priority: 1,
        state: "In Progress",
        title: "Later",
        updatedAt: "2024-01-02T00:00:00.000Z",
      }),
      createIssue({
        id: "1",
        identifier: "OS-1",
        priority: 3,
        state: "Todo",
        title: "First",
        updatedAt: "2024-01-03T00:00:00.000Z",
      }),
    ],
    2,
  );
  expect(selected.map((issue) => issue.identifier)).toEqual(["OS-1", "OS-2"]);
});

test("pickCandidateIssues keeps stream execution to one issue per parent", () => {
  const selected = pickCandidateIssues(
    [
      createIssue({
        id: "2",
        identifier: "OS-2",
        parentIssueId: "1",
        parentIssueIdentifier: "OS-1",
        parentIssueState: "In Progress",
        hasParent: true,
        priority: 2,
        updatedAt: "2024-01-01T00:00:00.000Z",
      }),
      createIssue({
        id: "3",
        identifier: "OS-3",
        parentIssueId: "1",
        parentIssueIdentifier: "OS-1",
        parentIssueState: "In Progress",
        hasParent: true,
        priority: 1,
        updatedAt: "2024-01-02T00:00:00.000Z",
      }),
      createIssue({
        id: "4",
        identifier: "OS-4",
        priority: 1,
        updatedAt: "2024-01-03T00:00:00.000Z",
      }),
    ],
    3,
  );
  expect(selected.map((issue) => issue.identifier)).toEqual(["OS-2", "OS-4"]);
});

test("pickCandidateIssues allows parallel tasks from different features in the same stream", () => {
  const selected = pickCandidateIssues(
    [
      createTaskIssue({
        id: "2",
        identifier: "OS-2",
        parentIssueId: "feature-1",
        parentIssueIdentifier: "OS-10",
        grandparentIssueId: "stream-1",
        grandparentIssueIdentifier: "OS-1",
        updatedAt: "2024-01-01T00:00:00.000Z",
      }),
      createTaskIssue({
        id: "3",
        identifier: "OS-3",
        parentIssueId: "feature-2",
        parentIssueIdentifier: "OS-11",
        grandparentIssueId: "stream-1",
        grandparentIssueIdentifier: "OS-1",
        updatedAt: "2024-01-02T00:00:00.000Z",
      }),
    ],
    2,
  );
  expect(selected.map((issue) => issue.identifier)).toEqual(["OS-2", "OS-3"]);
});

test("pickCandidateIssues leaves parent-state gating to the scheduler", () => {
  const selected = pickCandidateIssues(
    [
      createIssue({
        id: "2",
        identifier: "OS-2",
        parentIssueId: "1",
        parentIssueIdentifier: "OS-1",
        parentIssueState: "In Review",
        hasParent: true,
        priority: 3,
        updatedAt: "2024-01-01T00:00:00.000Z",
      }),
      createIssue({
        id: "3",
        identifier: "OS-3",
        parentIssueId: "10",
        parentIssueIdentifier: "OS-10",
        parentIssueState: "In Progress",
        hasParent: true,
        priority: 2,
        updatedAt: "2024-01-02T00:00:00.000Z",
      }),
      createIssue({
        id: "4",
        identifier: "OS-4",
        parentIssueId: "11",
        parentIssueIdentifier: "OS-11",
        parentIssueState: "Todo",
        hasParent: true,
        priority: 1,
        updatedAt: "2024-01-03T00:00:00.000Z",
      }),
      createIssue({
        id: "5",
        identifier: "OS-5",
        parentIssueId: "12",
        parentIssueIdentifier: "OS-12",
        parentIssueState: "Done",
        hasParent: true,
        priority: 0,
        updatedAt: "2024-01-04T00:00:00.000Z",
      }),
      createIssue({
        id: "6",
        identifier: "OS-4",
        priority: 1,
        updatedAt: "2024-01-05T00:00:00.000Z",
      }),
    ],
    3,
  );
  expect(selected.map((issue) => issue.identifier)).toEqual(["OS-2", "OS-3", "OS-4"]);
});

test("pickCandidateIssues prefers the locally active issue within an occupied stream", () => {
  const selected = pickCandidateIssues(
    [
      createIssue({
        id: "2",
        identifier: "OS-2",
        parentIssueId: "1",
        parentIssueIdentifier: "OS-1",
        parentIssueState: "In Progress",
        hasParent: true,
        priority: 2,
        updatedAt: "2024-01-01T00:00:00.000Z",
      }),
      createIssue({
        id: "3",
        identifier: "OS-3",
        parentIssueId: "1",
        parentIssueIdentifier: "OS-1",
        parentIssueState: "In Progress",
        hasParent: true,
        priority: 1,
        updatedAt: "2024-01-02T00:00:00.000Z",
      }),
      createIssue({
        id: "4",
        identifier: "OS-4",
        priority: 1,
        updatedAt: "2024-01-03T00:00:00.000Z",
      }),
    ],
    3,
    new Map([["os-1", "OS-3"]]),
  );
  expect(selected.map((issue) => issue.identifier)).toEqual(["OS-3", "OS-4"]);
});

test("AgentService does not auto-run child issues while the parent stream is not In Progress", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-service-"));
  let runnerCalls = 0;
  const transitions: string[] = [];

  await writeIoTsConfig(root, {
    agent: { maxConcurrentAgents: 1 },
    tracker: {
      apiKey: "$LINEAR_API_KEY",
      kind: "linear",
      projectSlug: "$LINEAR_PROJECT_SLUG",
    },
    workspace: {
      root: resolve(root, "workspace"),
    },
  });
  await writeFile(resolve(root, "io.md"), "Issue {{ issue.identifier }}\n");
  process.env.LINEAR_API_KEY = "linear-token";
  process.env.LINEAR_PROJECT_SLUG = "project-slug";

  try {
    const issue = createIssue({
      hasParent: true,
      id: "child-1",
      identifier: "OPE-59",
      parentIssueId: "parent-1",
      parentIssueIdentifier: "OPE-12",
      parentIssueState: "In Review",
      priority: 0,
      title: "Child issue",
    });
    const service = new AgentService({
      once: true,
      repoRoot: root,
      runnerFactory: () => ({
        run: async ({ issue, prompt, workspace }) => {
          runnerCalls += 1;
          return {
            issue,
            prompt,
            stderr: [],
            stdout: [],
            success: true,
            workspace,
          };
        },
      }),
      trackerFactory: () => ({
        fetchCandidateIssues: async () => [issue],
        fetchIssueStatesByIds: async () => new Map(),
        setIssueState: async (issueId, stateName) => {
          transitions.push(`${issueId}:${stateName}`);
        },
      }),
      workspaceManagerFactory: (_workflow, issueIdentifier) =>
        ({
          cleanup: async () => undefined,
          complete: async () => ({ commitSha: "a".repeat(40) }),
          createIdleWorkspace: () => ({
            branchName: "main",
            controlPath: root,
            createdNow: true,
            originPath: root,
            path: resolve(root, "workspace", "workers", issueIdentifier ?? "supervisor", "repo"),
            sourceRepoPath: root,
            workerId: issueIdentifier ?? "supervisor",
          }),
          ensureCheckout: async () => ({
            createdNow: true,
            path: resolve(root, "workspace", "workers", issueIdentifier ?? "supervisor", "repo"),
          }),
          ensureSessionStartState: async () => ({
            createdNow: true,
            path: resolve(root, "workspace", "workers"),
          }),
          listOccupiedStreams: async () => new Map(),
          reconcileTerminalIssues: async () => undefined,
        }) as unknown as never,
    });

    await service.start();
    expect(runnerCalls).toBe(0);
    expect(transitions).toEqual([]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("AgentService does not auto-run task issues while the stream is not In Progress", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-service-"));
  let runnerCalls = 0;

  await writeIoTsConfig(root, {
    agent: { maxConcurrentAgents: 1 },
    tracker: {
      apiKey: "$LINEAR_API_KEY",
      kind: "linear",
      projectSlug: "$LINEAR_PROJECT_SLUG",
    },
    workspace: {
      root: resolve(root, "workspace"),
    },
  });
  await writeFile(resolve(root, "io.md"), "Issue {{ issue.identifier }}\n");
  process.env.LINEAR_API_KEY = "linear-token";
  process.env.LINEAR_PROJECT_SLUG = "project-slug";

  try {
    const issue = createTaskIssue({
      grandparentIssueState: "Todo",
      id: "task-1",
      identifier: "OPE-60",
      title: "Task issue",
    });
    const service = new AgentService({
      once: true,
      repoRoot: root,
      runnerFactory: () => ({
        run: async ({ issue, prompt, workspace }) => {
          runnerCalls += 1;
          return {
            issue,
            prompt,
            stderr: [],
            stdout: [],
            success: true,
            workspace,
          };
        },
      }),
      trackerFactory: () => ({
        fetchCandidateIssues: async () => [issue],
        fetchIssueStatesByIds: async () => new Map(),
        setIssueState: async () => undefined,
      }),
      workspaceManagerFactory: (_workflow, issueIdentifier) =>
        ({
          cleanup: async () => undefined,
          complete: async () => ({ commitSha: "a".repeat(40) }),
          createIdleWorkspace: () => ({
            branchName: "main",
            controlPath: root,
            createdNow: true,
            originPath: root,
            path: resolve(root, "workspace", "workers", issueIdentifier ?? "supervisor", "repo"),
            sourceRepoPath: root,
            workerId: issueIdentifier ?? "supervisor",
          }),
          ensureCheckout: async () => ({
            createdNow: true,
            path: resolve(root, "workspace", "workers", issueIdentifier ?? "supervisor", "repo"),
          }),
          ensureSessionStartState: async () => ({
            createdNow: true,
            path: resolve(root, "workspace", "workers"),
          }),
          listOccupiedStreams: async () => new Map(),
          reconcileTerminalIssues: async () => undefined,
        }) as unknown as never,
    });

    await service.start();
    expect(runnerCalls).toBe(0);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("resolveIssueRouting uses repo defaults and first matching rule precedence", () => {
  const issue = createIssue({
    hasChildren: true,
    labels: ["planning", "docs"],
    state: "Todo",
  });

  expect(
    resolveIssueRouting(
      {
        defaultAgent: "execute",
        defaultProfile: "execute",
        routing: [
          {
            agent: "backlog",
            if: { stateIn: ["todo"] },
            profile: "triage",
          },
          {
            agent: "execute",
            if: { hasChildren: true, labelsAny: ["planning"] },
            profile: "docs",
          },
        ],
      },
      issue,
    ),
  ).toEqual({
    agent: "backlog",
    profile: "triage",
  });
});

test("resolveIssueRouting no longer infers backlog mode from module labels alone", () => {
  expect(
    resolveIssueRouting(
      {
        defaultAgent: "execute",
        defaultProfile: "execute",
        routing: [],
      },
      createIssue({
        hasChildren: true,
        labels: ["io", "agent"],
      }),
      {
        agent: {
          allowedSharedPaths: [],
          docs: [],
          id: "agent",
          path: "/tmp/agent",
        },
      },
    ),
  ).toEqual({
    agent: "execute",
    profile: "execute",
  });
});

test("resolveIssueRouting ignores ambiguous module labels without explicit routing", () => {
  expect(
    resolveIssueRouting(
      {
        defaultAgent: "execute",
        defaultProfile: "execute",
        routing: [],
      },
      createIssue({
        hasChildren: true,
        labels: ["io", "agent", "graph"],
      }),
      {
        agent: {
          allowedSharedPaths: [],
          docs: [],
          id: "agent",
          path: "/tmp/agent",
        },
        graph: {
          allowedSharedPaths: [],
          docs: [],
          id: "graph",
          path: "/tmp/graph",
        },
      },
    ),
  ).toEqual({
    agent: "execute",
    profile: "execute",
  });
});

test("AgentService does not auto-run non-task parent issues", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-service-"));
  let runnerCalls = 0;
  const transitions: string[] = [];

  await writeIoTsConfig(root, {
    agent: { maxConcurrentAgents: 1 },
    modules: {
      agent: {
        allowedSharedPaths: ["./io"],
        docs: ["./agent/io/overview.md"],
        path: "./agent",
      },
    },
    tracker: {
      apiKey: "$LINEAR_API_KEY",
      kind: "linear",
      projectSlug: "$LINEAR_PROJECT_SLUG",
    },
    workspace: {
      root: resolve(root, "workspace"),
    },
  });
  await mkdir(resolve(root, "agent", "io"), { recursive: true });
  await writeFile(resolve(root, "agent", "io", "overview.md"), "# Agent\n");
  await writeFile(resolve(root, "io.md"), "Issue {{ issue.identifier }}\n");
  process.env.LINEAR_API_KEY = "linear-token";
  process.env.LINEAR_PROJECT_SLUG = "project-slug";

  try {
    const issue = createIssue({
      hasChildren: true,
      id: "parent-1",
      identifier: "OPE-147",
      labels: ["io", "agent"],
      priority: 0,
      state: "In Progress",
      title: "Stream parent issue",
    });
    const service = new AgentService({
      once: true,
      repoRoot: root,
      runnerFactory: () => ({
        run: async ({ issue, prompt, workspace }) => {
          runnerCalls += 1;
          return {
            issue,
            prompt,
            stderr: [],
            stdout: [],
            success: true,
            workspace,
          };
        },
      }),
      trackerFactory: () => ({
        fetchCandidateIssues: async () => [issue],
        fetchIssueStatesByIds: async () => new Map(),
        setIssueState: async (issueId, stateName) => {
          transitions.push(`${issueId}:${stateName}`);
        },
      }),
      workspaceManagerFactory: (_workflow, issueIdentifier) =>
        ({
          cleanup: async () => undefined,
          complete: async () => ({ commitSha: "a".repeat(40) }),
          createIdleWorkspace: () => ({
            branchName: "main",
            controlPath: root,
            createdNow: true,
            originPath: root,
            path: resolve(root, "workspace", "workers", issueIdentifier ?? "supervisor", "repo"),
            sourceRepoPath: root,
            workerId: issueIdentifier ?? "supervisor",
          }),
          ensureCheckout: async () => ({
            createdNow: true,
            path: resolve(root, "workspace", "workers", issueIdentifier ?? "supervisor", "repo"),
          }),
          ensureSessionStartState: async () => ({
            createdNow: true,
            path: resolve(root, "workspace", "workers"),
          }),
          listOccupiedStreams: async () => new Map(),
          reconcileTerminalIssues: async () => undefined,
        }) as unknown as never,
    });

    await service.start();
    expect(runnerCalls).toBe(0);
    expect(transitions).toEqual([]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("AgentService marks task issues Done after landing on the feature branch", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-service-"));
  const workspacePath = resolve(root, "workspace", "workers", "OPE-58", "repo");
  const transitions: string[] = [];

  await writeServiceTestRepo(root);

  try {
    const issue = createTaskIssue({
      id: "child-1",
      identifier: "OPE-58",
      parentIssueId: "feature-1",
      parentIssueIdentifier: "OPE-34",
      parentIssueTitle: "Feature issue",
      grandparentIssueId: "stream-1",
      grandparentIssueIdentifier: "OPE-12",
      grandparentIssueState: "In Progress",
      priority: 0,
      title: "Task issue",
    });
    const service = new AgentService({
      once: true,
      repoRoot: root,
      runnerFactory: () => ({
        run: async ({ issue, prompt, workspace }) => ({
          issue,
          prompt,
          stderr: [],
          stdout: [],
          success: true,
          workspace,
        }),
      }),
      trackerFactory: () => ({
        fetchCandidateIssues: async () => [issue],
        fetchIssueStatesByIds: async () => new Map(),
        setIssueState: async (issueId, stateName) => {
          transitions.push(`${issueId}:${stateName}`);
        },
      }),
      workspaceManagerFactory: (_workflow, issueIdentifier) =>
        ({
          cleanup: async () => undefined,
          complete: async () => ({ commitSha: "a".repeat(40) }),
          createIdleWorkspace: () => ({
            branchName: "main",
            controlPath: root,
            createdNow: true,
            originPath: root,
            path: resolve(root, "workspace", "workers", issueIdentifier ?? "supervisor", "repo"),
            sourceRepoPath: root,
            workerId: issueIdentifier ?? "supervisor",
          }),
          ensureCheckout: async () => ({
            createdNow: true,
            path: workspacePath,
          }),
          ensureSessionStartState: async () => ({
            createdNow: true,
            path: resolve(root, "workspace", "workers"),
          }),
          listOccupiedStreams: async () => new Map(),
          markBlocked: async () => undefined,
          markInterrupted: async () => undefined,
          prepare: async () => ({
            branchName: "io/ope-34",
            controlPath: root,
            createdNow: true,
            originPath: root,
            path: workspacePath,
            sourceRepoPath: root,
            streamIssueId: "feature-1",
            streamIssueIdentifier: "OPE-34",
            baseBranchName: "io/ope-12",
            baseIssueId: "stream-1",
            baseIssueIdentifier: "OPE-12",
            workerId: "OPE-58",
          }),
          reconcileTerminalIssues: async () => undefined,
          runAfterRunHook: async () => undefined,
          runBeforeRunHook: async () => undefined,
        }) as unknown as never,
    });

    await service.start();
    expect(transitions).toEqual(["child-1:In Progress", "child-1:Done"]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("AgentService preserves timed out runs as interrupted", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-service-"));
  const workspacePath = resolve(root, "workspace", "workers", "OPE-66", "repo");
  const events: string[] = [];

  await writeIoTsConfig(root, {
    agent: { maxConcurrentAgents: 1 },
    tracker: {
      apiKey: "$LINEAR_API_KEY",
      kind: "linear",
      projectSlug: "$LINEAR_PROJECT_SLUG",
    },
    workspace: {
      root: resolve(root, "workspace"),
    },
  });
  await writeFile(resolve(root, "io.md"), "Issue {{ issue.identifier }}\n");
  process.env.LINEAR_API_KEY = "linear-token";
  process.env.LINEAR_PROJECT_SLUG = "project-slug";

  try {
    const issue = createTaskIssue({
      id: "task-1",
      identifier: "OPE-66",
      parentIssueId: "feature-1",
      parentIssueIdentifier: "OPE-34",
      parentIssueState: "In Progress",
      grandparentIssueId: "stream-1",
      grandparentIssueIdentifier: "OPE-12",
      grandparentIssueState: "In Progress",
      priority: 0,
      title: "Resume interrupted task",
    });
    const service = new AgentService({
      once: true,
      repoRoot: root,
      runnerFactory: () => ({
        run: async () => {
          throw new Error("response_timeout");
        },
      }),
      trackerFactory: () => ({
        fetchCandidateIssues: async () => [issue],
        fetchIssueStatesByIds: async () => new Map(),
        setIssueState: async () => undefined,
      }),
      workspaceManagerFactory: (_workflow, issueIdentifier) =>
        ({
          cleanup: async () => undefined,
          complete: async () => ({ commitSha: "a".repeat(40) }),
          createIdleWorkspace: () => ({
            branchName: "main",
            controlPath: root,
            createdNow: true,
            originPath: root,
            path: resolve(root, "workspace", "workers", issueIdentifier ?? "supervisor", "repo"),
            sourceRepoPath: root,
            workerId: issueIdentifier ?? "supervisor",
          }),
          ensureCheckout: async () => ({
            createdNow: true,
            path: workspacePath,
          }),
          ensureSessionStartState: async () => ({
            createdNow: true,
            path: resolve(root, "workspace", "workers"),
          }),
          listOccupiedStreams: async () => new Map(),
          markBlocked: async () => {
            events.push("blocked");
          },
          markInterrupted: async () => {
            events.push("interrupted");
          },
          prepare: async () => ({
            branchName: "io/ope-34",
            controlPath: root,
            createdNow: true,
            originPath: root,
            path: workspacePath,
            sourceRepoPath: root,
            streamIssueId: "feature-1",
            streamIssueIdentifier: "OPE-34",
            baseBranchName: "io/ope-12",
            baseIssueId: "stream-1",
            baseIssueIdentifier: "OPE-12",
            workerId: "OPE-66",
          }),
          reconcileTerminalIssues: async () => undefined,
          runAfterRunHook: async () => undefined,
          runBeforeRunHook: async () => undefined,
        }) as unknown as never,
    });

    await service.start();
    expect(events).toEqual(["interrupted"]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("AgentService eagerly creates worker checkout on start", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-service-"));
  const writes: string[] = [];

  await writeIoTsConfig(root, {
    agent: { maxConcurrentAgents: 1 },
    tracker: {
      apiKey: "$LINEAR_API_KEY",
      kind: "linear",
      projectSlug: "$LINEAR_PROJECT_SLUG",
    },
    workspace: {
      root: resolve(root, "workspace"),
    },
  });
  await writeFile(resolve(root, "io.md"), "Issue {{ issue.identifier }}\n");
  process.env.LINEAR_API_KEY = "linear-token";
  process.env.LINEAR_PROJECT_SLUG = "project-slug";

  const originalWrite = process.stdout.write.bind(process.stdout);
  const originalFetch = globalThis.fetch;
  const writeSpy = mock((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  });
  process.stdout.write = writeSpy as typeof process.stdout.write;
  globalThis.fetch = mock(
    async () =>
      new Response(
        JSON.stringify({
          data: {
            issues: {
              nodes: [],
              pageInfo: {
                endCursor: null,
                hasNextPage: false,
              },
            },
          },
        }),
        { status: 200 },
      ),
  ) as unknown as typeof fetch;

  try {
    const service = new AgentService({
      once: true,
      repoRoot: root,
      workspaceManagerFactory: (_workflow, issueIdentifier) =>
        ({
          cleanup: async () => undefined,
          complete: async () => ({ commitSha: "a".repeat(40) }),
          createIdleWorkspace: () => ({
            branchName: "main",
            controlPath: root,
            createdNow: true,
            originPath: root,
            path: resolve(root, "workspace", "workers", issueIdentifier ?? "supervisor", "repo"),
            sourceRepoPath: root,
            workerId: issueIdentifier ?? "supervisor",
          }),
          ensureCheckout: async () => ({
            createdNow: true,
            path: resolve(root, "workspace", "workers", issueIdentifier ?? "supervisor", "repo"),
          }),
          ensureSessionStartState: async () => ({
            createdNow: true,
            path: resolve(root, "workspace", "workers", issueIdentifier ?? "supervisor", "repo"),
          }),
          listOccupiedStreams: async () => new Map(),
          reconcileTerminalIssues: async () => undefined,
        }) as unknown as never,
    });

    await service.start();
    expect(writes.some((entry) => entry.includes("IO is supervising"))).toBe(true);
    expect(writes.some((entry) => entry.includes("No issues"))).toBe(true);
  } finally {
    globalThis.fetch = originalFetch;
    process.stdout.write = originalWrite;
    await rm(root, { force: true, recursive: true });
  }
});

test("AgentService does not auto-run parent execute issues that already have children", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-service-"));
  let runnerCalls = 0;

  await writeIoTsConfig(root, {
    agent: { maxConcurrentAgents: 1 },
    tracker: {
      apiKey: "$LINEAR_API_KEY",
      kind: "linear",
      projectSlug: "$LINEAR_PROJECT_SLUG",
    },
    workspace: {
      root: resolve(root, "workspace"),
    },
  });
  await writeFile(resolve(root, "io.md"), "Issue {{ issue.identifier }}\n");
  process.env.LINEAR_API_KEY = "linear-token";
  process.env.LINEAR_PROJECT_SLUG = "project-slug";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock(
    async () =>
      new Response(
        JSON.stringify({
          data: {
            issues: {
              nodes: [
                {
                  children: {
                    nodes: [{ id: "child-1" }],
                  },
                  createdAt: "2024-01-01T00:00:00.000Z",
                  description: "Plan a stream",
                  id: "1",
                  identifier: "OPE-12",
                  labels: { nodes: [] },
                  priority: 0,
                  state: { name: "Todo" },
                  title: "Parent issue",
                  updatedAt: "2024-01-01T00:00:00.000Z",
                },
              ],
              pageInfo: {
                endCursor: null,
                hasNextPage: false,
              },
            },
          },
        }),
        { status: 200 },
      ),
  ) as unknown as typeof fetch;

  try {
    const service = new AgentService({
      once: true,
      repoRoot: root,
      runnerFactory: () => ({
        run: async ({ issue, prompt, workspace }) => {
          runnerCalls += 1;
          return {
            issue,
            prompt,
            stderr: [],
            stdout: [],
            success: true,
            workspace,
          };
        },
      }),
      workspaceManagerFactory: (_workflow, issueIdentifier) =>
        ({
          cleanup: async () => undefined,
          complete: async () => ({ commitSha: "a".repeat(40) }),
          createIdleWorkspace: () => ({
            branchName: "main",
            controlPath: root,
            createdNow: true,
            originPath: root,
            path: resolve(root, "workspace", "workers", issueIdentifier ?? "supervisor", "repo"),
            sourceRepoPath: root,
            workerId: issueIdentifier ?? "supervisor",
          }),
          ensureCheckout: async () => ({
            createdNow: true,
            path: resolve(root, "workspace", "workers", issueIdentifier ?? "supervisor", "repo"),
          }),
          ensureSessionStartState: async () => ({
            createdNow: true,
            path: resolve(root, "workspace", "workers", issueIdentifier ?? "supervisor", "repo"),
          }),
          listOccupiedStreams: async () => new Map(),
          reconcileTerminalIssues: async () => undefined,
        }) as unknown as never,
    });

    await service.start();
    expect(runnerCalls).toBe(0);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { force: true, recursive: true });
  }
});

test("AgentService publishes supervisor and worker session events", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-service-events-"));
  const workspacePath = resolve(root, "workspace", "workers", "OPE-54", "repo");
  const events: AgentSessionEvent[] = [];

  await writeIoTsConfig(root, {
    agent: { maxConcurrentAgents: 1 },
    tracker: {
      apiKey: "$LINEAR_API_KEY",
      kind: "linear",
      projectSlug: "$LINEAR_PROJECT_SLUG",
    },
    workspace: {
      root: resolve(root, "workspace"),
    },
  });
  await writeFile(resolve(root, "io.md"), "Issue {{ issue.identifier }}\n");
  process.env.LINEAR_API_KEY = "linear-token";
  process.env.LINEAR_PROJECT_SLUG = "project-slug";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock(
    async () =>
      new Response(
        JSON.stringify({
          data: {
            issues: {
              nodes: [
                {
                  children: {
                    nodes: [],
                  },
                  createdAt: "2024-01-01T00:00:00.000Z",
                  description: "Implement execute flow",
                  id: "1",
                  identifier: "OPE-54",
                  labels: { nodes: [] },
                  parent: {
                    id: "feature-1",
                    identifier: "OPE-34",
                    parent: {
                      id: "stream-1",
                      identifier: "OPE-12",
                      state: { name: "In Progress" },
                      title: "Example stream",
                    },
                    state: { name: "In Progress" },
                    title: "Example feature",
                  },
                  priority: 0,
                  state: { name: "Todo" },
                  title: "Execute agent",
                  updatedAt: "2024-01-01T00:00:00.000Z",
                },
              ],
              pageInfo: {
                endCursor: null,
                hasNextPage: false,
              },
            },
          },
        }),
        { status: 200 },
      ),
  ) as unknown as typeof fetch;

  try {
    const service = new AgentService({
      once: true,
      repoRoot: root,
      runnerFactory: () => ({
        run: async ({ issue, prompt, workspace }) => {
          return {
            issue,
            prompt,
            sessionId: "worker:OPE-54:1",
            stderr: [],
            stdout: [],
            success: true,
            workspace,
          };
        },
      }),
      trackerFactory: () => ({
        fetchCandidateIssues: async () => [
          createTaskIssue({
            id: "1",
            identifier: "OPE-54",
            priority: 0,
            title: "Execute agent",
          }),
        ],
        fetchIssueStatesByIds: async () => new Map(),
        setIssueState: async () => undefined,
      }),
      stdoutEvents: false,
      workspaceManagerFactory: (_workflow, issueIdentifier) =>
        ({
          cleanup: async () => undefined,
          complete: async () => ({ commitSha: "a".repeat(40) }),
          createIdleWorkspace: () => ({
            branchName: "main",
            controlPath: root,
            createdNow: true,
            originPath: root,
            path: resolve(root, "workspace", "workers", issueIdentifier ?? "supervisor", "repo"),
            sourceRepoPath: root,
            workerId: issueIdentifier ?? "supervisor",
          }),
          ensureCheckout: async () => ({
            createdNow: true,
            path: workspacePath,
          }),
          ensureSessionStartState: async () => ({
            createdNow: true,
            path: resolve(root, "workspace", "workers"),
          }),
          listOccupiedStreams: async () => new Map(),
          markBlocked: async () => undefined,
          markInterrupted: async () => undefined,
          prepare: async () => ({
            branchName: "io/ope-34",
            controlPath: root,
            createdNow: true,
            originPath: root,
            path: workspacePath,
            sourceRepoPath: root,
            streamIssueId: "feature-1",
            streamIssueIdentifier: "OPE-34",
            baseBranchName: "io/ope-12",
            baseIssueId: "stream-1",
            baseIssueIdentifier: "OPE-12",
            workerId: "OPE-54",
          }),
          reconcileTerminalIssues: async () => undefined,
          runAfterRunHook: async () => undefined,
          runBeforeRunHook: async () => undefined,
        }) as unknown as never,
    });
    service.observeSessionEvents((event) => {
      events.push(event);
    });

    await service.start();

    expect(
      events.some(
        (event) =>
          event.type === "status" && event.code === "ready" && event.session.id === "supervisor",
      ),
    ).toBe(true);

    const scheduledWorker = events.find(
      (event) =>
        event.type === "session" &&
        event.phase === "scheduled" &&
        event.session.issue?.identifier === "OPE-54",
    );
    expect(scheduledWorker).toBeDefined();
    expect(scheduledWorker?.session.parentSessionId).toBe("supervisor");

    expect(
      events.some(
        (event) =>
          event.type === "status" &&
          event.code === "issue-assigned" &&
          event.session.id === "supervisor" &&
          event.text?.includes("Starting agent in"),
      ),
    ).toBe(true);

    expect(
      events.some(
        (event) =>
          event.type === "status" &&
          event.code === "issue-committed" &&
          event.session.issue?.identifier === "OPE-54",
      ),
    ).toBe(true);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { force: true, recursive: true });
  }
});
test("AgentService composes execute built-ins with io.md", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-service-"));
  const ioPromptPath = resolve(root, "io.md");
  const localPrompt = "LOCAL EXECUTE {{ issue.identifier }}\n";
  const workspacePath = resolve(root, "workspace", "workers", "OPE-54", "repo");
  let capturedPrompt = "";

  await writeIoTsConfig(root, {
    agent: { maxConcurrentAgents: 1 },
    tracker: {
      apiKey: "$LINEAR_API_KEY",
      kind: "linear",
      projectSlug: "$LINEAR_PROJECT_SLUG",
    },
    workspace: {
      root: resolve(root, "workspace"),
    },
  });
  await writeFile(ioPromptPath, localPrompt);
  process.env.LINEAR_API_KEY = "linear-token";
  process.env.LINEAR_PROJECT_SLUG = "project-slug";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock(
    async () =>
      new Response(
        JSON.stringify({
          data: {
            issues: {
              nodes: [
                {
                  children: {
                    nodes: [],
                  },
                  createdAt: "2024-01-01T00:00:00.000Z",
                  description: "Implement execute flow",
                  id: "1",
                  identifier: "OPE-54",
                  labels: { nodes: [] },
                  parent: {
                    id: "feature-1",
                    identifier: "OPE-34",
                    parent: {
                      id: "stream-1",
                      identifier: "OPE-12",
                      state: { name: "In Progress" },
                      title: "Example stream",
                    },
                    state: { name: "In Progress" },
                    title: "Example feature",
                  },
                  priority: 0,
                  state: { name: "Todo" },
                  title: "Execute agent",
                  updatedAt: "2024-01-01T00:00:00.000Z",
                },
              ],
              pageInfo: {
                endCursor: null,
                hasNextPage: false,
              },
            },
          },
        }),
        { status: 200 },
      ),
  ) as unknown as typeof fetch;

  try {
    const service = new AgentService({
      once: true,
      repoRoot: root,
      trackerFactory: (workflow) =>
        Object.assign(new LinearTrackerAdapter(workflow.tracker), {
          setIssueState: async () => undefined,
        }),
      runnerFactory: () => ({
        run: async ({ issue, prompt, workspace }) => {
          capturedPrompt = prompt;
          return {
            issue,
            prompt,
            stderr: [],
            stdout: [],
            success: true,
            workspace,
          };
        },
      }),
      workspaceManagerFactory: (_workflow, issueIdentifier) =>
        ({
          cleanup: async () => undefined,
          complete: async () => ({ commitSha: "a".repeat(40) }),
          createIdleWorkspace: () => ({
            branchName: "main",
            controlPath: root,
            createdNow: true,
            originPath: root,
            path: resolve(root, "workspace", "workers", issueIdentifier ?? "supervisor", "repo"),
            sourceRepoPath: root,
            workerId: issueIdentifier ?? "supervisor",
          }),
          ensureCheckout: async () => ({
            createdNow: true,
            path: workspacePath,
          }),
          ensureSessionStartState: async () => ({
            createdNow: true,
            path: resolve(root, "workspace", "workers"),
          }),
          listOccupiedStreams: async () => new Map(),
          markBlocked: async () => undefined,
          markInterrupted: async () => undefined,
          prepare: async () => ({
            branchName: "io/ope-34",
            controlPath: root,
            createdNow: true,
            originPath: root,
            path: workspacePath,
            sourceRepoPath: root,
            streamIssueId: "feature-1",
            streamIssueIdentifier: "OPE-34",
            baseBranchName: "io/ope-12",
            baseIssueId: "stream-1",
            baseIssueIdentifier: "OPE-12",
            workerId: "OPE-54",
          }),
          reconcileTerminalIssues: async () => undefined,
          runAfterRunHook: async () => undefined,
          runBeforeRunHook: async () => undefined,
        }) as unknown as never,
    });

    await service.start();
    expect(capturedPrompt).toBe(
      buildExpectedPrompt(
        DEFAULT_EXECUTE_BUILTIN_DOC_IDS,
        ioPromptPath,
        localPrompt,
        createTaskIssue({
          blockedBy: [],
          createdAt: "2024-01-01T00:00:00.000Z",
          description: "Implement execute flow",
          id: "1",
          identifier: "OPE-54",
          labels: [],
          priority: 0,
          state: "Todo",
          title: "Execute agent",
          updatedAt: "2024-01-01T00:00:00.000Z",
        }),
        {
          branchName: "io/ope-34",
          controlPath: root,
          createdNow: true,
          originPath: root,
          path: workspacePath,
          streamIssueId: "feature-1",
          streamIssueIdentifier: "OPE-34",
          baseBranchName: "io/ope-12",
          baseIssueId: "stream-1",
          baseIssueIdentifier: "OPE-12",
          workerId: "OPE-54",
        },
        {
          agent: "execute",
          profile: "execute",
        },
      ),
    );
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { force: true, recursive: true });
  }
});

test("AgentService uses builtin override files from io.ts", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-service-"));
  const overridePath = resolve(root, "io", "context", "validation-override.md");
  const ioPromptPath = resolve(root, "io.md");
  const localPrompt = "LOCAL EXECUTE {{ issue.identifier }}\n";
  const workspacePath = resolve(root, "workspace", "workers", "OPE-56", "repo");
  let capturedPrompt = "";

  await mkdir(resolve(root, "io", "context"), { recursive: true });
  await writeIoTsConfig(root, {
    agent: { maxConcurrentAgents: 1 },
    context: {
      overrides: {
        "builtin:io.core.validation": "./io/context/validation-override.md",
      },
    },
    tracker: {
      apiKey: "$LINEAR_API_KEY",
      kind: "linear",
      projectSlug: "$LINEAR_PROJECT_SLUG",
    },
    workspace: {
      root: resolve(root, "workspace"),
    },
  });
  await writeFile(ioPromptPath, localPrompt);
  await writeFile(overridePath, "VALIDATE WITH OVERRIDE {{ issue.identifier }}\n");
  process.env.LINEAR_API_KEY = "linear-token";
  process.env.LINEAR_PROJECT_SLUG = "project-slug";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock(
    async () =>
      new Response(
        JSON.stringify({
          data: {
            issues: {
              nodes: [
                {
                  children: {
                    nodes: [],
                  },
                  createdAt: "2024-01-01T00:00:00.000Z",
                  description: "Implement execute flow",
                  id: "1",
                  identifier: "OPE-56",
                  labels: { nodes: [] },
                  parent: {
                    id: "feature-1",
                    identifier: "OPE-34",
                    parent: {
                      id: "stream-1",
                      identifier: "OPE-12",
                      state: { name: "In Progress" },
                      title: "Example stream",
                    },
                    state: { name: "In Progress" },
                    title: "Example feature",
                  },
                  priority: 0,
                  state: { name: "Todo" },
                  title: "Execute agent override",
                  updatedAt: "2024-01-01T00:00:00.000Z",
                },
              ],
              pageInfo: {
                endCursor: null,
                hasNextPage: false,
              },
            },
          },
        }),
        { status: 200 },
      ),
  ) as unknown as typeof fetch;

  try {
    const service = new AgentService({
      once: true,
      repoRoot: root,
      trackerFactory: (workflow) =>
        Object.assign(new LinearTrackerAdapter(workflow.tracker), {
          setIssueState: async () => undefined,
        }),
      runnerFactory: () => ({
        run: async ({ issue, prompt, workspace }) => {
          capturedPrompt = prompt;
          return {
            issue,
            prompt,
            stderr: [],
            stdout: [],
            success: true,
            workspace,
          };
        },
      }),
      workspaceManagerFactory: (_workflow, issueIdentifier) =>
        ({
          cleanup: async () => undefined,
          complete: async () => ({ commitSha: "a".repeat(40) }),
          createIdleWorkspace: () => ({
            branchName: "main",
            controlPath: root,
            createdNow: true,
            originPath: root,
            path: resolve(root, "workspace", "workers", issueIdentifier ?? "supervisor", "repo"),
            sourceRepoPath: root,
            workerId: issueIdentifier ?? "supervisor",
          }),
          ensureCheckout: async () => ({
            createdNow: true,
            path: workspacePath,
          }),
          ensureSessionStartState: async () => ({
            createdNow: true,
            path: resolve(root, "workspace", "workers"),
          }),
          listOccupiedStreams: async () => new Map(),
          markBlocked: async () => undefined,
          markInterrupted: async () => undefined,
          prepare: async () => ({
            branchName: "io/ope-34",
            controlPath: root,
            createdNow: true,
            originPath: root,
            path: workspacePath,
            sourceRepoPath: root,
            streamIssueId: "feature-1",
            streamIssueIdentifier: "OPE-34",
            baseBranchName: "io/ope-12",
            baseIssueId: "stream-1",
            baseIssueIdentifier: "OPE-12",
            workerId: "OPE-56",
          }),
          reconcileTerminalIssues: async () => undefined,
          runAfterRunHook: async () => undefined,
          runBeforeRunHook: async () => undefined,
        }) as unknown as never,
    });

    await service.start();
    expect(capturedPrompt).toContain("VALIDATE WITH OVERRIDE OPE-56");
    expect(capturedPrompt).not.toContain(
      "run the repo's required validation before declaring the work done",
    );
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { force: true, recursive: true });
  }
});

test("AgentService writes unresolved issue doc warnings to the run summary", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-service-"));
  const ioPromptPath = resolve(root, "io.md");
  const outputPath = resolve(root, "workspace", "workers", "OPE-61", "output.log");
  const workspacePath = resolve(root, "workspace", "workers", "OPE-61", "repo");
  let capturedPrompt = "";

  await mkdir(resolve(root, "io", "context"), { recursive: true });
  await mkdir(resolve(root, "workspace", "workers", "OPE-61"), { recursive: true });
  await writeIoTsConfig(root, {
    agent: { maxConcurrentAgents: 1 },
    tracker: {
      apiKey: "$LINEAR_API_KEY",
      kind: "linear",
      projectSlug: "$LINEAR_PROJECT_SLUG",
    },
    workspace: {
      root: resolve(root, "workspace"),
    },
  });
  await writeFile(ioPromptPath, "LOCAL EXECUTE {{ issue.identifier }}\n");
  await writeFile(resolve(root, "io", "context", "linked.md"), "LINKED ISSUE DOC\n");
  process.env.LINEAR_API_KEY = "linear-token";
  process.env.LINEAR_PROJECT_SLUG = "project-slug";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock(
    async () =>
      new Response(
        JSON.stringify({
          data: {
            issues: {
              nodes: [
                {
                  children: {
                    nodes: [],
                  },
                  createdAt: "2024-01-01T00:00:00.000Z",
                  description: `Investigate warning handling

<!-- io
docs:
  - ./io/context/linked.md
  - ./io/context/missing.md
-->`,
                  id: "1",
                  identifier: "OPE-61",
                  labels: { nodes: [] },
                  parent: {
                    id: "feature-1",
                    identifier: "OPE-34",
                    parent: {
                      id: "stream-1",
                      identifier: "OPE-12",
                      state: { name: "In Progress" },
                      title: "Example stream",
                    },
                    state: { name: "In Progress" },
                    title: "Example feature",
                  },
                  priority: 0,
                  state: { name: "Todo" },
                  title: "Issue docs warning",
                  updatedAt: "2024-01-01T00:00:00.000Z",
                },
              ],
              pageInfo: {
                endCursor: null,
                hasNextPage: false,
              },
            },
          },
        }),
        { status: 200 },
      ),
  ) as unknown as typeof fetch;

  try {
    const service = new AgentService({
      once: true,
      repoRoot: root,
      trackerFactory: (workflow) =>
        Object.assign(new LinearTrackerAdapter(workflow.tracker), {
          setIssueState: async () => undefined,
        }),
      runnerFactory: () => ({
        run: async ({ issue, prompt, workspace }) => {
          capturedPrompt = prompt;
          return {
            issue,
            prompt,
            stderr: [],
            stdout: [],
            success: true,
            workspace,
          };
        },
      }),
      workspaceManagerFactory: (_workflow, issueIdentifier) =>
        ({
          cleanup: async () => undefined,
          complete: async () => ({ commitSha: "a".repeat(40) }),
          createIdleWorkspace: () => ({
            branchName: "main",
            controlPath: root,
            createdNow: true,
            originPath: root,
            outputPath,
            path: resolve(root, "workspace", "workers", issueIdentifier ?? "supervisor", "repo"),
            sourceRepoPath: root,
            workerId: issueIdentifier ?? "supervisor",
          }),
          ensureCheckout: async () => ({
            createdNow: true,
            path: workspacePath,
          }),
          ensureSessionStartState: async () => ({
            createdNow: true,
            path: resolve(root, "workspace", "workers"),
          }),
          listOccupiedStreams: async () => new Map(),
          markBlocked: async () => undefined,
          markInterrupted: async () => undefined,
          prepare: async () => ({
            branchName: "io/ope-34",
            controlPath: root,
            createdNow: true,
            originPath: root,
            outputPath,
            path: workspacePath,
            sourceRepoPath: root,
            streamIssueId: "feature-1",
            streamIssueIdentifier: "OPE-34",
            baseBranchName: "io/ope-12",
            baseIssueId: "stream-1",
            baseIssueIdentifier: "OPE-12",
            workerId: "OPE-61",
          }),
          reconcileTerminalIssues: async () => undefined,
          runAfterRunHook: async () => undefined,
          runBeforeRunHook: async () => undefined,
        }) as unknown as never,
    });

    await service.start();

    expect(capturedPrompt).toContain("LINKED ISSUE DOC");
    expect(capturedPrompt).toContain("Issue Description:");
    expect(capturedPrompt).not.toContain("<!-- io");

    const output = await readFile(outputPath, "utf8");
    expect(output).toContain("context bundle:");
    expect(output).toContain("1. builtin:io.agent.execute.default [builtin]");
    expect(output).toContain("6. context.entrypoint [entrypoint]");
    expect(output).toContain("7. ./io/context/linked.md [repo-path]");
    expect(output).toContain("8. issue.context [synthesized]");
    expect(output).toContain("warning: Unresolved issue doc reference: ./io/context/missing.md");
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { force: true, recursive: true });
  }
});
