import { expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import type { AgentSessionEvent, AgentStatusEvent } from "./tui/index.js";
import {
  DEFAULT_BACKLOG_BUILTIN_DOC_IDS,
  DEFAULT_EXECUTE_BUILTIN_DOC_IDS,
  resolveBuiltinDoc,
} from "./builtins.js";
import { resolveIssueRouting } from "./issue-routing.js";
import { AgentService, pickCandidateIssues } from "./service.js";
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
    sortOrder: null,
    state: "Todo",
    title: "Example",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function createTaskIssue(overrides: Partial<AgentIssue> = {}): AgentIssue {
  return createIssue({
    hasParent: true,
    id: "task-1",
    identifier: "OPE-172",
    parentIssueId: "feature-1",
    parentIssueIdentifier: "OPE-167",
    parentIssueState: "In Progress",
    parentIssueTitle: "Example feature",
    priority: 0,
    streamIssueId: "stream-1",
    streamIssueIdentifier: "OPE-121",
    streamIssueState: "In Progress",
    title: "Example task",
    ...overrides,
  });
}

function isSupervisorWorkflowDiagnosticEvent(
  event: AgentSessionEvent,
): event is AgentStatusEvent & { code: "workflow-diagnostic"; session: { id: "supervisor" } } {
  return (
    event.type === "status" &&
    event.code === "workflow-diagnostic" &&
    event.session.id === "supervisor"
  );
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
    parent: {
      id: "parent-1",
      identifier: "OS-1",
      parent: {
        id: "stream-1",
        identifier: "OS-0",
        state: { name: "In Progress" },
      },
      state: { name: "In Progress" },
    },
    priority: 2,
    project: { slugId: "OpenSurf" },
    sortOrder: 1200.5,
    state: { name: "Todo" },
    title: "Fix integration",
    updatedAt: "2024-01-01T00:00:00.000Z",
  });
  expect(issue.labels).toEqual(["bug", "p1"]);
  expect(issue.description).toBe("");
  expect(issue.blockedBy).toEqual(["2"]);
  expect(issue.projectSlug).toBe("OpenSurf");
  expect(issue.sortOrder).toBe(1200.5);
  expect(issue.hasParent).toBe(true);
  expect(issue.hasChildren).toBe(true);
  expect(issue.parentIssueId).toBe("parent-1");
  expect(issue.parentIssueIdentifier).toBe("OS-1");
  expect(issue.parentIssueState).toBe("In Progress");
  expect(issue.streamIssueId).toBe("stream-1");
  expect(issue.streamIssueIdentifier).toBe("OS-0");
  expect(issue.streamIssueState).toBe("In Progress");
  expect(issue.teamId).toBeUndefined();
});

test("normalizeLinearIssue leaves parent and stream fields empty for standalone issues", () => {
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
  expect(issue.streamIssueId).toBeUndefined();
  expect(issue.streamIssueIdentifier).toBeUndefined();
  expect(issue.streamIssueState).toBeUndefined();
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
                  parent: {
                    id: "stream-1",
                    identifier: "OPE-121",
                    state: { name: "In Progress" },
                  },
                  state: { name: "In Review" },
                },
                priority: 0,
                project: { slugId: "io" },
                sortOrder: 15,
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
                sortOrder: 25,
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
    expect(requestBody?.query).toContain("sortOrder");
    expect(requestBody?.query).toContain("state { name }");
    expect(issues).toHaveLength(2);
    expect(issues[0]).toMatchObject({
      hasParent: true,
      identifier: "OPE-149",
      parentIssueId: "parent-1",
      parentIssueIdentifier: "OPE-147",
      parentIssueState: "In Review",
      sortOrder: 15,
      streamIssueId: "stream-1",
      streamIssueIdentifier: "OPE-121",
      streamIssueState: "In Progress",
    });
    expect(issues[1]).toMatchObject({
      hasChildren: true,
      hasParent: false,
      identifier: "OPE-147",
      sortOrder: 25,
    });
    expect(issues[1]?.parentIssueId).toBeUndefined();
    expect(issues[1]?.parentIssueIdentifier).toBeUndefined();
    expect(issues[1]?.parentIssueState).toBeUndefined();
    expect(issues[1]?.streamIssueId).toBeUndefined();
    expect(issues[1]?.streamIssueIdentifier).toBeUndefined();
    expect(issues[1]?.streamIssueState).toBeUndefined();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("pickCandidateIssues uses Linear manual order for dependency-free sibling tasks", () => {
  const selected = pickCandidateIssues(
    [
      createTaskIssue({
        blockedBy: ["OS-1"],
        id: "blocked-1",
        identifier: "OS-3",
        parentIssueId: "feature-3",
        parentIssueIdentifier: "OS-103",
        priority: 5,
        state: "Todo",
        title: "Blocked",
      }),
      createTaskIssue({
        id: "task-2",
        identifier: "OS-2",
        parentIssueId: "feature-2",
        parentIssueIdentifier: "OS-102",
        priority: 1,
        sortOrder: 200,
        state: "In Progress",
        title: "Later",
        updatedAt: "2024-01-02T00:00:00.000Z",
      }),
      createTaskIssue({
        id: "task-1",
        identifier: "OS-1",
        parentIssueId: "feature-2",
        parentIssueIdentifier: "OS-102",
        priority: 3,
        sortOrder: 100,
        state: "Todo",
        title: "First",
        updatedAt: "2024-01-03T00:00:00.000Z",
      }),
    ],
    1,
  );
  expect(selected.map((issue) => issue.identifier)).toEqual(["OS-1"]);
});

test("pickCandidateIssues keeps feature execution to one task per parent feature", () => {
  const selected = pickCandidateIssues(
    [
      createTaskIssue({
        id: "task-2",
        identifier: "OS-2",
        parentIssueId: "feature-1",
        parentIssueIdentifier: "OS-1",
        sortOrder: 200,
        streamIssueId: "stream-1",
        streamIssueIdentifier: "OS-0",
        priority: 2,
        updatedAt: "2024-01-01T00:00:00.000Z",
      }),
      createTaskIssue({
        id: "task-3",
        identifier: "OS-3",
        parentIssueId: "feature-1",
        parentIssueIdentifier: "OS-1",
        sortOrder: 100,
        streamIssueId: "stream-1",
        streamIssueIdentifier: "OS-0",
        priority: 1,
        updatedAt: "2024-01-02T00:00:00.000Z",
      }),
      createTaskIssue({
        id: "task-4",
        identifier: "OS-4",
        parentIssueId: "feature-2",
        parentIssueIdentifier: "OS-4F",
        sortOrder: 50,
        streamIssueId: "stream-1",
        streamIssueIdentifier: "OS-0",
        priority: 1,
        updatedAt: "2024-01-03T00:00:00.000Z",
      }),
    ],
    3,
  );
  expect(selected.map((issue) => issue.identifier)).toEqual(["OS-3", "OS-4"]);
});

test("pickCandidateIssues allows parallel tasks from different features in the same stream", () => {
  const selected = pickCandidateIssues(
    [
      createTaskIssue({
        id: "2",
        identifier: "OS-2",
        parentIssueId: "feature-1",
        parentIssueIdentifier: "OS-10",
        streamIssueId: "stream-1",
        streamIssueIdentifier: "OS-1",
        updatedAt: "2024-01-01T00:00:00.000Z",
      }),
      createTaskIssue({
        id: "3",
        identifier: "OS-3",
        parentIssueId: "feature-2",
        parentIssueIdentifier: "OS-11",
        streamIssueId: "stream-1",
        streamIssueIdentifier: "OS-1",
        updatedAt: "2024-01-02T00:00:00.000Z",
      }),
    ],
    2,
  );
  expect(selected.map((issue) => issue.identifier)).toEqual(["OS-2", "OS-3"]);
});

test("pickCandidateIssues leaves release gating to the scheduler", () => {
  const selected = pickCandidateIssues(
    [
      createTaskIssue({
        id: "task-2",
        identifier: "OS-2",
        parentIssueId: "feature-1",
        parentIssueIdentifier: "OS-1",
        parentIssueState: "In Review",
        streamIssueId: "stream-0",
        streamIssueIdentifier: "OS-0",
        priority: 3,
        updatedAt: "2024-01-01T00:00:00.000Z",
      }),
      createTaskIssue({
        id: "task-3",
        identifier: "OS-3",
        parentIssueId: "feature-10",
        parentIssueIdentifier: "OS-10",
        streamIssueId: "stream-0",
        streamIssueIdentifier: "OS-0",
        priority: 2,
        updatedAt: "2024-01-02T00:00:00.000Z",
      }),
      createTaskIssue({
        id: "task-4",
        identifier: "OS-4",
        parentIssueId: "feature-11",
        parentIssueIdentifier: "OS-11",
        streamIssueId: "stream-0",
        streamIssueIdentifier: "OS-0",
        priority: 1,
        streamIssueState: "Todo",
        updatedAt: "2024-01-03T00:00:00.000Z",
      }),
      createTaskIssue({
        id: "task-5",
        identifier: "OS-5",
        parentIssueId: "feature-12",
        parentIssueIdentifier: "OS-12",
        parentIssueState: "Done",
        streamIssueId: "stream-0",
        streamIssueIdentifier: "OS-0",
        priority: 0,
        updatedAt: "2024-01-04T00:00:00.000Z",
      }),
      createIssue({
        hasParent: true,
        id: "feature-13",
        identifier: "OS-6",
        parentIssueId: "stream-13",
        parentIssueIdentifier: "OS-13",
        parentIssueState: "In Progress",
        priority: 4,
        state: "Todo",
        streamIssueId: "stream-13",
        streamIssueIdentifier: "OS-13",
        streamIssueState: "In Progress",
        updatedAt: "2024-01-05T00:00:00.000Z",
      }),
    ],
    5,
  );
  expect(selected.map((issue) => issue.identifier)).toEqual([
    "OS-2",
    "OS-3",
    "OS-4",
    "OS-5",
    "OS-6",
  ]);
});

test("pickCandidateIssues prefers the locally active issue within an occupied stream", () => {
  const selected = pickCandidateIssues(
    [
      createTaskIssue({
        id: "task-2",
        identifier: "OS-2",
        parentIssueId: "feature-1",
        parentIssueIdentifier: "OS-1",
        sortOrder: 100,
        streamIssueId: "stream-1",
        streamIssueIdentifier: "OS-0",
        priority: 2,
        updatedAt: "2024-01-01T00:00:00.000Z",
      }),
      createTaskIssue({
        id: "task-3",
        identifier: "OS-3",
        parentIssueId: "feature-1",
        parentIssueIdentifier: "OS-1",
        sortOrder: 200,
        streamIssueId: "stream-1",
        streamIssueIdentifier: "OS-0",
        priority: 1,
        updatedAt: "2024-01-02T00:00:00.000Z",
      }),
      createTaskIssue({
        id: "task-4",
        identifier: "OS-4",
        parentIssueId: "feature-2",
        parentIssueIdentifier: "OS-4F",
        streamIssueId: "stream-1",
        streamIssueIdentifier: "OS-0",
        priority: 1,
        updatedAt: "2024-01-03T00:00:00.000Z",
      }),
    ],
    3,
    new Map([["os-1", "OS-3"]]),
  );
  expect(selected.map((issue) => issue.identifier)).toEqual(["OS-3", "OS-4"]);
});

test("AgentService does not auto-run task issues while the parent stream is not In Progress", async () => {
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
    const issue = createTaskIssue({
      id: "task-1",
      identifier: "OPE-59",
      priority: 0,
      streamIssueId: "stream-1",
      streamIssueIdentifier: "OPE-121",
      streamIssueState: "In Review",
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
      id: "task-1",
      identifier: "OPE-66",
      priority: 0,
      state: "In Progress",
      streamIssueState: "Todo",
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
          markBlocked: async () => undefined,
          markInterrupted: async () => undefined,
          prepare: async () => ({
            branchName: "io/ope-167",
            controlPath: root,
            createdNow: true,
            originPath: root,
            path: resolve(root, "workspace", "workers", "OPE-66", "repo"),
            sourceRepoPath: root,
            streamIssueId: "feature-1",
            streamIssueIdentifier: "OPE-167",
            baseBranchName: "io/ope-121",
            baseIssueId: "stream-1",
            baseIssueIdentifier: "OPE-121",
            workerId: "OPE-66",
          }),
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

test("AgentService does not auto-run top-level backlog issues", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-service-"));
  let runnerCalls = 0;
  const transitions: string[] = [];

  await writeServiceTestRepo(root, {
    issues: {
      defaultAgent: "execute",
      routing: [
        {
          agent: "backlog",
          if: {
            labelsAny: ["backlog"],
          },
          profile: "backlog",
        },
      ],
    },
  });

  try {
    const issue = createIssue({
      hasChildren: true,
      id: "parent-1",
      identifier: "OPE-57",
      labels: ["backlog"],
      priority: 0,
      state: "Todo",
      title: "Parent backlog issue",
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
          createIdleWorkspace: () => ({
            branchName: "main",
            controlPath: root,
            createdNow: true,
            originPath: root,
            path: resolve(root, "workspace", "workers", issueIdentifier ?? "supervisor"),
            sourceRepoPath: root,
            workerId: issueIdentifier ?? "supervisor",
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

test("AgentService does not auto-run standalone issues", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-service-"));
  let runnerCalls = 0;
  const transitions: string[] = [];

  await writeServiceTestRepo(root);

  try {
    const issue = createIssue({
      id: "standalone-1",
      identifier: "OPE-58",
      priority: 0,
      title: "Standalone issue",
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
          createIdleWorkspace: () => ({
            branchName: "main",
            controlPath: root,
            createdNow: true,
            originPath: root,
            path: resolve(root, "workspace", "workers", issueIdentifier ?? "supervisor"),
            sourceRepoPath: root,
            workerId: issueIdentifier ?? "supervisor",
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

test("AgentService does not auto-run released feature leaves without task children", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-service-"));
  let runnerCalls = 0;
  const transitions: string[] = [];

  await writeServiceTestRepo(root);

  try {
    const issue = createIssue({
      hasChildren: false,
      hasParent: true,
      id: "feature-1",
      identifier: "OPE-167",
      parentIssueId: "stream-1",
      parentIssueIdentifier: "OPE-121",
      parentIssueState: "In Progress",
      priority: 0,
      state: "In Progress",
      streamIssueId: "stream-1",
      streamIssueIdentifier: "OPE-121",
      streamIssueState: "In Progress",
      title: "Feature issue",
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
          createIdleWorkspace: () => ({
            branchName: "main",
            controlPath: root,
            createdNow: true,
            originPath: root,
            path: resolve(root, "workspace", "workers", issueIdentifier ?? "supervisor"),
            sourceRepoPath: root,
            workerId: issueIdentifier ?? "supervisor",
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
      id: "task-1",
      identifier: "OPE-58",
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
            branchName: "io/ope-167",
            controlPath: root,
            createdNow: true,
            originPath: root,
            path: workspacePath,
            sourceRepoPath: root,
            streamIssueId: "feature-1",
            streamIssueIdentifier: "OPE-167",
            baseBranchName: "io/ope-121",
            baseIssueId: "stream-1",
            baseIssueIdentifier: "OPE-121",
            workerId: "OPE-58",
          }),
          reconcileTerminalIssues: async () => undefined,
          runAfterRunHook: async () => undefined,
          runBeforeRunHook: async () => undefined,
        }) as unknown as never,
    });

    await service.start();
    expect(transitions).toEqual(["task-1:In Progress", "task-1:Done"]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("AgentService blocks task issues when execution-owned landing fails", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-service-"));
  const workspacePath = resolve(root, "workspace", "workers", "OPE-58", "repo");
  const events: string[] = [];
  const transitions: string[] = [];

  await writeServiceTestRepo(root);

  try {
    const issue = createTaskIssue({
      id: "task-1",
      identifier: "OPE-58",
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
          complete: async () => {
            throw new Error("task_landing_rebase_failed:OPE-58:io/ope-167:conflict");
          },
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
          markInterrupted: async () => undefined,
          prepare: async () => ({
            branchName: "io/ope-167",
            controlPath: root,
            createdNow: true,
            originPath: root,
            path: workspacePath,
            sourceRepoPath: root,
            streamIssueId: "feature-1",
            streamIssueIdentifier: "OPE-167",
            workerId: "OPE-58",
          }),
          reconcileTerminalIssues: async () => undefined,
          runAfterRunHook: async () => undefined,
          runBeforeRunHook: async () => undefined,
        }) as unknown as never,
    });

    await service.start();
    expect(events).toEqual(["blocked"]);
    expect(transitions).toEqual(["task-1:In Progress"]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("AgentService proves the OPE-121 workflow by running only the leaf task", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-service-"));
  const workspacePath = resolve(root, "workspace", "workers", "OPE-172", "repo");
  const prepared: string[] = [];
  const runs: string[] = [];
  const transitions: string[] = [];

  await writeServiceTestRepo(root);

  try {
    const streamIssue = createIssue({
      hasChildren: true,
      id: "stream-1",
      identifier: "OPE-121",
      labels: ["io", "agent"],
      priority: 0,
      state: "In Progress",
      title: "Agent Stream",
    });
    const featureIssue = createIssue({
      hasChildren: true,
      hasParent: true,
      id: "feature-1",
      identifier: "OPE-167",
      parentIssueId: "stream-1",
      parentIssueIdentifier: "OPE-121",
      parentIssueState: "In Progress",
      priority: 0,
      state: "In Progress",
      streamIssueId: "stream-1",
      streamIssueIdentifier: "OPE-121",
      streamIssueState: "In Progress",
      title: "Lock the three-level workflow contract and supporting docs",
    });
    const taskIssue = createIssue({
      hasParent: true,
      id: "task-1",
      identifier: "OPE-172",
      parentIssueId: "feature-1",
      parentIssueIdentifier: "OPE-167",
      parentIssueState: "In Progress",
      priority: 0,
      state: "Todo",
      streamIssueId: "stream-1",
      streamIssueIdentifier: "OPE-121",
      streamIssueState: "In Progress",
      title: "Prove the workflow end to end on OPE-121",
    });
    const service = new AgentService({
      once: true,
      repoRoot: root,
      runnerFactory: () => ({
        run: async ({ issue, prompt, workspace }) => {
          runs.push(issue.identifier);
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
        fetchCandidateIssues: async () => [streamIssue, featureIssue, taskIssue],
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
          prepare: async (issue: AgentIssue) => {
            prepared.push(issue.identifier);
            return {
              branchName: "io/ope-167",
              controlPath: root,
              createdNow: true,
              originPath: root,
              path: workspacePath,
              sourceRepoPath: root,
              streamIssueId: "feature-1",
              streamIssueIdentifier: "OPE-167",
              workerId: "OPE-172",
            };
          },
          reconcileTerminalIssues: async () => undefined,
          runAfterRunHook: async () => undefined,
          runBeforeRunHook: async () => undefined,
        }) as unknown as never,
    });

    await service.start();
    expect(prepared).toEqual(["OPE-172"]);
    expect(runs).toEqual(["OPE-172"]);
    expect(transitions).toEqual(["task-1:In Progress", "task-1:Done"]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("AgentService does not run OPE-172 until the OPE-121 stream is In Progress", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-service-"));
  let runnerCalls = 0;
  const transitions: string[] = [];

  await writeServiceTestRepo(root);

  try {
    const taskIssue = createIssue({
      hasParent: true,
      id: "task-1",
      identifier: "OPE-172",
      parentIssueId: "feature-1",
      parentIssueIdentifier: "OPE-167",
      parentIssueState: "In Progress",
      priority: 0,
      state: "Todo",
      streamIssueId: "stream-1",
      streamIssueIdentifier: "OPE-121",
      streamIssueState: "Todo",
      title: "Prove the workflow end to end on OPE-121",
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
        fetchCandidateIssues: async () => [taskIssue],
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
test("AgentService preserves timed out runs as interrupted", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-service-"));
  const workspacePath = resolve(root, "workspace", "workers", "OPE-66", "repo");
  const events: string[] = [];
  const sessionEvents: AgentSessionEvent[] = [];
  let attempts = 0;

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
      id: "1",
      identifier: "OPE-66",
      parentIssueId: "feature-1",
      parentIssueIdentifier: "OPE-167",
      parentIssueState: "In Progress",
      streamIssueId: "stream-1",
      streamIssueIdentifier: "OPE-121",
      streamIssueState: "In Progress",
      priority: 0,
      title: "Resume interrupted task",
    });
    const service = new AgentService({
      once: true,
      repoRoot: root,
      runnerFactory: () => ({
        run: async () => {
          attempts += 1;
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
            branchName: "io/ope-167",
            controlPath: root,
            createdNow: true,
            originPath: root,
            path: workspacePath,
            sourceRepoPath: root,
            streamIssueId: "feature-1",
            streamIssueIdentifier: "OPE-167",
            baseBranchName: "io/ope-121",
            baseIssueId: "stream-1",
            baseIssueIdentifier: "OPE-121",
            workerId: "OPE-66",
          }),
          reconcileTerminalIssues: async () => undefined,
          runAfterRunHook: async () => undefined,
          runBeforeRunHook: async () => undefined,
        }) as unknown as never,
    });
    service.observeSessionEvents((event) => {
      sessionEvents.push(event);
    });

    await service.start();
    expect(attempts).toBe(2);
    expect(events).toEqual(["interrupted"]);
    expect(
      sessionEvents.some(
        (event) =>
          event.type === "session" &&
          event.phase === "stopped" &&
          event.session.issue?.identifier === "OPE-66" &&
          event.session.runtime?.state === "interrupted" &&
          event.session.runtime?.blocker?.reason === "response_timeout",
      ),
    ).toBe(true);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("AgentService retries timed out runs once per supervisor cycle", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-service-"));
  const workspacePath = resolve(root, "workspace", "workers", "OPE-66", "repo");
  const events: string[] = [];
  const prompts: string[] = [];
  const transitions: string[] = [];
  let attempts = 0;

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
      id: "1",
      identifier: "OPE-66",
      priority: 0,
      title: "Resume interrupted task",
    });
    const service = new AgentService({
      once: true,
      repoRoot: root,
      runnerFactory: () => ({
        run: async ({ issue, prompt, workspace }) => {
          attempts += 1;
          prompts.push(prompt);
          if (attempts === 1) {
            throw new Error("response_timeout");
          }
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
          complete: async () => {
            events.push("complete");
            return { commitSha: "a".repeat(40) };
          },
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
            branchName: "io/ope-167",
            controlPath: root,
            createdNow: true,
            originPath: root,
            path: workspacePath,
            sourceRepoPath: root,
            streamIssueId: "feature-1",
            streamIssueIdentifier: "OPE-167",
            baseBranchName: "io/ope-121",
            baseIssueId: "stream-1",
            baseIssueIdentifier: "OPE-121",
            workerId: "OPE-66",
          }),
          reconcileTerminalIssues: async () => undefined,
          runAfterRunHook: async () => {
            events.push("after");
          },
          runBeforeRunHook: async () => {
            events.push("before");
          },
        }) as unknown as never,
    });

    await service.start();
    expect(attempts).toBe(2);
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain("- Attempt: 1");
    expect(prompts[1]).toContain("- Attempt: 2");
    expect(transitions).toEqual(["1:In Progress", "1:Done"]);
    expect(events).toEqual(["before", "after", "before", "after", "complete"]);
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
    expect(writes.some((entry) => entry.includes("Workflow: idle"))).toBe(true);
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
  const issueRuntimePath = resolve(root, "workspace", "issue", "ope-54");
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
                    identifier: "OPE-167",
                    parent: {
                      id: "stream-1",
                      identifier: "OPE-121",
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
            branchName: "io/ope-167",
            controlPath: root,
            createdNow: true,
            issueRuntimePath,
            originPath: root,
            path: workspacePath,
            sourceRepoPath: root,
            streamIssueId: "feature-1",
            streamIssueIdentifier: "OPE-167",
            baseBranchName: "io/ope-121",
            baseIssueId: "stream-1",
            baseIssueIdentifier: "OPE-121",
            workerId: "OPE-54",
          }),
          reconcileTerminalIssues: async () => {
            await mkdir(issueRuntimePath, { recursive: true });
            await writeFile(
              resolve(issueRuntimePath, "issue-state.json"),
              JSON.stringify(
                {
                  branchName: "io/ope-167",
                  commitSha: "a".repeat(40),
                  controlPath: root,
                  finalizedAt: "2026-03-15T12:00:01.000Z",
                  finalizedLinearState: "Done",
                  issueId: "1",
                  issueIdentifier: "OPE-54",
                  issueTitle: "Execute agent",
                  landedAt: "2026-03-15T12:00:00.000Z",
                  landedCommitSha: "a".repeat(40),
                  originPath: root,
                  outputPath: resolve(issueRuntimePath, "output.log"),
                  parentIssueId: "feature-1",
                  parentIssueIdentifier: "OPE-167",
                  runtimePath: issueRuntimePath,
                  sourceRepoPath: root,
                  status: "finalized",
                  streamIssueId: "stream-1",
                  streamIssueIdentifier: "OPE-121",
                  streamRuntimePath: resolve(root, "workspace", "stream", "ope-167.json"),
                  updatedAt: "2026-03-15T12:00:01.000Z",
                  workerId: "OPE-54",
                  worktreePath: workspacePath,
                },
                null,
                2,
              ),
            );
          },
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
    expect(
      events.some(
        (event) =>
          isSupervisorWorkflowDiagnosticEvent(event) && event.text === "Workflow: 1 runnable",
      ),
    ).toBe(true);
    const workflowSummaryEvent = events.find(
      (
        event,
      ): event is AgentStatusEvent & { code: "workflow-diagnostic"; session: { id: "supervisor" } } =>
        isSupervisorWorkflowDiagnosticEvent(event) && event.text === "Workflow: 1 runnable",
    );
    expect(workflowSummaryEvent?.data?.workflowDiagnostics).toMatchObject({
      counts: {
        runnable: 1,
      },
      items: {
        runnable: [
          {
            branchName: "io/ope-167",
            current: {
              identifier: "OPE-54",
            },
          },
        ],
      },
      summaryText: "Workflow: 1 runnable",
    });

    const scheduledWorker = events.find(
      (event) =>
        event.type === "session" &&
        event.phase === "scheduled" &&
        event.session.issue?.identifier === "OPE-54",
    );
    expect(scheduledWorker).toBeDefined();
    expect(scheduledWorker?.session.parentSessionId).toBe("supervisor");
    expect(scheduledWorker?.session.workflow).toEqual({
      feature: {
        id: "feature-1",
        identifier: "OPE-167",
        state: "In Progress",
        title: "Example feature",
      },
      stream: {
        id: "stream-1",
        identifier: "OPE-121",
        state: "In Progress",
      },
      task: {
        id: "1",
        identifier: "OPE-54",
        state: "Todo",
        title: "Execute agent",
      },
    });

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
    const committedEvent = events.find(
      (event) =>
        event.type === "status" &&
        event.code === "issue-committed" &&
        event.session.issue?.identifier === "OPE-54",
    );
    expect(committedEvent?.session.runtime).toMatchObject({
      finalization: {
        commitSha: "a".repeat(40),
        state: "pending",
      },
      state: "pending-finalization",
    });
    const finalizedEvent = [...events]
      .reverse()
      .find(
        (event) =>
          event.type === "session" &&
          event.phase === "completed" &&
          event.session.issue?.identifier === "OPE-54" &&
          event.session.runtime?.state === "finalized",
      );
    expect(finalizedEvent?.session.runtime).toMatchObject({
      finalization: {
        commitSha: "a".repeat(40),
        finalizedAt: "2026-03-15T12:00:01.000Z",
        landedAt: "2026-03-15T12:00:00.000Z",
        linearState: "Done",
        state: "finalized",
      },
      state: "finalized",
    });
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { force: true, recursive: true });
  }
});

test("AgentService surfaces workflow diagnostics for retained and skipped task states", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-service-diagnostics-"));
  const workspacePath = resolve(root, "workspace", "workers", "OPE-79", "repo");
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

  try {
    const runnableIssue = createIssue({
      hasParent: true,
      id: "runnable-1",
      identifier: "OPE-79",
      parentIssueId: "feature-172",
      parentIssueIdentifier: "OPE-172",
      parentIssueState: "In Progress",
      priority: 0,
      streamIssueId: "stream-121",
      streamIssueIdentifier: "OPE-121",
      streamIssueState: "In Progress",
      title: "Runnable task",
    });
    const occupiedIssue = createIssue({
      hasParent: true,
      id: "occupied-1",
      identifier: "OPE-78",
      parentIssueId: "feature-167",
      parentIssueIdentifier: "OPE-167",
      parentIssueState: "In Progress",
      priority: 1,
      streamIssueId: "stream-121",
      streamIssueIdentifier: "OPE-121",
      streamIssueState: "In Progress",
      title: "Occupied task",
    });
    const blockedByDependencyIssue = createIssue({
      blockedBy: ["OPE-170"],
      hasParent: true,
      id: "blocked-1",
      identifier: "OPE-77",
      parentIssueId: "feature-169",
      parentIssueIdentifier: "OPE-169",
      parentIssueState: "In Progress",
      priority: 2,
      streamIssueId: "stream-121",
      streamIssueIdentifier: "OPE-121",
      streamIssueState: "In Progress",
      title: "Blocked task",
    });
    const waitingForReleaseIssue = createIssue({
      hasParent: true,
      id: "waiting-1",
      identifier: "OPE-76",
      parentIssueId: "feature-168",
      parentIssueIdentifier: "OPE-168",
      parentIssueState: "In Review",
      priority: 3,
      streamIssueId: "stream-121",
      streamIssueIdentifier: "OPE-121",
      streamIssueState: "In Progress",
      title: "Waiting task",
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
        fetchCandidateIssues: async () => [
          occupiedIssue,
          blockedByDependencyIssue,
          waitingForReleaseIssue,
          runnableIssue,
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
          listOccupiedStreams: async () => new Map([["ope-167", "OPE-71"]]),
          listRetainedIssues: async () => [
            {
              branchName: "io/ope-167",
              controlPath: root,
              issueId: "running-1",
              issueIdentifier: "OPE-71",
              issueTitle: "Running task",
              originPath: root,
              outputPath: resolve(root, "workspace", "runtime", "OPE-71", "output.log"),
              parentIssueId: "feature-167",
              parentIssueIdentifier: "OPE-167",
              runtimePath: resolve(root, "workspace", "runtime", "OPE-71"),
              status: "running",
              streamIssueId: "stream-121",
              streamIssueIdentifier: "OPE-121",
              streamRuntimePath: resolve(root, "workspace", "stream", "ope-167.json"),
              updatedAt: "2024-01-01T00:00:00.000Z",
              workerId: "OPE-71",
              worktreePath: resolve(root, "workspace", "tree", "ope-71"),
            },
            {
              branchName: "io/ope-168",
              controlPath: root,
              issueId: "interrupted-1",
              issueIdentifier: "OPE-72",
              issueTitle: "Interrupted task",
              originPath: root,
              outputPath: resolve(root, "workspace", "runtime", "OPE-72", "output.log"),
              parentIssueId: "feature-168",
              parentIssueIdentifier: "OPE-168",
              runtimePath: resolve(root, "workspace", "runtime", "OPE-72"),
              status: "interrupted",
              streamIssueId: "stream-121",
              streamIssueIdentifier: "OPE-121",
              streamRuntimePath: resolve(root, "workspace", "stream", "ope-168.json"),
              updatedAt: "2024-01-01T00:00:01.000Z",
              workerId: "OPE-72",
              worktreePath: resolve(root, "workspace", "tree", "ope-72"),
            },
            {
              branchName: "io/ope-169",
              controlPath: root,
              issueId: "blocked-1",
              issueIdentifier: "OPE-73",
              issueTitle: "Blocked task",
              originPath: root,
              outputPath: resolve(root, "workspace", "runtime", "OPE-73", "output.log"),
              parentIssueId: "feature-169",
              parentIssueIdentifier: "OPE-169",
              runtimePath: resolve(root, "workspace", "runtime", "OPE-73"),
              status: "blocked",
              streamIssueId: "stream-121",
              streamIssueIdentifier: "OPE-121",
              streamRuntimePath: resolve(root, "workspace", "stream", "ope-169.json"),
              updatedAt: "2024-01-01T00:00:02.000Z",
              workerId: "OPE-73",
              worktreePath: resolve(root, "workspace", "tree", "ope-73"),
            },
            {
              branchName: "io/ope-170",
              controlPath: root,
              issueId: "completed-1",
              issueIdentifier: "OPE-74",
              issueTitle: "Completed task",
              originPath: root,
              outputPath: resolve(root, "workspace", "runtime", "OPE-74", "output.log"),
              parentIssueId: "feature-170",
              parentIssueIdentifier: "OPE-170",
              runtimePath: resolve(root, "workspace", "runtime", "OPE-74"),
              status: "completed",
              streamIssueId: "stream-121",
              streamIssueIdentifier: "OPE-121",
              streamRuntimePath: resolve(root, "workspace", "stream", "ope-170.json"),
              updatedAt: "2024-01-01T00:00:03.000Z",
              workerId: "OPE-74",
              worktreePath: resolve(root, "workspace", "tree", "ope-74"),
            },
          ],
          markBlocked: async () => undefined,
          markInterrupted: async () => undefined,
          prepare: async () => ({
            branchName: "io/ope-172",
            controlPath: root,
            createdNow: true,
            originPath: root,
            path: workspacePath,
            sourceRepoPath: root,
            workerId: "OPE-79",
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

    const diagnosticLines = events
      .filter(isSupervisorWorkflowDiagnosticEvent)
      .map((event) => event.text);
    const workflowSummaryEvent = events.find(
      (
        event,
      ): event is AgentStatusEvent & { code: "workflow-diagnostic"; session: { id: "supervisor" } } =>
        isSupervisorWorkflowDiagnosticEvent(event) &&
        (event.text?.startsWith("Workflow:") ?? false),
    );

    expect(diagnosticLines).toContain(
      "Workflow: 1 active, 1 blocked, 1 interrupted, 1 waiting on finalization, 1 runnable, 1 blocked by dependency, 1 waiting for workflow release, 1 occupied",
    );
    expect(diagnosticLines).toContain(
      "Active: stream OPE-121 / feature OPE-167 / task OPE-71 on io/ope-167",
    );
    expect(diagnosticLines).toContain(
      "Preserved blocked: stream OPE-121 / feature OPE-169 / task OPE-73 on io/ope-169",
    );
    expect(diagnosticLines).toContain(
      "Preserved interrupted: stream OPE-121 / feature OPE-168 / task OPE-72 on io/ope-168",
    );
    expect(diagnosticLines).toContain(
      "Waiting on finalization: stream OPE-121 / feature OPE-170 / task OPE-74 on io/ope-170",
    );
    expect(diagnosticLines).toContain(
      "Runnable now: stream OPE-121 / feature OPE-172 / task OPE-79",
    );
    expect(diagnosticLines).toContain(
      "Blocked by dependency: stream OPE-121 / feature OPE-169 / task OPE-77 blocked by OPE-170",
    );
    expect(diagnosticLines).toContain(
      "Waiting for workflow release: stream OPE-121 / feature OPE-168 / task OPE-76 (feature OPE-168 is In Review)",
    );
    expect(diagnosticLines).toContain(
      "Occupied: stream OPE-121 / feature OPE-167 / task OPE-78 held by OPE-71 [running]",
    );
    expect(workflowSummaryEvent?.data?.workflowDiagnostics).toMatchObject({
      counts: {
        active: 1,
        blocked: 1,
        "blocked-by-dependency": 1,
        interrupted: 1,
        occupied: 1,
        "pending-finalization": 1,
        runnable: 1,
        "waiting-for-workflow-release": 1,
      },
      items: {
        active: [
          {
            branchName: "io/ope-167",
            current: {
              identifier: "OPE-71",
            },
          },
        ],
        "blocked-by-dependency": [
          {
            blockedBy: ["OPE-170"],
            current: {
              identifier: "OPE-77",
            },
          },
        ],
        occupied: [
          {
            current: {
              identifier: "OPE-78",
            },
            heldBy: {
              identifier: "OPE-71",
              status: "running",
            },
          },
        ],
        "waiting-for-workflow-release": [
          {
            current: {
              identifier: "OPE-76",
            },
            waitingOn: ["feature OPE-168 is In Review"],
          },
        ],
      },
      summaryText:
        "Workflow: 1 active, 1 blocked, 1 interrupted, 1 waiting on finalization, 1 runnable, 1 blocked by dependency, 1 waiting for workflow release, 1 occupied",
    });
  } finally {
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
                    identifier: "OPE-167",
                    parent: {
                      id: "stream-1",
                      identifier: "OPE-121",
                      state: { name: "In Progress" },
                    },
                    state: { name: "In Progress" },
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
            branchName: "io/ope-167",
            controlPath: root,
            createdNow: true,
            originPath: root,
            path: workspacePath,
            sourceRepoPath: root,
            streamIssueId: "feature-1",
            streamIssueIdentifier: "OPE-167",
            baseBranchName: "io/ope-121",
            baseIssueId: "stream-1",
            baseIssueIdentifier: "OPE-121",
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
          hasChildren: false,
          hasParent: true,
          id: "1",
          identifier: "OPE-54",
          labels: [],
          parentIssueId: "feature-1",
          parentIssueIdentifier: "OPE-167",
          parentIssueState: "In Progress",
          priority: 0,
          state: "Todo",
          streamIssueId: "stream-1",
          streamIssueIdentifier: "OPE-121",
          streamIssueState: "In Progress",
          title: "Execute agent",
          updatedAt: "2024-01-01T00:00:00.000Z",
        }),
        {
          branchName: "io/ope-167",
          controlPath: root,
          createdNow: true,
          originPath: root,
          path: workspacePath,
          streamIssueId: "feature-1",
          streamIssueIdentifier: "OPE-167",
          baseBranchName: "io/ope-121",
          baseIssueId: "stream-1",
          baseIssueIdentifier: "OPE-121",
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

test("AgentService uses backlog built-ins for routed issues", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-service-"));
  const ioPromptPath = resolve(root, "io.md");
  const localPrompt =
    "LOCAL BACKLOG {{ issue.identifier }} {{ selection.agent }} {{ selection.profile }}\n";
  const workspacePath = resolve(root, "workspace", "workers", "OPE-55", "repo");
  let capturedPrompt = "";

  await writeIoTsConfig(root, {
    agent: { maxConcurrentAgents: 1 },
    issues: {
      defaultAgent: "execute",
      defaultProfile: "execute",
      routing: [
        {
          agent: "backlog",
          if: {
            hasChildren: false,
            hasParent: true,
            labelsAll: ["planning", "docs"],
            labelsAny: ["planning"],
            projectSlugIn: ["docs-project"],
            stateIn: ["todo"],
          },
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
      root: resolve(root, "workspace"),
    },
  });
  await writeFile(ioPromptPath, localPrompt);
  process.env.LINEAR_API_KEY = "linear-token";
  process.env.LINEAR_PROJECT_SLUG = "docs-project";

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
                  description: "Refine backlog item",
                  id: "1",
                  identifier: "OPE-55",
                  labels: { nodes: [{ name: " planning " }, { name: "Docs" }] },
                  parent: {
                    id: "feature-1",
                    identifier: "OPE-167",
                    parent: {
                      id: "stream-1",
                      identifier: "OPE-121",
                      state: { name: "In Progress" },
                    },
                    state: { name: "In Progress" },
                  },
                  priority: 0,
                  project: { slugId: "docs-project" },
                  state: { name: "Todo" },
                  title: "Backlog agent",
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
            branchName: "io/ope-167",
            controlPath: root,
            createdNow: true,
            originPath: root,
            path: workspacePath,
            sourceRepoPath: root,
            workerId: "OPE-55",
          }),
          reconcileTerminalIssues: async () => undefined,
          runAfterRunHook: async () => undefined,
          runBeforeRunHook: async () => undefined,
        }) as unknown as never,
    });

    await service.start();
    expect(capturedPrompt).toBe(
      buildExpectedPrompt(
        DEFAULT_BACKLOG_BUILTIN_DOC_IDS,
        ioPromptPath,
        localPrompt,
        {
          blockedBy: [],
          createdAt: "2024-01-01T00:00:00.000Z",
          description: "Refine backlog item",
          hasChildren: false,
          hasParent: true,
          id: "1",
          identifier: "OPE-55",
          labels: ["planning", "docs"],
          parentIssueId: "feature-1",
          parentIssueIdentifier: "OPE-167",
          parentIssueState: "In Progress",
          priority: 0,
          projectSlug: "docs-project",
          state: "Todo",
          streamIssueId: "stream-1",
          streamIssueIdentifier: "OPE-121",
          streamIssueState: "In Progress",
          title: "Backlog agent",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
        {
          branchName: "io/ope-167",
          controlPath: root,
          createdNow: true,
          originPath: root,
          path: workspacePath,
          workerId: "OPE-55",
        },
        {
          agent: "backlog",
          profile: "backlog",
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
                    identifier: "OPE-167",
                    parent: {
                      id: "stream-1",
                      identifier: "OPE-121",
                      state: { name: "In Progress" },
                    },
                    state: { name: "In Progress" },
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
            branchName: "io/ope-167",
            controlPath: root,
            createdNow: true,
            originPath: root,
            path: workspacePath,
            sourceRepoPath: root,
            streamIssueId: "feature-1",
            streamIssueIdentifier: "OPE-167",
            baseBranchName: "io/ope-121",
            baseIssueId: "stream-1",
            baseIssueIdentifier: "OPE-121",
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

Refs:
- \`./io/context/linked.md\`
- \`./io/context/missing.md\``,
                  id: "1",
                  identifier: "OPE-61",
                  labels: { nodes: [] },
                  parent: {
                    id: "feature-1",
                    identifier: "OPE-167",
                    parent: {
                      id: "stream-1",
                      identifier: "OPE-121",
                      state: { name: "In Progress" },
                    },
                    state: { name: "In Progress" },
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
            branchName: "io/ope-167",
            controlPath: root,
            createdNow: true,
            originPath: root,
            outputPath,
            path: workspacePath,
            sourceRepoPath: root,
            streamIssueId: "feature-1",
            streamIssueIdentifier: "OPE-167",
            baseBranchName: "io/ope-121",
            baseIssueId: "stream-1",
            baseIssueIdentifier: "OPE-121",
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
