import { describe, expect, it } from "bun:test";

import {
  workflowStatus,
  workflowStatusCategory,
  workspace,
  workspaceIssue,
  workspaceLabel,
  workspaceProject,
  workspaceSchema,
} from "../schema/app/workspace/index.js";
import * as workspaceTaxonomyExports from "./workspace.js";

describe("workspace taxonomy", () => {
  it("aggregates the root-safe workspace slice without adapter exports", () => {
    expect(workspaceTaxonomyExports).toMatchObject({
      workflowStatus,
      workflowStatusCategory,
      workspace,
      workspaceIssue,
      workspaceLabel,
      workspaceProject,
      workspaceTaxonomy: workspaceSchema,
    });
    expect(Object.keys(workspaceTaxonomyExports).sort()).toEqual([
      "workflowStatus",
      "workflowStatusCategory",
      "workspace",
      "workspaceIssue",
      "workspaceLabel",
      "workspaceProject",
      "workspaceTaxonomy",
    ]);
    expect(workspaceTaxonomyExports.workspaceTaxonomy).toBe(workspaceSchema);
    expect("PredicateFieldView" in workspaceTaxonomyExports).toBe(false);
    expect("workspaceSchema" in workspaceTaxonomyExports).toBe(false);
  });
});
