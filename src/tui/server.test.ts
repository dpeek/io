import { expect, test } from "bun:test";

import { parseWorkflowTuiCliArgs } from "./server.js";

test("parseWorkflowTuiCliArgs accepts the default bootstrap command shape", () => {
  expect(parseWorkflowTuiCliArgs([])).toEqual({
    help: false,
    workflowPath: undefined,
  });
  expect(parseWorkflowTuiCliArgs(["./io.ts"])).toEqual({
    help: false,
    workflowPath: "./io.ts",
  });
});

test("parseWorkflowTuiCliArgs accepts help flags", () => {
  expect(parseWorkflowTuiCliArgs(["--help"])).toEqual({
    help: true,
    workflowPath: undefined,
  });
  expect(parseWorkflowTuiCliArgs(["-h"])).toEqual({
    help: true,
    workflowPath: undefined,
  });
});

test("parseWorkflowTuiCliArgs rejects unexpected extra arguments or flags", () => {
  expect(() => parseWorkflowTuiCliArgs(["./io.ts", "./io.md"])).toThrow(
    "Usage: io tui [entrypointPath]",
  );
  expect(() => parseWorkflowTuiCliArgs(["--once"])).toThrow("Unknown option: --once");
});
