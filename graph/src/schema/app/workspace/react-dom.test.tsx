import { describe, expect, it } from "bun:test";

import { act, create, type ReactTestInstance } from "react-test-renderer";

import { createExampleRuntime } from "../../../../../app/src/graph/runtime.js";
import { WorkspaceManagementSurface } from "../../../react-dom/index.js";
import { workspaceManagementWorkflow } from "./index.js";

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

describe("workspace react-dom surface", () => {
  it("renders the promoted workspace workflow surface from the graph adapter export", async () => {
    const runtime = createExampleRuntime();

    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(<WorkspaceManagementSurface runtime={runtime} />);
    });

    expect(findByProp(renderer!, "data-workspace-workflow", workspaceManagementWorkflow.key)).toBeDefined();
    expect(collectText(renderer!.root)).toContain("IO Planning Workspace");

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

    await act(async () => {
      nameInput.props.onChange({ target: { value: "Promoted workspace management surface" } });
    });

    expect(runtime.graph.workspaceIssue.get(runtime.ids.workspaceRoute).name).toBe(
      "Promoted workspace management surface",
    );

    act(() => {
      renderer?.unmount();
    });
  });
});
