import { describe, expect, it } from "bun:test";

import { createGraphId } from "./id.js";

const uuidV7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("graph ids", () => {
  it("emits UUIDv7 identifiers", () => {
    expect(createGraphId()).toMatch(uuidV7Pattern);
  });

  it("is lexicographically monotonic within one process", () => {
    const ids = Array.from({ length: 128 }, () => createGraphId());

    expect([...ids].sort()).toEqual(ids);
  });

  it("does not collide across a reasonable sample", () => {
    const ids = Array.from({ length: 2048 }, () => createGraphId());

    expect(new Set(ids).size).toBe(ids.length);
  });
});
