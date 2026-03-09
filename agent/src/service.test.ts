import { expect, mock, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { AgentService, pickAssignedIssue, pickCandidateIssues } from './service.js';
import { normalizeLinearIssue } from './tracker/linear.js';

test('normalizeLinearIssue lowercases labels and fills defaults', () => {
  const issue = normalizeLinearIssue({
    createdAt: '2024-01-01T00:00:00.000Z',
    description: null,
    id: '1',
    identifier: 'OS-7',
    labels: { nodes: [{ name: 'Bug' }, { name: ' P1 ' }, null] },
    priority: 2,
    state: { name: 'Todo' },
    title: 'Fix integration',
    updatedAt: '2024-01-01T00:00:00.000Z',
  });
  expect(issue.labels).toEqual(['bug', 'p1']);
  expect(issue.description).toBe('');
  expect(issue.blockedBy).toEqual([]);
});

test('pickCandidateIssues prefers unblocked todo issues by priority', () => {
  const selected = pickCandidateIssues(
    [
      {
        blockedBy: ['OS-1'],
        createdAt: '2024-01-01T00:00:00.000Z',
        description: '',
        id: '3',
        identifier: 'OS-3',
        labels: [],
        priority: 5,
        state: 'Todo',
        title: 'Blocked',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
      {
        blockedBy: [],
        createdAt: '2024-01-01T00:00:00.000Z',
        description: '',
        id: '2',
        identifier: 'OS-2',
        labels: [],
        priority: 1,
        state: 'In Progress',
        title: 'Later',
        updatedAt: '2024-01-02T00:00:00.000Z',
      },
      {
        blockedBy: [],
        createdAt: '2024-01-01T00:00:00.000Z',
        description: '',
        id: '1',
        identifier: 'OS-1',
        labels: [],
        priority: 3,
        state: 'Todo',
        title: 'First',
        updatedAt: '2024-01-03T00:00:00.000Z',
      },
    ],
    2,
  );
  expect(selected.map((issue) => issue.identifier)).toEqual(['OS-1', 'OS-2']);
});

test('pickAssignedIssue deterministically partitions issues by worker index', () => {
  const issues = [
    {
      blockedBy: [],
      createdAt: '2024-01-01T00:00:00.000Z',
      description: '',
      id: '1',
      identifier: 'OS-1',
      labels: [],
      priority: 3,
      state: 'Todo',
      title: 'First',
      updatedAt: '2024-01-03T00:00:00.000Z',
    },
    {
      blockedBy: [],
      createdAt: '2024-01-01T00:00:00.000Z',
      description: '',
      id: '2',
      identifier: 'OS-2',
      labels: [],
      priority: 2,
      state: 'Todo',
      title: 'Second',
      updatedAt: '2024-01-02T00:00:00.000Z',
    },
  ];

  expect(pickAssignedIssue(issues, 2, 0)?.identifier).toBe('OS-1');
  expect(pickAssignedIssue(issues, 2, 1)?.identifier).toBe('OS-2');
});

test('AgentService eagerly creates worker checkout on start', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'agent-service-'));
  const workflowPath = resolve(root, 'WORKFLOW.md');
  const writes: string[] = [];

  await writeFile(
    workflowPath,
    `---
tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
  project_slug: $LINEAR_PROJECT_SLUG
workspace:
  root: ${resolve(root, 'workspace')}
agent:
  max_concurrent_agents: 1
---
Issue {{ issue.identifier }}
`,
  );
  process.env.LINEAR_API_KEY = 'linear-token';
  process.env.LINEAR_PROJECT_SLUG = 'project-slug';

  const originalWrite = process.stdout.write.bind(process.stdout);
  const originalFetch = globalThis.fetch;
  const writeSpy = mock((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  });
  process.stdout.write = writeSpy as typeof process.stdout.write;
  globalThis.fetch = mock(async () =>
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
      workerId: 'igor',
      workflowPath,
      workspaceManagerFactory: () =>
        ({
          cleanup: async () => undefined,
          createIdleWorkspace: () => ({
            branchName: 'main',
            createdNow: true,
            originPath: root,
            path: resolve(root, 'workspace', 'workers', 'igor', 'repo'),
            sourceRepoPath: root,
            workerId: 'igor',
          }),
          ensureCheckout: async () => ({ createdNow: true, path: resolve(root, 'workspace', 'workers', 'igor', 'repo') }),
        }) as unknown as never,
    });

    await service.start();
    expect(writes.some((entry) => entry.includes('igor: ready at'))).toBe(true);
    expect(writes.some((entry) => entry.includes('igor: No issues'))).toBe(true);
  } finally {
    globalThis.fetch = originalFetch;
    process.stdout.write = originalWrite;
    await rm(root, { force: true, recursive: true });
  }
});
