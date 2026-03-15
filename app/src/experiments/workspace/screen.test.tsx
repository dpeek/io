import { describe, expect, it } from "bun:test";

import { act, create, type ReactTestInstance } from "react-test-renderer";

import { createExampleRuntime } from "../../graph/runtime.js";
import {
  workspaceIssueObjectView,
  workspaceLabelObjectView,
  workspaceProjectObjectView,
} from "./graph.js";
import { WorkspaceManagementScreen } from "./screen.js";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function findByProp(
  renderer: ReturnType<typeof create>,
  prop: string,
  value: string,
): ReactTestInstance {
  return renderer.root.find((node) => node.props[prop] === value);
}

function collectText(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === "string" ? child : collectText(child)))
    .join(" ");
}

describe("workspace management surface", () => {
  it("browses and edits seeded issue fields through the routed workspace surface", async () => {
    const runtime = createExampleRuntime();

    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(<WorkspaceManagementScreen runtime={runtime} />);
    });

    expect(collectText(renderer!.root)).toContain("IO Planning Workspace");
    expect(
      findByProp(renderer!, "data-workspace-object-view", workspaceIssueObjectView.key),
    ).toBeDefined();

    const routeIssue = findByProp(
      renderer!,
      "data-workspace-entity-item",
      runtime.ids.workspaceRoute,
    );
    await act(async () => {
      routeIssue.props.onClick();
    });

    const nameField = findByProp(renderer!, "data-workspace-field", "name");
    const nameInput = nameField.find(
      (node) => node.type === "input" && node.props["data-web-field-kind"] === "text",
    );
    const statusField = findByProp(renderer!, "data-workspace-field", "status");
    const statusSelect = statusField.find(
      (node) =>
        node.type === "select" && node.props["data-workspace-reference-select"] === "status",
    );
    const projectField = findByProp(renderer!, "data-workspace-field", "project");
    const projectSelect = projectField.find(
      (node) =>
        node.type === "select" && node.props["data-workspace-reference-select"] === "project",
    );
    const labelsField = findByProp(renderer!, "data-workspace-field", "labels");
    const planningLabelOption = labelsField.find(
      (node) =>
        node.type === "label" &&
        node.props["data-web-reference-option-id"] === runtime.ids.planningLabel,
    );
    const planningLabelCheckbox = planningLabelOption.findByType("input");

    await act(async () => {
      nameInput.props.onChange({ target: { value: "Build the routed workspace surface" } });
      statusSelect.props.onChange({ target: { value: runtime.ids.inProgressStatus } });
      projectSelect.props.onChange({ target: { value: runtime.ids.graphRuntimeProject } });
      planningLabelCheckbox.props.onChange({ target: { checked: true } });
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
      collectText(findByProp(renderer!, "data-workspace-entity-item", runtime.ids.workspaceRoute)),
    ).toContain("Build the routed workspace surface");

    act(() => {
      renderer?.unmount();
    });
  });

  it("switches between project and label slices and edits their catalog fields", async () => {
    const runtime = createExampleRuntime();

    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(<WorkspaceManagementScreen runtime={runtime} />);
    });

    const projectsTab = findByProp(renderer!, "data-workspace-tab", "projects");
    await act(async () => {
      projectsTab.props.onClick();
    });
    expect(
      findByProp(renderer!, "data-workspace-object-view", workspaceProjectObjectView.key),
    ).toBeDefined();

    const graphRuntimeProject = findByProp(
      renderer!,
      "data-workspace-entity-item",
      runtime.ids.graphRuntimeProject,
    );
    await act(async () => {
      graphRuntimeProject.props.onClick();
    });

    const projectColorField = findByProp(renderer!, "data-workspace-field", "color");
    const projectColorInput = projectColorField.find(
      (node) => node.type === "input" && node.props["data-web-field-kind"] === "text",
    );

    await act(async () => {
      projectColorInput.props.onChange({ target: { value: "#111827" } });
    });

    expect(runtime.graph.workspaceProject.get(runtime.ids.graphRuntimeProject).color).toBe(
      "#111827",
    );

    const labelsTab = findByProp(renderer!, "data-workspace-tab", "labels");
    await act(async () => {
      labelsTab.props.onClick();
    });
    expect(
      findByProp(renderer!, "data-workspace-object-view", workspaceLabelObjectView.key),
    ).toBeDefined();

    const appLabel = findByProp(renderer!, "data-workspace-entity-item", runtime.ids.appLabel);
    await act(async () => {
      appLabel.props.onClick();
    });

    const labelColorField = findByProp(renderer!, "data-workspace-field", "color");
    const labelColorInput = labelColorField.find(
      (node) => node.type === "input" && node.props["data-web-field-kind"] === "text",
    );

    await act(async () => {
      labelColorInput.props.onChange({ target: { value: "#1d4ed8" } });
    });

    expect(runtime.graph.workspaceLabel.get(runtime.ids.appLabel).color).toBe("#1d4ed8");

    act(() => {
      renderer?.unmount();
    });
  });
});
