import { describe, expect, it } from "bun:test";

import {
  createWorkflowSessionFeedContract,
  resolveWorkflowSessionFeedSelectionState,
  validateWorkflowSessionFeedRouteSearch,
} from "./workflow-session-feed-contract.js";

describe("workflow session feed contract", () => {
  it("normalizes feed route search params", () => {
    expect(
      validateWorkflowSessionFeedRouteSearch({
        commit: " commit:workflow-session ",
        session: " session:latest ",
      }),
    ).toEqual({
      commit: "commit:workflow-session",
      session: "session:latest",
    });

    expect(
      validateWorkflowSessionFeedRouteSearch({
        commit: "   ",
        session: 42,
      }),
    ).toEqual({});
  });

  it("defaults to the latest branch-scoped session for the selected branch", () => {
    const contract = createWorkflowSessionFeedContract();

    expect(contract.initialSelection.subject).toEqual({
      kind: "branch",
    });
    expect(contract.initialSelection.session).toEqual({
      kind: "latest-for-subject",
    });
    expect(contract.read).toEqual({
      kind: "session-feed",
      query: {
        projectId: ":selected-project-id",
        session: ":selected-workflow-session",
        subject: ":selected-workflow-subject",
      },
    });

    expect(
      resolveWorkflowSessionFeedSelectionState({
        contract,
        selectedBranchId: "branch:workflow",
        selectedProjectId: "project:io",
      }),
    ).toEqual({
      contract,
      kind: "ready",
      query: {
        projectId: "project:io",
        session: {
          kind: "latest-for-subject",
        },
        subject: {
          branchId: "branch:workflow",
          kind: "branch",
        },
      },
    });
  });

  it("uses explicit commit and session selections when the route provides them", () => {
    const contract = createWorkflowSessionFeedContract({
      commit: "commit:selected",
      session: "session:known",
    });

    expect(
      resolveWorkflowSessionFeedSelectionState({
        contract,
        selectedBranchId: "branch:workflow",
        selectedProjectId: "project:io",
        visibleCommitIds: ["commit:selected", "commit:next"],
      }),
    ).toEqual({
      contract,
      kind: "ready",
      query: {
        projectId: "project:io",
        session: {
          kind: "session-id",
          sessionId: "session:known",
        },
        subject: {
          branchId: "branch:workflow",
          commitId: "commit:selected",
          kind: "commit",
        },
      },
    });
  });

  it("requires a selected branch before resolving a feed read", () => {
    const contract = createWorkflowSessionFeedContract();

    expect(
      resolveWorkflowSessionFeedSelectionState({
        contract,
      }),
    ).toEqual({
      contract,
      kind: "missing-data",
      message: "Select a workflow branch before reading the retained session feed.",
      reason: "branch-selection-required",
    });
  });

  it("surfaces configured commit drift instead of silently falling back", () => {
    const contract = createWorkflowSessionFeedContract({
      commit: "commit:missing",
    });

    expect(
      resolveWorkflowSessionFeedSelectionState({
        contract,
        selectedBranchId: "branch:workflow",
        selectedProjectId: "project:io",
        visibleCommitIds: ["commit:visible"],
      }),
    ).toEqual({
      availableCommitIds: ["commit:visible"],
      contract,
      kind: "stale-selection",
      message: "The configured workflow commit is not visible in the selected branch commit queue.",
      reason: "configured-commit-missing",
    });
  });
});
