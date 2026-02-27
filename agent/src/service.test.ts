import { expect, test } from 'bun:test';

import { pickCandidateIssues } from './service.js';
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
