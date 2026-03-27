import { describe, expect, it } from "bun:test";

import {
  createWorkflowReviewStartupContract,
  resolveCanonicalWorkflowRouteSearch,
  resolveWorkflowReviewStartupState,
  validateWorkflowRouteSearch,
} from "./workflow-review-contract.js";

describe("workflow review startup contract", () => {
  it("defaults the browser workflow route to the workflow-review sync scope", () => {
    const contract = createWorkflowReviewStartupContract();

    expect(contract.graph.requestedScope).toEqual({
      kind: "module",
      moduleId: "workflow",
      scopeId: "scope:workflow:review",
    });
    expect(contract.initialSelection.project).toEqual({
      kind: "infer-singleton",
    });
    expect(contract.initialSelection.branch).toEqual({
      kind: "first-branch-board-row",
    });
  });

  it("normalizes workflow route search params", () => {
    expect(
      validateWorkflowRouteSearch({
        branch: " branch:workflow-review ",
        project: " project:io ",
      }),
    ).toEqual({
      branch: "branch:workflow-review",
      project: "project:io",
    });

    expect(
      validateWorkflowRouteSearch({
        branch: "   ",
        project: 42,
      }),
    ).toEqual({});
  });

  it("requires explicit project selection when the review scope exposes multiple projects", () => {
    const contract = createWorkflowReviewStartupContract();

    expect(
      resolveWorkflowReviewStartupState(
        [
          { id: "project:io", title: "IO" },
          { id: "project:docs", title: "Docs" },
        ],
        [],
        contract,
      ),
    ).toMatchObject({
      kind: "missing-data",
      reason: "project-selection-required",
    });
  });

  it("falls back to the first branch-board row contract after project inference", () => {
    const contract = createWorkflowReviewStartupContract();
    const state = resolveWorkflowReviewStartupState(
      [{ id: "project:io", title: "IO" }],
      [
        {
          id: "branch:later",
          projectId: "project:io",
          queueRank: 2,
          title: "Later",
          updatedAt: "2026-03-25T00:00:00.000Z",
        },
        {
          id: "branch:first",
          projectId: "project:io",
          queueRank: 1,
          title: "First",
          updatedAt: "2026-03-26T00:00:00.000Z",
        },
      ],
      contract,
    );

    expect(state).toMatchObject({
      kind: "ready",
      project: {
        id: "project:io",
      },
      selectedBranch: {
        id: "branch:first",
      },
    });
  });

  it("surfaces configured branch drift as partial data", () => {
    const contract = createWorkflowReviewStartupContract({
      branch: "branch:missing",
      project: "project:io",
    });

    expect(
      resolveWorkflowReviewStartupState(
        [{ id: "project:io", title: "IO" }],
        [
          {
            id: "branch:visible",
            projectId: "project:io",
            queueRank: 1,
            title: "Visible",
            updatedAt: "2026-03-26T00:00:00.000Z",
          },
        ],
        contract,
      ),
    ).toMatchObject({
      kind: "partial-data",
      reason: "configured-branch-missing",
    });
  });

  it("canonicalizes inferred route selection once the resolved project and branch are known", () => {
    const contract = createWorkflowReviewStartupContract();
    const startupState = resolveWorkflowReviewStartupState(
      [{ id: "project:io", title: "IO" }],
      [
        {
          id: "branch:first",
          projectId: "project:io",
          queueRank: 1,
          title: "First",
          updatedAt: "2026-03-26T00:00:00.000Z",
        },
      ],
      contract,
    );

    expect(resolveCanonicalWorkflowRouteSearch({}, startupState)).toEqual({
      branch: "branch:first",
      project: "project:io",
    });
  });

  it("preserves explicit stale branch selections instead of rewriting them to another branch", () => {
    const contract = createWorkflowReviewStartupContract({
      branch: "branch:missing",
      project: "project:io",
    });
    const startupState = resolveWorkflowReviewStartupState(
      [{ id: "project:io", title: "IO" }],
      [
        {
          id: "branch:visible",
          projectId: "project:io",
          queueRank: 1,
          title: "Visible",
          updatedAt: "2026-03-26T00:00:00.000Z",
        },
      ],
      contract,
    );

    expect(
      resolveCanonicalWorkflowRouteSearch(
        {
          branch: "branch:missing",
          project: "project:io",
        },
        startupState,
      ),
    ).toBeUndefined();
  });

  it("canonicalizes singleton project selection when the project has no visible branches", () => {
    const contract = createWorkflowReviewStartupContract();
    const startupState = resolveWorkflowReviewStartupState(
      [{ id: "project:io", title: "IO" }],
      [],
      contract,
    );

    expect(resolveCanonicalWorkflowRouteSearch({}, startupState)).toEqual({
      project: "project:io",
    });
  });
});
