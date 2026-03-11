import { expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  DEFAULT_BACKLOG_BUILTIN_DOC_IDS,
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
    parent: { id: "parent-1", identifier: "OS-1" },
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
        hasParent: true,
        priority: 2,
        updatedAt: "2024-01-01T00:00:00.000Z",
      }),
      createIssue({
        id: "3",
        identifier: "OS-3",
        parentIssueId: "1",
        parentIssueIdentifier: "OS-1",
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

test("pickCandidateIssues prefers the locally active issue within an occupied stream", () => {
  const selected = pickCandidateIssues(
    [
      createIssue({
        id: "2",
        identifier: "OS-2",
        parentIssueId: "1",
        parentIssueIdentifier: "OS-1",
        hasParent: true,
        priority: 2,
        updatedAt: "2024-01-01T00:00:00.000Z",
      }),
      createIssue({
        id: "3",
        identifier: "OS-3",
        parentIssueId: "1",
        parentIssueIdentifier: "OS-1",
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

test("AgentService resumes an in-progress issue in its own occupied stream", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-service-"));
  let runnerCalls = 0;

  await writeFile(
    resolve(root, "io.json"),
    JSON.stringify(
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
      },
      null,
      2,
    ),
  );
  await writeFile(resolve(root, "io.md"), "Issue {{ issue.identifier }}\n");
  process.env.LINEAR_API_KEY = "linear-token";
  process.env.LINEAR_PROJECT_SLUG = "project-slug";

  try {
    const issue = createIssue({
      id: "1",
      identifier: "OPE-66",
      priority: 0,
      state: "In Progress",
      title: "Resume interrupted issue",
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
          listOccupiedStreams: async () => new Map([["ope-66", "OPE-66"]]),
          markBlocked: async () => undefined,
          markInterrupted: async () => undefined,
          prepare: async () => ({
            branchName: "io/ope-66",
            controlPath: root,
            createdNow: true,
            originPath: root,
            path: resolve(root, "workspace", "workers", "OPE-66", "repo"),
            sourceRepoPath: root,
            workerId: "OPE-66",
          }),
          reconcileTerminalIssues: async () => undefined,
          runAfterRunHook: async () => undefined,
          runBeforeRunHook: async () => undefined,
        }) as unknown as never,
    });

    await service.start();
    expect(runnerCalls).toBe(1);
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

test("AgentService moves standalone issues to In Review after success", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-service-"));
  const workspacePath = resolve(root, "workspace", "workers", "OPE-57", "repo");
  const transitions: string[] = [];

  await writeFile(
    resolve(root, "io.json"),
    JSON.stringify(
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
      },
      null,
      2,
    ),
  );
  await writeFile(resolve(root, "io.md"), "Issue {{ issue.identifier }}\n");
  process.env.LINEAR_API_KEY = "linear-token";
  process.env.LINEAR_PROJECT_SLUG = "project-slug";

  try {
    const issue = createIssue({
      id: "1",
      identifier: "OPE-57",
      priority: 0,
      title: "Standalone issue",
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
            branchName: "io/ope-57",
            controlPath: root,
            createdNow: true,
            originPath: root,
            path: workspacePath,
            sourceRepoPath: root,
            workerId: "OPE-57",
          }),
          reconcileTerminalIssues: async () => undefined,
          runAfterRunHook: async () => undefined,
          runBeforeRunHook: async () => undefined,
        }) as unknown as never,
    });

    await service.start();
    expect(transitions).toEqual(["1:In Progress", "1:In Review"]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("AgentService marks child issues Done after landing on the stream branch", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-service-"));
  const workspacePath = resolve(root, "workspace", "workers", "OPE-58", "repo");
  const transitions: string[] = [];

  await writeFile(
    resolve(root, "io.json"),
    JSON.stringify(
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
      },
      null,
      2,
    ),
  );
  await writeFile(resolve(root, "io.md"), "Issue {{ issue.identifier }}\n");
  process.env.LINEAR_API_KEY = "linear-token";
  process.env.LINEAR_PROJECT_SLUG = "project-slug";

  try {
    const issue = createIssue({
      hasParent: true,
      id: "child-1",
      identifier: "OPE-58",
      parentIssueId: "parent-1",
      parentIssueIdentifier: "OPE-12",
      priority: 0,
      title: "Child issue",
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
            branchName: "io/ope-12",
            controlPath: root,
            createdNow: true,
            originPath: root,
            path: workspacePath,
            sourceRepoPath: root,
            streamIssueId: "parent-1",
            streamIssueIdentifier: "OPE-12",
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

  await writeFile(
    resolve(root, "io.json"),
    JSON.stringify(
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
      },
      null,
      2,
    ),
  );
  await writeFile(resolve(root, "io.md"), "Issue {{ issue.identifier }}\n");
  process.env.LINEAR_API_KEY = "linear-token";
  process.env.LINEAR_PROJECT_SLUG = "project-slug";

  try {
    const issue = createIssue({
      id: "1",
      identifier: "OPE-66",
      priority: 0,
      title: "Resume interrupted issue",
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
            branchName: "io/ope-66",
            controlPath: root,
            createdNow: true,
            originPath: root,
            path: workspacePath,
            sourceRepoPath: root,
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

  await writeFile(
    resolve(root, "io.json"),
    JSON.stringify(
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
      },
      null,
      2,
    ),
  );
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

  await writeFile(
    resolve(root, "io.json"),
    JSON.stringify(
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
      },
      null,
      2,
    ),
  );
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

  await writeFile(
    resolve(root, "io.json"),
    JSON.stringify(
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
      },
      null,
      2,
    ),
  );
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
                  createdAt: "2024-01-01T00:00:00.000Z",
                  description: "Implement execute flow",
                  id: "1",
                  identifier: "OPE-54",
                  labels: { nodes: [] },
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
          createIssue({
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
            branchName: "ope-54",
            controlPath: root,
            createdNow: true,
            originPath: root,
            path: workspacePath,
            sourceRepoPath: root,
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
          event.text.includes("Starting agent in"),
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

  await writeFile(
    resolve(root, "io.json"),
    JSON.stringify(
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
      },
      null,
      2,
    ),
  );
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
                  createdAt: "2024-01-01T00:00:00.000Z",
                  description: "Implement execute flow",
                  id: "1",
                  identifier: "OPE-54",
                  labels: { nodes: [] },
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
            branchName: "io/ope-54",
            controlPath: root,
            createdNow: true,
            originPath: root,
            path: workspacePath,
            sourceRepoPath: root,
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
        {
          blockedBy: [],
          createdAt: "2024-01-01T00:00:00.000Z",
          description: "Implement execute flow",
          hasChildren: false,
          hasParent: false,
          id: "1",
          identifier: "OPE-54",
          labels: [],
          priority: 0,
          state: "Todo",
          title: "Execute agent",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
        {
          branchName: "io/ope-54",
          controlPath: root,
          createdNow: true,
          originPath: root,
          path: workspacePath,
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

  await writeFile(
    resolve(root, "io.json"),
    JSON.stringify(
      {
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
      },
      null,
      2,
    ),
  );
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
                  parent: { id: "parent-1", identifier: "OPE-12" },
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
            branchName: "io/ope-12",
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
          parentIssueId: "parent-1",
          parentIssueIdentifier: "OPE-12",
          priority: 0,
          projectSlug: "docs-project",
          state: "Todo",
          title: "Backlog agent",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
        {
          branchName: "io/ope-12",
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
test("AgentService uses builtin override files from io.json", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-service-"));
  const overridePath = resolve(root, "io", "context", "validation-override.md");
  const ioPromptPath = resolve(root, "io.md");
  const localPrompt = "LOCAL EXECUTE {{ issue.identifier }}\n";
  const workspacePath = resolve(root, "workspace", "workers", "OPE-56", "repo");
  let capturedPrompt = "";

  await mkdir(resolve(root, "io", "context"), { recursive: true });
  await writeFile(
    resolve(root, "io.json"),
    JSON.stringify(
      {
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
      },
      null,
      2,
    ),
  );
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
                  createdAt: "2024-01-01T00:00:00.000Z",
                  description: "Implement execute flow",
                  id: "1",
                  identifier: "OPE-56",
                  labels: { nodes: [] },
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
            branchName: "io/ope-56",
            controlPath: root,
            createdNow: true,
            originPath: root,
            path: workspacePath,
            sourceRepoPath: root,
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
  await writeFile(
    resolve(root, "io.json"),
    JSON.stringify(
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
      },
      null,
      2,
    ),
  );
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
            branchName: "io/ope-61",
            controlPath: root,
            createdNow: true,
            originPath: root,
            outputPath,
            path: workspacePath,
            sourceRepoPath: root,
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
