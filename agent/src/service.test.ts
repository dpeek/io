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
  expect(issue.teamId).toBeUndefined();
});

test("LinearTrackerAdapter fetches top-level managed comment triggers on managed parents", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock(
    async () =>
      new Response(
        JSON.stringify({
          data: {
            issues: {
              nodes: [
                {
                  children: { nodes: [] },
                  comments: {
                    nodes: [
                      {
                        body: "@io backlog\ndryRun: true",
                        createdAt: "2024-01-02T00:00:00.000Z",
                        id: "comment-1",
                        parent: null,
                        updatedAt: "2024-01-02T00:00:00.000Z",
                      },
                      {
                        body: "@io backlog",
                        createdAt: "2024-01-03T00:00:00.000Z",
                        id: "comment-2",
                        parent: { id: "comment-1" },
                        updatedAt: "2024-01-03T00:00:00.000Z",
                      },
                    ],
                  },
                  createdAt: "2024-01-01T00:00:00.000Z",
                  description: "Managed parent",
                  id: "issue-1",
                  identifier: "OPE-126",
                  inverseRelations: { nodes: [] },
                  labels: { nodes: [{ name: "io" }, { name: "agent" }] },
                  priority: 2,
                  project: { slugId: "io" },
                  state: { name: "Todo" },
                  team: { id: "team-1" },
                  title: "Managed stream",
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
    const tracker = new LinearTrackerAdapter({
      activeStates: ["Todo"],
      apiKey: "token",
      endpoint: "https://linear.invalid/graphql",
      kind: "linear",
      projectSlug: "io",
      terminalStates: ["Done"],
    });

    const comments = await tracker.fetchManagedCommentTriggers?.();
    expect(comments).toHaveLength(1);
    expect(comments?.[0]).toMatchObject({
      command: "backlog",
      commentId: "comment-1",
      issue: {
        identifier: "OPE-126",
        teamId: "team-1",
      },
      payload: {
        docs: [],
        dryRun: true,
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("LinearTrackerAdapter applies managed comment mutations and posts a reply", async () => {
  const calls = {
    attachmentLinkURL: [] as Array<{ issueId: string; title?: string; url: string }>,
    createComment: [] as Array<{ body: string; issueId: string; parentId: string }>,
    createIssue: [] as Array<Record<string, unknown>>,
    createIssueRelation: [] as Array<Record<string, unknown>>,
    deleteIssueRelation: [] as string[],
    issueAddLabel: [] as Array<{ issueId: string; labelId: string }>,
    update: [] as Array<Record<string, unknown>>,
  };

  const client = {
    attachmentLinkURL: async (issueId: string, url: string, options?: { title?: string }) => {
      calls.attachmentLinkURL.push({ issueId, title: options?.title, url });
      return { success: true };
    },
    createComment: async (input: { body: string; issueId: string; parentId: string }) => {
      calls.createComment.push(input);
      return { commentId: "reply-1", success: true };
    },
    createIssue: async (input: Record<string, unknown>) => {
      calls.createIssue.push(input);
      return {
        issue: Promise.resolve({ identifier: "OPE-127" }),
        issueId: "child-1",
        success: true,
      };
    },
    createIssueRelation: async (input: Record<string, unknown>) => {
      calls.createIssueRelation.push(input);
      return { success: true };
    },
    deleteIssueRelation: async (id: string) => {
      calls.deleteIssueRelation.push(id);
      return { success: true };
    },
    issue: async () => ({
      children: async () => ({
        nodes: [
          {
            attachments: async () => ({ nodes: [] }),
            description: "Existing child",
            id: "existing-child",
            identifier: "OPE-125",
            inverseRelations: async () => ({ nodes: [] }),
            labels: async () => ({ nodes: [{ id: "label-agent", name: "agent" }] }),
            priority: 2,
            state: Promise.resolve({ name: "In Progress" }),
            title: "Existing child",
            update: async () => ({ success: true }),
          },
        ],
      }),
      teamId: "team-1",
      update: async (input: Record<string, unknown>) => {
        calls.update.push(input);
        return { success: true };
      },
    }),
    issueAddLabel: async (issueId: string, labelId: string) => {
      calls.issueAddLabel.push({ issueId, labelId });
      return { success: true };
    },
    team: async () => ({
      labels: async () => ({
        nodes: [{ id: "label-agent", name: "agent" }],
      }),
      states: async () => ({
        nodes: [{ id: "state-todo", name: "Todo" }],
      }),
    }),
  };

  const tracker = new LinearTrackerAdapter(
    {
      activeStates: ["Todo"],
      apiKey: "token",
      endpoint: "https://linear.invalid/graphql",
      kind: "linear",
      projectSlug: "io",
      terminalStates: ["Done"],
    },
    undefined,
    client as never,
  );

  const result = await tracker.applyManagedCommentMutation?.({
    children: [
      {
        blockedBy: ["OPE-125"],
        description: "Child description",
        docs: ["./io/topic/goals.md"],
        labels: ["agent"],
        priority: 2,
        reference: "managed-child-1",
        state: "Todo",
        title: "Create child issue",
      },
    ],
    comment: {
      body: "@io backlog",
      bodyHash: "hash",
      command: "backlog",
      commentId: "comment-1",
      createdAt: "2024-01-02T00:00:00.000Z",
      issue: createIssue({
        description: "Parent description",
        id: "issue-1",
        identifier: "OPE-126",
        labels: ["io", "agent"],
        priority: 2,
        teamId: "team-1",
        title: "Managed parent",
      }),
      payload: {
        docs: [],
        dryRun: false,
      },
      updatedAt: "2024-01-02T00:00:00.000Z",
    },
    parentDescription: "Updated parent description",
    reply: {
      command: "backlog",
      issueIdentifier: "OPE-126 / agent",
      lines: [],
      result: "noop",
    },
  });

  expect(result).toEqual({
    createdChildIssueIdentifiers: ["OPE-127"],
    dependencyCount: 1,
    replyCommentId: "reply-1",
    result: "updated",
    updatedChildIssueIdentifiers: [],
    updatedParentDescription: true,
    warnings: [],
  });
  expect(calls.update).toEqual([{ description: "Updated parent description" }]);
  expect(calls.createIssue[0]).toMatchObject({
    description: "Child description",
    parentId: "issue-1",
    stateId: "state-todo",
    teamId: "team-1",
    title: "Create child issue",
  });
  expect(calls.issueAddLabel).toEqual([{ issueId: "child-1", labelId: "label-agent" }]);
  expect(calls.attachmentLinkURL).toEqual([
    {
      issueId: "child-1",
      title: "./io/topic/goals.md",
      url: "./io/topic/goals.md",
    },
  ]);
  expect(calls.createIssueRelation).toEqual([
    {
      issueId: "child-1",
      relatedIssueId: "existing-child",
      type: "blocks",
    },
  ]);
  expect(calls.createComment[0]?.parentId).toBe("comment-1");
});

test("LinearTrackerAdapter reuses todo children and relinks dependencies without rerun churn", async () => {
  const calls = {
    attachmentLinkURL: [] as Array<{ issueId: string; title?: string; url: string }>,
    createComment: [] as Array<{ body: string; issueId: string; parentId: string }>,
    deleteIssueRelation: [] as string[],
    update: [] as Array<Record<string, unknown>>,
  };
  const childState = {
    attachments: new Set<string>(),
    blockers: new Map([["old-blocker", "relation-1"]]),
    description: "Old child description",
    priority: 2,
    state: "Todo",
    title: "Old child title",
  };
  const child = {
    attachments: async () => ({
      nodes: [...childState.attachments].map((url) => ({ title: url, url })),
    }),
    get description() {
      return childState.description;
    },
    id: "child-1",
    identifier: "OPE-127",
    inverseRelations: async () => ({
      nodes: [...childState.blockers.entries()].map(([relatedIssueId, id]) => ({
        id,
        relatedIssueId,
        type: "blocks",
      })),
    }),
    labels: async () => ({
      nodes: [{ id: "label-agent", name: "agent" }],
    }),
    get priority() {
      return childState.priority;
    },
    get state() {
      return Promise.resolve({ name: childState.state });
    },
    get title() {
      return childState.title;
    },
    update: async (input: Record<string, unknown>) => {
      calls.update.push(input);
      if (typeof input.description === "string") {
        childState.description = input.description;
      }
      if (typeof input.title === "string") {
        childState.title = input.title;
      }
      if (typeof input.priority === "number") {
        childState.priority = input.priority;
      }
      return { success: true };
    },
  };

  const tracker = new LinearTrackerAdapter(
    {
      activeStates: ["Todo"],
      apiKey: "token",
      endpoint: "https://linear.invalid/graphql",
      kind: "linear",
      projectSlug: "io",
      terminalStates: ["Done"],
    },
    undefined,
    {
      attachmentLinkURL: async (issueId: string, url: string, options?: { title?: string }) => {
        calls.attachmentLinkURL.push({ issueId, title: options?.title, url });
        childState.attachments.add(url);
        return { success: true };
      },
      createComment: async (input: { body: string; issueId: string; parentId: string }) => {
        calls.createComment.push(input);
        return { commentId: `reply-${calls.createComment.length}`, success: true };
      },
      deleteIssueRelation: async (id: string) => {
        calls.deleteIssueRelation.push(id);
        for (const [relatedIssueId, relationId] of childState.blockers.entries()) {
          if (relationId === id) {
            childState.blockers.delete(relatedIssueId);
          }
        }
        return { success: true };
      },
      issue: async () => ({
        children: async () => ({ nodes: [child] }),
        teamId: "team-1",
        update: async () => ({ success: true }),
      }),
      team: async () => ({
        labels: async () => ({ nodes: [{ id: "label-agent", name: "agent" }] }),
        states: async () => ({ nodes: [{ id: "state-todo", name: "Todo" }] }),
      }),
    } as never,
  );

  const mutation = {
    children: [
      {
        blockedBy: [],
        description: "New child description",
        docs: ["./io/topic/goals.md"],
        labels: ["agent"],
        priority: 2,
        reference: "managed-child-1",
        state: "Todo",
        title: "New child title",
      },
    ],
    comment: {
      body: "@io backlog",
      bodyHash: "hash",
      command: "backlog" as const,
      commentId: "comment-1",
      createdAt: "2024-01-02T00:00:00.000Z",
      issue: createIssue({
        description: "Parent description",
        id: "issue-1",
        identifier: "OPE-126",
        labels: ["io", "agent"],
        priority: 2,
        teamId: "team-1",
        title: "Managed parent",
      }),
      payload: {
        docs: [],
        dryRun: false,
      },
      updatedAt: "2024-01-02T00:00:00.000Z",
    },
    parentDescription: "Parent description",
    reply: {
      command: "backlog",
      issueIdentifier: "OPE-126 / agent",
      lines: [],
      result: "noop",
    },
  } satisfies Parameters<NonNullable<LinearTrackerAdapter["applyManagedCommentMutation"]>>[0];

  const firstResult = await tracker.applyManagedCommentMutation?.(mutation);
  const secondResult = await tracker.applyManagedCommentMutation?.({
    ...mutation,
    comment: {
      ...mutation.comment,
      commentId: "comment-2",
    },
  });

  expect(firstResult).toEqual({
    createdChildIssueIdentifiers: [],
    dependencyCount: 1,
    replyCommentId: "reply-1",
    result: "updated",
    updatedChildIssueIdentifiers: ["OPE-127"],
    updatedParentDescription: false,
    warnings: [],
  });
  expect(secondResult).toEqual({
    createdChildIssueIdentifiers: [],
    dependencyCount: 0,
    replyCommentId: "reply-2",
    result: "noop",
    updatedChildIssueIdentifiers: [],
    updatedParentDescription: false,
    warnings: [],
  });
  expect(calls.attachmentLinkURL).toEqual([
    {
      issueId: "child-1",
      title: "./io/topic/goals.md",
      url: "./io/topic/goals.md",
    },
  ]);
  expect(calls.update).toEqual([{ description: "New child description", title: "New child title" }]);
  expect(calls.deleteIssueRelation).toEqual(["relation-1"]);
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

test("AgentService records handled managed comments and skips them on the next poll", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-service-comments-"));
  let mutations = 0;
  const trigger = {
    body: "@io help",
    bodyHash: "hash-1",
    command: "help" as const,
    commentId: "comment-1",
    createdAt: "2024-01-02T00:00:00.000Z",
    issue: createIssue({
      description: "Managed parent",
      id: "issue-1",
      identifier: "OPE-126",
      labels: ["io", "agent"],
      teamId: "team-1",
      title: "Managed parent",
    }),
    payload: {
      docs: [],
      dryRun: false,
    },
    updatedAt: "2024-01-02T00:00:00.000Z",
  };

  await mkdir(resolve(root, "llm", "topic"), { recursive: true });
  await writeFile(
    resolve(root, "io.json"),
    JSON.stringify(
      {
        agent: { maxConcurrentAgents: 1 },
        modules: {
          agent: {
            allowedSharedPaths: ["./llm/topic"],
            docs: ["./llm/topic/agent.md"],
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
      },
      null,
      2,
    ),
  );
  await writeFile(resolve(root, "io.md"), "LOCAL {{ issue.identifier }}\n");
  await writeFile(resolve(root, "llm", "topic", "agent.md"), "# Agent\n");
  process.env.LINEAR_API_KEY = "linear-token";
  process.env.LINEAR_PROJECT_SLUG = "io";

  try {
    const service = new AgentService({
      repoRoot: root,
      trackerFactory: () => ({
        applyManagedCommentMutation: async () => {
          mutations += 1;
          return {
            createdChildIssueIdentifiers: [],
            dependencyCount: 0,
            replyCommentId: "reply-1",
            result: "noop",
            updatedChildIssueIdentifiers: [],
            updatedParentDescription: false,
            warnings: [],
          };
        },
        fetchCandidateIssues: async () => [],
        fetchIssueStatesByIds: async () => new Map(),
        fetchManagedCommentTriggers: async () => [trigger],
        setIssueState: async () => undefined,
      }),
      workspaceManagerFactory: (_workflow, issueIdentifier) =>
        ({
          cleanup: async () => undefined,
          createIdleWorkspace: () => ({
            branchName: "main",
            controlPath: root,
            createdNow: true,
            originPath: root,
            path: resolve(root, "workspace", "workers", issueIdentifier ?? "supervisor", "repo"),
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

    await service.runOnce();
    await service.runOnce();

    const state = JSON.parse(
      await readFile(resolve(root, "workspace", "issue", "ope-126", "comment-state.json"), "utf8"),
    );
    expect(mutations).toBe(1);
    expect(state.comments).toEqual([
      {
        bodyHash: "hash-1",
        commentId: "comment-1",
        handledAt: expect.any(String),
      },
    ]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("AgentService writes the canonical focus doc and treats equivalent focus refreshes as no-ops", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-service-focus-"));
  const replies: string[] = [];
  let triggerFetches = 0;

  await mkdir(resolve(root, "agent"), { recursive: true });
  await mkdir(resolve(root, "llm", "topic"), { recursive: true });
  await writeFile(
    resolve(root, "io.json"),
    JSON.stringify(
      {
        agent: { maxConcurrentAgents: 1 },
        modules: {
          agent: {
            allowedSharedPaths: ["./llm/topic"],
            docs: ["./llm/topic/agent.md"],
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
      },
      null,
      2,
    ),
  );
  await writeFile(resolve(root, "io.md"), "LOCAL {{ issue.identifier }}\n");
  await writeFile(
    resolve(root, "llm", "topic", "agent.md"),
    `# Agent Stream

## Current Focus

- refresh managed write surfaces
- keep reruns deterministic
`,
  );
  process.env.LINEAR_API_KEY = "linear-token";
  process.env.LINEAR_PROJECT_SLUG = "io";

  const baseTrigger = {
    body: "@io focus",
    bodyHash: "hash-focus",
    command: "focus" as const,
    createdAt: "2024-01-02T00:00:00.000Z",
    issue: createIssue({
      description: `## Outcome

- Implement repo-wide focus refresh.
- Keep managed write surfaces aligned.

## Scope

- Update the canonical focus doc path.
- Keep backlog and focus refreshes deterministic.

## Out Of Scope

- Non-agent module rollout.
`,
      hasChildren: true,
      id: "issue-1",
      identifier: "OPE-134",
      labels: ["io", "agent"],
      priority: 3,
      teamId: "team-1",
      title: "Implement repo-wide focus refresh",
    }),
    payload: {
      docs: [],
      dryRun: false,
    },
    updatedAt: "2024-01-02T00:00:00.000Z",
  };

  try {
    const service = new AgentService({
      repoRoot: root,
      trackerFactory: () => ({
        applyManagedCommentMutation: async (mutation) => {
          replies.push(mutation.reply.lines.join("\n"));
          return {
            createdChildIssueIdentifiers: [],
            dependencyCount: 0,
            replyCommentId: `reply-${replies.length}`,
            result: "noop",
            updatedChildIssueIdentifiers: [],
            updatedParentDescription: false,
            warnings: [],
          };
        },
        fetchCandidateIssues: async () => [],
        fetchIssueStatesByIds: async () => new Map(),
        fetchManagedCommentTriggers: async () => {
          triggerFetches += 1;
          return [
            {
              ...baseTrigger,
              commentId: `comment-${triggerFetches}`,
            },
          ];
        },
        setIssueState: async () => undefined,
      }),
      workspaceManagerFactory: (_workflow, issueIdentifier) =>
        ({
          cleanup: async () => undefined,
          createIdleWorkspace: () => ({
            branchName: "main",
            controlPath: root,
            createdNow: true,
            originPath: root,
            path: resolve(root, "workspace", "workers", issueIdentifier ?? "supervisor", "repo"),
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

    await service.runOnce();
    await service.runOnce();

    const focusDoc = await readFile(resolve(root, "llm", "topic", "goals.md"), "utf8");
    expect(focusDoc).toContain("# OPE-134: Implement repo-wide focus refresh");
    expect(focusDoc).toContain("## Objective");
    expect(focusDoc).toContain("## Current Focus");
    expect(focusDoc).toContain("## Proof Surfaces");
    expect(focusDoc).toContain("./agent");
    expect(replies).toEqual([
      expect.stringContaining("Updated ./llm/topic/goals.md."),
      expect.stringContaining("./llm/topic/goals.md was already up to date."),
    ]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
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

test("resolveIssueRouting routes io-managed parent issues to backlog from module labels", () => {
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
    agent: "backlog",
    profile: "backlog",
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

test("AgentService rewrites managed parent backlog issues before running the backlog prompt", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "agent-service-"));
  const workspacePath = resolve(root, "workspace", "workers", "OPE-127", "repo");
  let capturedPrompt = "";
  let updatedDescription = "";

  await mkdir(resolve(root, "llm", "topic"), { recursive: true });
  await writeFile(
    resolve(root, "io.json"),
    JSON.stringify(
      {
        agent: { maxConcurrentAgents: 1 },
        modules: {
          agent: {
            allowedSharedPaths: ["./llm/topic"],
            docs: ["./llm/topic/agent.md"],
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
      },
      null,
      2,
    ),
  );
  await writeFile(resolve(root, "io.md"), "LOCAL BACKLOG {{ issue.identifier }}\n");
  await writeFile(
    resolve(root, "llm", "topic", "agent.md"),
    `# IO Agent Stream

## Current Focus

- improve operator utility
- improve planning and context quality

## Good Changes In This Stream

- quality of backlog/spec refinement
`,
  );
  process.env.LINEAR_API_KEY = "linear-token";
  process.env.LINEAR_PROJECT_SLUG = "project-slug";

  try {
    const service = new AgentService({
      once: true,
      repoRoot: root,
      runnerFactory: () => ({
        run: async ({ issue, prompt, workspace }) => {
          capturedPrompt = prompt;
          updatedDescription = issue.description;
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
        fetchCandidateIssues: async () => [
          createIssue({
            id: "1",
            identifier: "OPE-127",
            labels: ["io", "agent"],
            priority: 2,
            description: `## Outcome

A fresh managed parent issue should be transformable into a durable planning brief.

## Deliverables

- define the parent issue section format so reruns can update only agent-owned sections
- implement proposal generation in the backlog path
- preserve human-authored decision sections when the issue is rerun

## Decisions

- Keep human narrowing outside managed sections.
`,
            title: "Implement proposal writeback",
          }),
        ],
        fetchIssueStatesByIds: async () => new Map(),
        setIssueState: async () => undefined,
        updateIssueDescription: async (_issueId, description) => {
          updatedDescription = description;
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
            branchName: "io/ope-127",
            controlPath: root,
            createdNow: true,
            originPath: root,
            path: workspacePath,
            sourceRepoPath: root,
            workerId: "OPE-127",
          }),
          reconcileTerminalIssues: async () => undefined,
          runAfterRunHook: async () => undefined,
          runBeforeRunHook: async () => undefined,
        }) as unknown as never,
    });

    await service.start();

    expect(updatedDescription).toContain("<!-- io-managed:backlog-proposal:start -->");
    expect(updatedDescription).toContain("## Managed Brief");
    expect(updatedDescription).toContain("## Decisions");
    expect(capturedPrompt).toContain("## Managed Brief");
    expect(capturedPrompt).toContain("Keep human narrowing outside managed sections.");
    expect(capturedPrompt).toContain("You are the IO Backlog Agent.");
  } finally {
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
