import { describe, expect, it } from "bun:test";

import { runGraphleCli } from "./index.js";

describe("graphle public cli", () => {
  it("dispatches the dev command to graphle-local", async () => {
    const calls: string[][] = [];

    await runGraphleCli(["dev", "--no-open", "--port", "0"], {
      runDev(args) {
        calls.push(args);
        return Promise.resolve(undefined);
      },
    });

    expect(calls).toEqual([["--no-open", "--port", "0"]]);
  });

  it("prints help for empty args", async () => {
    const logs: string[] = [];

    await runGraphleCli([], {
      stdout: {
        log(message) {
          logs.push(message);
        },
      },
    });

    expect(logs[0]).toContain("graphle <command>");
  });
});
