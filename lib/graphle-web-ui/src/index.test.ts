import { describe, expect, it } from "bun:test";

import { Button, cn, MarkdownRenderer } from "@dpeek/graphle-web-ui";

describe("web ui root export", () => {
  it("re-exports browser primitives used by shell packages", () => {
    expect(typeof Button).toBe("function");
    expect(typeof MarkdownRenderer).toBe("function");
    expect(cn("a", false, "b")).toBe("a b");
  });
});
