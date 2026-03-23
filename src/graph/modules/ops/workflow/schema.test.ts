import { describe, expect, it } from "bun:test";

import { createIdMap } from "../../../runtime/identity.js";
import { ops } from "../../ops.js";
import {
  workflowBranchKeyPattern,
  workflowProjectKeyPattern,
  workflowRepositoryKeyPattern,
  workflowSchema,
} from "./schema.js";

const lifecycleContext = {
  event: "create" as const,
  nodeId: "workflow-1",
  now: new Date("2026-01-01T00:00:00.000Z"),
  incoming: undefined,
  previous: undefined,
  changedPredicateKeys: new Set<string>(),
};

describe("ops workflow schema", () => {
  it("owns stable keys for the workflow root and repository execution records", () => {
    const { map } = createIdMap(workflowSchema);

    expect(Object.keys(map.keys)).toEqual(
      expect.arrayContaining([
        "ops:workflowProject",
        "ops:workflowProject:projectKey",
        "ops:workflowRepository",
        "ops:workflowRepository:project",
        "ops:workflowRepository:repositoryKey",
        "ops:workflowBranchState",
        "ops:workflowBranchState.backlog",
        "ops:workflowBranch",
        "ops:workflowBranch:activeCommit",
        "ops:workflowCommitState",
        "ops:workflowCommit",
        "ops:workflowCommit:parentCommit",
        "ops:repositoryBranch",
        "ops:repositoryBranch:workflowBranch",
        "ops:repositoryCommitState",
        "ops:repositoryCommitLeaseState",
        "ops:repositoryCommit",
        "ops:repositoryCommit:worktree",
        "ops:repositoryCommit:worktree:leaseState",
      ]),
    );
  });

  it("resolves workflow refs and nested worktree fields through the canonical ops namespace", () => {
    expect(String(ops.workflowRepository.fields.project.range)).toBe(ops.workflowProject.values.id);
    expect(String(ops.workflowBranch.fields.project.range)).toBe(ops.workflowProject.values.id);
    expect(String(ops.workflowBranch.fields.activeCommit.range)).toBe(ops.workflowCommit.values.id);
    expect(String(ops.workflowCommit.fields.branch.range)).toBe(ops.workflowBranch.values.id);
    expect(String(ops.repositoryBranch.fields.repository.range)).toBe(
      ops.workflowRepository.values.id,
    );
    expect(String(ops.repositoryCommit.fields.repositoryBranch.range)).toBe(
      ops.repositoryBranch.values.id,
    );
    expect(String(ops.repositoryCommit.fields.workflowCommit.range)).toBe(
      ops.workflowCommit.values.id,
    );
    expect(String(ops.repositoryCommit.fields.worktree.leaseState.range)).toBe(
      ops.repositoryCommitLeaseState.values.id,
    );
    expect(typeof ops.workflowProject.fields.projectKey.id).toBe("string");
    expect(typeof ops.repositoryCommit.fields.worktree.leaseState.id).toBe("string");
  });

  it("validates stable workflow keys and defaults v1 lifecycle fields", () => {
    expect(workflowProjectKeyPattern.test("project:io")).toBe(true);
    expect(workflowRepositoryKeyPattern.test("repo:io")).toBe(true);
    expect(workflowBranchKeyPattern.test("branch:workflow-graph-native")).toBe(true);

    expect(
      ops.workflowProject.fields.projectKey.validate?.({
        event: "create",
        phase: "local",
        nodeId: "workflow-project-1",
        now: new Date("2026-01-01T00:00:00.000Z"),
        path: [],
        field: "projectKey",
        predicateKey: ops.workflowProject.fields.projectKey.key,
        range: ops.workflowProject.fields.projectKey.range,
        cardinality: ops.workflowProject.fields.projectKey.cardinality,
        value: "repo:io",
        previous: undefined,
        changedPredicateKeys: new Set<string>([ops.workflowProject.fields.projectKey.key]),
      }),
    ).toEqual({
      code: "workflow.key.invalid",
      message:
        'Project key must start with "project:" and use only lowercase letters, numbers, and hyphen-separated segments.',
    });

    expect(
      ops.workflowCommit.fields.order.validate?.({
        event: "create",
        phase: "local",
        nodeId: "workflow-commit-1",
        now: new Date("2026-01-01T00:00:00.000Z"),
        path: [],
        field: "order",
        predicateKey: ops.workflowCommit.fields.order.key,
        range: ops.workflowCommit.fields.order.range,
        cardinality: ops.workflowCommit.fields.order.cardinality,
        value: -1,
        previous: undefined,
        changedPredicateKeys: new Set<string>([ops.workflowCommit.fields.order.key]),
      }),
    ).toEqual({
      code: "workflow.integer.invalid",
      message: "Commit order must be a non-negative integer.",
    });

    expect(ops.workflowProject.fields.inferred.onCreate?.(lifecycleContext)).toBe(true);
    expect(ops.repositoryBranch.fields.managed.onCreate?.(lifecycleContext)).toBe(false);
    expect(ops.workflowBranch.fields.state.onCreate?.(lifecycleContext)).toBe(
      ops.workflowBranchState.values.backlog.id,
    );
    expect(ops.workflowCommit.fields.state.onCreate?.(lifecycleContext)).toBe(
      ops.workflowCommitState.values.planned.id,
    );
    expect(ops.repositoryCommit.fields.state.onCreate?.(lifecycleContext)).toBe(
      ops.repositoryCommitState.values.planned.id,
    );
    expect(ops.repositoryCommit.fields.worktree.leaseState.onCreate?.(lifecycleContext)).toBe(
      ops.repositoryCommitLeaseState.values.unassigned.id,
    );
  });
});
