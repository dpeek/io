import { describe, expect, it } from "bun:test";
import { fireEvent, render } from "@testing-library/react";

import { createExampleRuntime } from "../graph/runtime.js";
import { getByData, textContent } from "../test-dom.js";
import { Outliner } from "./outliner.js";

describe("outliner", () => {
  it("keeps root nodes inside the shared parent-reference validation contract", async () => {
    const runtime = createExampleRuntime();
    const { container, unmount } = render(<Outliner runtime={runtime} />);

    expect(textContent(container)).toContain("1 nodes");
    expect(textContent(container)).toContain("Untitled");
    expect(textContent(container)).not.toContain('Validation failed for "parent"');

    const main = getByData(container, "data-outliner-root", "");
    fireEvent.keyDown(main, { key: "Enter" });

    expect(textContent(container)).toContain("2 nodes");
    expect(textContent(container)).not.toContain('Validation failed for "parent"');
    expect(textContent(container)).not.toContain('must reference an existing "Outline Node" entity.');

    unmount();
  });
});
