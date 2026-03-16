import { describe, expect, it } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { act } from "react";

import { createExampleRuntime } from "../../../../../app/src/graph/runtime.js";
import { getByData, getReactProps, getRequiredElement, textContent } from "../../../test-dom.js";
import { WorkspaceManagementSurface } from "../../../react-dom/index.js";
import { workspaceManagementWorkflow } from "./index.js";

describe("workspace react-dom surface", () => {
  it("renders the promoted workspace workflow surface from the graph adapter export", async () => {
    const runtime = createExampleRuntime();
    const { container, unmount } = render(<WorkspaceManagementSurface runtime={runtime} />);

    expect(getByData(container, "data-workspace-workflow", workspaceManagementWorkflow.key)).toBeDefined();
    expect(textContent(container)).toContain("IO Planning Workspace");

    const routeIssue = getByData(container, "data-workspace-entity-item", runtime.ids.workspaceRoute);
    await act(async () => {
      fireEvent.click(routeIssue);
      await Promise.resolve();
    });

    const nameField = getByData(container, "data-workspace-field", "name");
    const nameInput = getRequiredElement(
      nameField.querySelector<HTMLInputElement>('input[data-web-field-kind="text"]'),
      "Expected workspace name input.",
    );

    await act(async () => {
      getReactProps<{ onChange(event: { target: { value: string } }): void }>(nameInput).onChange({
        target: { value: "Promoted workspace management surface" },
      });
      await Promise.resolve();
    });

    expect(runtime.graph.workspaceIssue.get(runtime.ids.workspaceRoute).name).toBe(
      "Promoted workspace management surface",
    );

    unmount();
  });
});
