import { expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  DEFAULT_BACKLOG_BUILTIN_DOC_IDS,
  DEFAULT_EXECUTE_BUILTIN_DOC_IDS,
  resolveBuiltinDoc,
} from "./builtins.js";
import { resolveIssueRouting } from "./issue-routing.js";
import { AgentService, pickCandidateIssues } from "./service.js";
import { normalizeLinearIssue } from "./tracker/linear.js";
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
    parent: { id: "parent-1" },
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
          reconcileTerminalIssues: async () => undefined,
        }) as unknown as never,
    });

    await service.start();
    expect(writes.some((entry) => entry.includes("ready at"))).toBe(true);
    expect(writes.some((entry) => entry.includes("No issues"))).toBe(true);
  } finally {
    globalThis.fetch = originalFetch;
    process.stdout.write = originalWrite;
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
          markBlocked: async () => undefined,
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
          branchName: "ope-54",
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
                  parent: { id: "parent-1" },
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
          markBlocked: async () => undefined,
          prepare: async () => ({
            branchName: "ope-55",
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
          priority: 0,
          projectSlug: "docs-project",
          state: "Todo",
          title: "Backlog agent",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
        {
          branchName: "ope-55",
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
          markBlocked: async () => undefined,
          prepare: async () => ({
            branchName: "ope-56",
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
