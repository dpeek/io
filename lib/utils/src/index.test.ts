import { describe, expect, it } from "bun:test";

describe("@io/utils", () => {
  it("exports the generic env, log, and process helpers", async () => {
    const utils = await import("@io/utils");

    expect(typeof utils.createLogger).toBe("function");
    expect(typeof utils.env).toBe("function");
    expect(typeof utils.getEnvOrThrow).toBe("function");
    expect(typeof utils.handleExit).toBe("function");
  });
});
