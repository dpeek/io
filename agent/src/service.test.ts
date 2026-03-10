import { expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { AgentService, pickCandidateIssues } from "./service.js";
import { normalizeLinearIssue } from "./tracker/linear.js";

test("normalizeLinearIssue lowercases labels and fills defaults", () => {
  const issue = normalizeLinearIssue({
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
    priority: 2,
    state: { name: "Todo" },
    title: "Fix integration",
    updatedAt: "2024-01-01T00:00:00.000Z",
  });
  expect(issue.labels).toEqual(["bug", "p1"]);
  expect(issue.description).toBe("");
  expect(issue.blockedBy).toEqual(["2"]);
});

test("pickCandidateIssues prefers unblocked todo issues by priority", () => {
  const selected = pickCandidateIssues(
    [
      {
        blockedBy: ["OS-1"],
        createdAt: "2024-01-01T00:00:00.000Z",
        description: "",
        id: "3",
        identifier: "OS-3",
        labels: [],
        priority: 5,
        state: "Todo",
        title: "Blocked",
        updatedAt: "2024-01-01T00:00:00.000Z",
      },
      {
        blockedBy: [],
        createdAt: "2024-01-01T00:00:00.000Z",
        description: "",
        id: "2",
        identifier: "OS-2",
        labels: [],
        priority: 1,
        state: "In Progress",
        title: "Later",
        updatedAt: "2024-01-02T00:00:00.000Z",
      },
      {
        blockedBy: [],
        createdAt: "2024-01-01T00:00:00.000Z",
        description: "",
        id: "1",
        identifier: "OS-1",
        labels: [],
        priority: 3,
        state: "Todo",
        title: "First",
        updatedAt: "2024-01-03T00:00:00.000Z",
      },
    ],
    2,
  );
  expect(selected.map((issue) => issue.identifier)).toEqual(["OS-1", "OS-2"]);
});

test("AgentService eagerly creates worker checkout on start", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-service-"));
  const workflowPath = resolve(root, "WORKFLOW.md");
  const writes: string[] = [];

  await writeFile(
    workflowPath,
    `---
tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
  project_slug: $LINEAR_PROJECT_SLUG
workspace:
  root: ${resolve(root, "workspace")}
agent:
  max_concurrent_agents: 1
---
Issue {{ issue.identifier }}
`,
  );
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
      workflowPath,
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

test("AgentService uses backlog prompt for io-labeled issues", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-service-"));
  const workflowPath = resolve(root, "WORKFLOW.md");
  const backlogPromptPath = resolve(root, "llm", "agent", "backlog.md");
  const workspacePath = resolve(root, "workspace", "workers", "OPE-55", "repo");
  let capturedPrompt = "";

  await mkdir(resolve(root, "llm", "agent"), { recursive: true });
  await writeFile(
    workflowPath,
    `---
tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
  project_slug: $LINEAR_PROJECT_SLUG
workspace:
  root: ${resolve(root, "workspace")}
agent:
  max_concurrent_agents: 1
---
EXECUTE {{ issue.identifier }}
`,
  );
  await writeFile(backlogPromptPath, "BACKLOG {{ issue.identifier }} {{ issue.labels }}\n");
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
                  description: "Refine backlog item",
                  id: "1",
                  identifier: "OPE-55",
                  labels: { nodes: [{ name: " io " }] },
                  priority: 0,
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
      workflowPath,
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
    expect(capturedPrompt).toBe('BACKLOG OPE-55 ["io"]');
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { force: true, recursive: true });
  }
});
