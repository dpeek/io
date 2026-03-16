import { describe, expect, it } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { act } from "react";

import { createExampleRuntime } from "../../graph/runtime.js";
import { getByData, getReactProps, getRequiredElement, textContent } from "../../test-dom.js";
import {
  workspaceIssueObjectView,
  workspaceLabelObjectView,
  workspaceProjectObjectView,
} from "./graph.js";
import { WorkspaceManagementScreen } from "./screen.js";

describe("workspace management surface", () => {
  it("browses and edits seeded issue fields through the routed workspace surface", async () => {
    const runtime = createExampleRuntime();
    const { container, unmount } = render(<WorkspaceManagementScreen runtime={runtime} />);

    expect(textContent(container)).toContain("IO Planning Workspace");
    expect(getByData(container, "data-workspace-object-view", workspaceIssueObjectView.key)).toBeDefined();

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
    const statusField = getByData(container, "data-workspace-field", "status");
    const statusSelect = getRequiredElement(
      statusField.querySelector<HTMLSelectElement>('select[data-workspace-reference-select="status"]'),
      "Expected status select.",
    );
    const projectField = getByData(container, "data-workspace-field", "project");
    const projectSelect = getRequiredElement(
      projectField.querySelector<HTMLSelectElement>('select[data-workspace-reference-select="project"]'),
      "Expected project select.",
    );
    const labelsField = getByData(container, "data-workspace-field", "labels");
    const planningLabelCheckbox = getRequiredElement(
      labelsField.querySelector<HTMLInputElement>(
        `label[data-web-reference-option-id="${runtime.ids.planningLabel}"] input`,
      ),
      "Expected planning label checkbox.",
    );

    await act(async () => {
      getReactProps<{ onChange(event: { target: { value: string } }): void }>(nameInput).onChange({
        target: { value: "Build the routed workspace surface" },
      });
      getReactProps<{ onChange(event: { target: { value: string } }): void }>(statusSelect).onChange({
        target: { value: runtime.ids.inProgressStatus },
      });
      getReactProps<{ onChange(event: { target: { value: string } }): void }>(projectSelect).onChange({
        target: { value: runtime.ids.graphRuntimeProject },
      });
      getReactProps<{ onChange(event: { target: { checked: boolean } }): void }>(
        planningLabelCheckbox,
      ).onChange({
        target: { checked: true },
      });
      await Promise.resolve();
    });

    expect(runtime.graph.workspaceIssue.get(runtime.ids.workspaceRoute)).toMatchObject({
      name: "Build the routed workspace surface",
      project: runtime.ids.graphRuntimeProject,
      status: runtime.ids.inProgressStatus,
    });
    expect(runtime.graph.workspaceIssue.get(runtime.ids.workspaceRoute).labels).toContain(
      runtime.ids.planningLabel,
    );
    expect(
      textContent(getByData(container, "data-workspace-entity-item", runtime.ids.workspaceRoute)),
    ).toContain("Build the routed workspace surface");

    unmount();
  });

  it("switches between project and label slices and edits their catalog fields", async () => {
    const runtime = createExampleRuntime();
    const { container, unmount } = render(<WorkspaceManagementScreen runtime={runtime} />);

    const projectsTab = getByData(container, "data-workspace-tab", "projects");
    await act(async () => {
      fireEvent.click(projectsTab);
      await Promise.resolve();
    });
    expect(getByData(container, "data-workspace-object-view", workspaceProjectObjectView.key)).toBeDefined();

    const graphRuntimeProject = getByData(
      container,
      "data-workspace-entity-item",
      runtime.ids.graphRuntimeProject,
    );
    await act(async () => {
      fireEvent.click(graphRuntimeProject);
      await Promise.resolve();
    });

    const projectColorField = getByData(container, "data-workspace-field", "color");
    const projectColorInput = getRequiredElement(
      projectColorField.querySelector<HTMLInputElement>('input[data-web-field-kind="text"]'),
      "Expected project color input.",
    );

    await act(async () => {
      getReactProps<{ onChange(event: { target: { value: string } }): void }>(projectColorInput).onChange({
        target: { value: "#111827" },
      });
      await Promise.resolve();
    });

    expect(runtime.graph.workspaceProject.get(runtime.ids.graphRuntimeProject).color).toBe(
      "#111827",
    );

    const labelsTab = getByData(container, "data-workspace-tab", "labels");
    await act(async () => {
      fireEvent.click(labelsTab);
      await Promise.resolve();
    });
    expect(getByData(container, "data-workspace-object-view", workspaceLabelObjectView.key)).toBeDefined();

    const appLabel = getByData(container, "data-workspace-entity-item", runtime.ids.appLabel);
    await act(async () => {
      fireEvent.click(appLabel);
      await Promise.resolve();
    });

    const labelColorField = getByData(container, "data-workspace-field", "color");
    const labelColorInput = getRequiredElement(
      labelColorField.querySelector<HTMLInputElement>('input[data-web-field-kind="text"]'),
      "Expected label color input.",
    );

    await act(async () => {
      getReactProps<{ onChange(event: { target: { value: string } }): void }>(labelColorInput).onChange({
        target: { value: "#1d4ed8" },
      });
      await Promise.resolve();
    });

    expect(runtime.graph.workspaceLabel.get(runtime.ids.appLabel).color).toBe("#1d4ed8");

    unmount();
  });
});
