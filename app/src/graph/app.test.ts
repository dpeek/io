import { describe, expect, it } from "bun:test";

import { envVar, secretRef } from "@io/graph/schema/app/env-vars";
import { block } from "@io/graph/schema/app/outliner";
import {
  workflowStatus,
  workflowStatusCategory,
  workspace,
  workspaceIssue,
  workspaceLabel,
  workspaceProject,
} from "@io/graph/schema/app/workspace";

import * as appGraphExports from "./app.js";

describe("app graph exports", () => {
  it("re-exports promoted schema from the canonical graph schema tree", () => {
    expect(appGraphExports.envVar).toBe(envVar);
    expect(appGraphExports.secretRef).toBe(secretRef);
    expect(appGraphExports.block).toBe(block);
    expect(appGraphExports.workflowStatus).toBe(workflowStatus);
    expect(appGraphExports.workflowStatusCategory).toBe(workflowStatusCategory);
    expect(appGraphExports.workspace).toBe(workspace);
    expect(appGraphExports.workspaceIssue).toBe(workspaceIssue);
    expect(appGraphExports.workspaceLabel).toBe(workspaceLabel);
    expect(appGraphExports.workspaceProject).toBe(workspaceProject);
  });
});
