import { describe, expect, it } from "bun:test";

import { WorkspaceManagementScreen } from "./screen.js";
import { workspaceExperimentWeb } from "./web.js";

describe("workspace experiment web", () => {
  it("registers the workspace route with the experiment-local screen", () => {
    expect(workspaceExperimentWeb.routes).toContainEqual(
      expect.objectContaining({
        component: WorkspaceManagementScreen,
        key: "workspace",
        path: "/workspace",
      }),
    );
  });
});
