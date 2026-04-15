import { describe, expect, it } from "bun:test";

import { resolveBrowserOpenCommand } from "./browser.js";

describe("browser opening", () => {
  it("selects platform-specific browser commands", () => {
    expect(resolveBrowserOpenCommand("http://127.0.0.1:4318", "darwin")).toEqual({
      command: "open",
      args: ["http://127.0.0.1:4318"],
    });
    expect(resolveBrowserOpenCommand("http://127.0.0.1:4318", "win32")).toEqual({
      command: "cmd",
      args: ["/c", "start", "", "http://127.0.0.1:4318"],
    });
    expect(resolveBrowserOpenCommand("http://127.0.0.1:4318", "linux")).toEqual({
      command: "xdg-open",
      args: ["http://127.0.0.1:4318"],
    });
  });
});
