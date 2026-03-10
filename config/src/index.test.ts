import { expect, test } from "bun:test";

import config from "./index.js";

test("@io/config re-exports the repo root config", () => {
  expect(config.install?.brews).toContain("ripgrep");
});
