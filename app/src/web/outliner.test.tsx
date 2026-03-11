import { describe, expect, it } from "bun:test";
import { act, create, type ReactTestInstance } from "react-test-renderer";

import { Outliner } from "./outliner.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function collectText(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === "string" ? child : collectText(child)))
    .join(" ");
}

describe("outliner", () => {
  it("keeps root nodes inside the shared parent-reference validation contract", async () => {
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(<Outliner />);
    });

    expect(collectText(renderer!.root)).toContain("1 nodes");
    expect(collectText(renderer!.root)).toContain("Untitled");
    expect(collectText(renderer!.root)).not.toContain('Validation failed for "parent"');

    const main = renderer!.root.findByType("main");
    await act(async () => {
      main.props.onKeyDownCapture({
        altKey: false,
        ctrlKey: false,
        key: "Enter",
        metaKey: false,
        preventDefault() {},
        shiftKey: false,
      });
    });

    expect(collectText(renderer!.root)).toContain("2 nodes");
    expect(collectText(renderer!.root)).not.toContain('Validation failed for "parent"');
    expect(collectText(renderer!.root)).not.toContain(
      'must reference an existing "Outline Node" entity.',
    );

    act(() => {
      renderer?.unmount();
    });
  });
});
