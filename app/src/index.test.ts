import { expect, test } from "bun:test";

import * as appExports from "./index.js";

test("@io/app exports only the app-owned proof surface", () => {
  expect(Object.keys(appExports).sort()).toEqual([
    "app",
    "block",
    "company",
    "createExampleRuntime",
    "person",
    "status",
  ]);
});
