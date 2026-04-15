import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import {
  createGraphleInitUrl,
  formatGraphleDevUrl,
  parseGraphleDevCliArgs,
  runGraphleDev,
  type GraphleServe,
} from "./cli.js";

describe("graphle dev cli", () => {
  it("parses host, port, and no-open options", () => {
    expect(parseGraphleDevCliArgs(["--host", "localhost", "--port", "8090", "--no-open"])).toEqual({
      help: false,
      host: "localhost",
      port: 8090,
      open: false,
    });
  });

  it("formats base and init URLs", () => {
    expect(formatGraphleDevUrl("127.0.0.1", 4318)).toBe("http://127.0.0.1:4318");
    expect(createGraphleInitUrl("http://127.0.0.1:4318", "token value")).toBe(
      "http://127.0.0.1:4318/api/init?token=token+value",
    );
  });

  it("starts with injected server and browser helpers", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "graphle-local-cli-"));
    const opened: string[] = [];
    const logs: string[] = [];
    const serve: GraphleServe = ({ hostname, port, fetch }) => {
      expect(hostname).toBe("127.0.0.1");
      expect(port).toBe(0);
      expect(typeof fetch).toBe("function");
      return {
        port: 5123,
        stop() {},
      };
    };

    try {
      const runtime = await runGraphleDev(["--port", "0"], {
        cwd,
        now: () => new Date("2026-04-15T00:00:00.000Z"),
        openBrowser: (url) => {
          opened.push(url);
        },
        serve,
        stdout: {
          log(message) {
            logs.push(message);
          },
          error(message) {
            logs.push(message);
          },
        },
      });

      expect(runtime?.url).toBe("http://127.0.0.1:5123");
      expect(opened).toEqual([runtime?.initUrl]);
      expect(logs.some((line) => line === "graphle dev listening on http://127.0.0.1:5123")).toBe(
        true,
      );
      runtime?.close();
    } finally {
      await rm(cwd, { force: true, recursive: true });
    }
  });
});
