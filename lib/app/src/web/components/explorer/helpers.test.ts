import { describe, expect, it, mock } from "bun:test";

import { edgeId } from "@io/app/graph";
import { workflow } from "@io/graph-module-workflow";

import { postSecretFieldMutation } from "./helpers.js";

const envVarSecretPredicateId = edgeId(workflow.envVar.fields.secret);

describe("explorer helpers", () => {
  it("submits secret-field writes through the canonical command route", async () => {
    const originalFetch = globalThis.fetch;
    let fetchInput: Parameters<typeof globalThis.fetch>[0] | undefined;
    let fetchInit: Parameters<typeof globalThis.fetch>[1] | undefined;

    globalThis.fetch = mock(
      async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
        fetchInput = input;
        fetchInit = init;

        return Response.json({
          created: true,
          entityId: "env:1",
          predicateId: envVarSecretPredicateId,
          rotated: false,
          secretId: "secret:1",
          secretVersion: 1,
        });
      },
    ) as unknown as typeof globalThis.fetch;

    try {
      const result = await postSecretFieldMutation({
        entityId: "env:1",
        plaintext: "sk-live-first",
        predicateId: envVarSecretPredicateId,
      });

      expect(fetchInput).toBe("/api/commands");
      expect(fetchInit).toMatchObject({
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
      });
      expect(JSON.parse(String(fetchInit?.body))).toEqual({
        kind: "write-secret-field",
        input: {
          entityId: "env:1",
          plaintext: "sk-live-first",
          predicateId: envVarSecretPredicateId,
        },
      });
      expect(result).toEqual({
        created: true,
        entityId: "env:1",
        predicateId: envVarSecretPredicateId,
        rotated: false,
        secretId: "secret:1",
        secretVersion: 1,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
