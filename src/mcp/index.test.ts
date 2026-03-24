import { describe, expect, it } from "bun:test";

import { graphBearerTokenEnvVar, parseMcpCliArgs, runMcpCli } from "./index.js";

describe("parseMcpCliArgs", () => {
  it("parses the graph command url and write gate without bearer auth", () => {
    expect(parseMcpCliArgs(["graph", "--allow-writes", "--url", "http://graph.test:1455"])).toEqual(
      {
        kind: "graph",
        options: {
          allowWrites: true,
          bearerToken: undefined,
          url: "http://graph.test:1455/",
        },
      },
    );
  });

  it("treats graph help as top-level help", () => {
    expect(parseMcpCliArgs(["graph", "--help"])).toEqual({ kind: "help" });
  });

  it("rejects unknown commands", () => {
    expect(() => parseMcpCliArgs(["unknown"])).toThrow("Unknown mcp command: unknown");
  });

  it("rejects a missing graph url value", () => {
    expect(() => parseMcpCliArgs(["graph", "--url"])).toThrow(
      "Usage: io mcp graph [--url <url>] [--bearer-token <token>] [--allow-writes]",
    );
  });

  it("rejects a missing bearer token value", () => {
    expect(() => parseMcpCliArgs(["graph", "--bearer-token"])).toThrow(
      "Usage: io mcp graph [--url <url>] [--bearer-token <token>] [--allow-writes]",
    );
  });

  it("falls back to the bearer token environment variable", () => {
    expect(parseMcpCliArgs(["graph"], { [graphBearerTokenEnvVar]: "env-token " })).toEqual({
      kind: "graph",
      options: {
        allowWrites: false,
        bearerToken: "env-token",
        url: "http://io.localhost:1355/",
      },
    });
  });

  it("prefers the explicit bearer token over the environment fallback", () => {
    expect(
      parseMcpCliArgs(["graph", "--bearer-token", "cli-token"], {
        [graphBearerTokenEnvVar]: "env-token",
      }),
    ).toEqual({
      kind: "graph",
      options: {
        allowWrites: false,
        bearerToken: "cli-token",
        url: "http://io.localhost:1355/",
      },
    });
  });

  it("ignores an empty bearer token environment variable", () => {
    expect(parseMcpCliArgs(["graph"], { [graphBearerTokenEnvVar]: "   " })).toEqual({
      kind: "graph",
      options: {
        allowWrites: false,
        bearerToken: undefined,
        url: "http://io.localhost:1355/",
      },
    });
  });

  it("rejects write mode with an explicit bearer token", () => {
    expect(() =>
      parseMcpCliArgs(["graph", "--allow-writes", "--bearer-token", "share-token"]),
    ).toThrow(
      "Bearer-share MCP sessions are read-only. Remove --allow-writes or unset the bearer token.",
    );
  });

  it("rejects write mode with a bearer token from the environment", () => {
    expect(() =>
      parseMcpCliArgs(["graph", "--allow-writes"], {
        [graphBearerTokenEnvVar]: "share-token",
      }),
    ).toThrow(
      "Bearer-share MCP sessions are read-only. Remove --allow-writes or unset the bearer token.",
    );
  });
});

describe("runMcpCli", () => {
  it("dispatches the parsed graph options", async () => {
    let receivedAllowWrites = false;
    let receivedBearerToken: string | undefined;
    let receivedUrl: string | undefined;

    await runMcpCli(["graph", "--allow-writes", "--url", "http://graph.test"], {
      async graph(options) {
        receivedAllowWrites = options.allowWrites ?? false;
        receivedBearerToken = options.bearerToken;
        receivedUrl = options.url;
      },
    });

    expect(receivedAllowWrites).toBe(true);
    expect(receivedBearerToken).toBeUndefined();
    expect(receivedUrl).toBe("http://graph.test/");
  });

  it("fails before dispatch when writes are requested for a bearer-share session", async () => {
    await expect(
      runMcpCli(["graph", "--allow-writes", "--bearer-token", "share-token"]),
    ).rejects.toThrow(
      "Bearer-share MCP sessions are read-only. Remove --allow-writes or unset the bearer token.",
    );
  });
});
