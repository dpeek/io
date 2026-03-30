import { describe, expect, it } from "bun:test";

import {
  normalizeSerializedQueryRequest,
  SerializedQueryValidationError,
  serializedQueryVersion,
  validateSerializedQueryRequest,
  validateSerializedQueryResponse,
  type QueryParameterDefinition,
} from "./serialized-query.js";

const parameterDefinitions = [
  {
    name: "branch-id",
    label: "Branch",
    type: "entity-ref",
    required: true,
  },
  {
    name: "states",
    label: "States",
    type: "string-list",
    defaultValue: ["ready"],
  },
] as const satisfies readonly QueryParameterDefinition[];

describe("serialized query request validation", () => {
  it("accepts a collection request with parameterized filters, ordering, and pagination", () => {
    const request = validateSerializedQueryRequest(
      {
        version: serializedQueryVersion,
        params: {
          "branch-id": "branch:workflow-authority",
        },
        query: {
          kind: "collection",
          indexId: "workflow:commit-queue",
          filter: {
            op: "and",
            clauses: [
              {
                op: "eq",
                fieldId: "branchId",
                value: { kind: "param", name: "branch-id" },
              },
              {
                op: "in",
                fieldId: "state",
                values: [{ kind: "literal", value: ["ready", "running"] }],
              },
            ],
          },
          order: [{ fieldId: "updatedAt", direction: "desc" }],
          window: {
            after: "cursor:1",
            limit: 25,
          },
        },
      },
      { parameterDefinitions },
    );

    expect(request).toEqual({
      version: 1,
      params: {
        "branch-id": "branch:workflow-authority",
      },
      query: {
        kind: "collection",
        indexId: "workflow:commit-queue",
        filter: {
          op: "and",
          clauses: [
            {
              op: "eq",
              fieldId: "branchId",
              value: { kind: "param", name: "branch-id" },
            },
            {
              op: "in",
              fieldId: "state",
              values: [{ kind: "literal", value: ["ready", "running"] }],
            },
          ],
        },
        order: [{ fieldId: "updatedAt", direction: "desc" }],
        window: {
          after: "cursor:1",
          limit: 25,
        },
      },
    });
  });

  it("rejects malformed envelopes", () => {
    expect(() =>
      validateSerializedQueryRequest({
        version: 2,
        query: {
          kind: "collection",
          indexId: "workflow:commit-queue",
        },
      }),
    ).toThrowError(
      new SerializedQueryValidationError("Serialized query request.version", "must be 1."),
    );

    expect(() =>
      validateSerializedQueryRequest({
        version: 1,
        query: {
          kind: "unknown",
        },
      }),
    ).toThrowError(
      new SerializedQueryValidationError(
        "Serialized query request.query.kind",
        "must be one of: entity, neighborhood, collection, scope.",
      ),
    );
  });

  it("rejects undeclared, missing, and mistyped params when parameter definitions are supplied", () => {
    expect(() =>
      validateSerializedQueryRequest(
        {
          version: 1,
          params: {
            states: ["ready"],
          },
          query: {
            kind: "collection",
            indexId: "workflow:commit-queue",
            filter: {
              op: "eq",
              fieldId: "branchId",
              value: { kind: "param", name: "branch-id" },
            },
          },
        },
        { parameterDefinitions },
      ),
    ).toThrowError(
      new SerializedQueryValidationError(
        "Serialized query request.params.branch-id",
        "is required but was not provided.",
      ),
    );

    expect(() =>
      validateSerializedQueryRequest(
        {
          version: 1,
          params: {
            extra: "value",
            "branch-id": "branch:workflow-authority",
          },
          query: {
            kind: "collection",
            indexId: "workflow:commit-queue",
          },
        },
        { parameterDefinitions },
      ),
    ).toThrowError(
      new SerializedQueryValidationError(
        "Serialized query request.params.extra",
        "is not declared for this query.",
      ),
    );

    expect(() =>
      validateSerializedQueryRequest(
        {
          version: 1,
          params: {
            "branch-id": ["branch:workflow-authority"],
          },
          query: {
            kind: "collection",
            indexId: "workflow:commit-queue",
          },
        },
        { parameterDefinitions },
      ),
    ).toThrowError(
      new SerializedQueryValidationError(
        "Serialized query request.params.branch-id",
        'must match parameter type "entity-ref".',
      ),
    );
  });

  it("accepts richer string-backed and numeric list parameter families while keeping literal shapes bounded", () => {
    const richerParameterDefinitions = [
      {
        name: "homepage",
        label: "Homepage",
        type: "url",
        required: true,
      },
      {
        name: "cycle-time",
        label: "Cycle time",
        type: "duration",
      },
      {
        name: "completion-bands",
        label: "Completion bands",
        type: "percent-list",
        defaultValue: [25, 50],
      },
      {
        name: "ready-flags",
        label: "Ready flags",
        type: "boolean-list",
        defaultValue: [true],
      },
    ] as const satisfies readonly QueryParameterDefinition[];

    const request = validateSerializedQueryRequest(
      {
        version: 1,
        params: {
          homepage: "https://example.com",
          "cycle-time": "30 min",
          "ready-flags": [true, false],
        },
        query: {
          kind: "collection",
          indexId: "workflow:commit-queue",
          filter: {
            op: "and",
            clauses: [
              {
                op: "eq",
                fieldId: "homepage",
                value: { kind: "param", name: "homepage" },
              },
              {
                op: "gt",
                fieldId: "cycleTime",
                value: { kind: "param", name: "cycle-time" },
              },
              {
                op: "in",
                fieldId: "completionPercent",
                values: [{ kind: "param", name: "completion-bands" }],
              },
            ],
          },
        },
      },
      { parameterDefinitions: richerParameterDefinitions },
    );

    expect(request.params).toEqual({
      homepage: "https://example.com",
      "cycle-time": "30 min",
      "ready-flags": [true, false],
    });

    expect(() =>
      validateSerializedQueryRequest(
        {
          version: 1,
          params: {
            homepage: "https://example.com",
            "completion-bands": ["25", "50"],
          },
          query: {
            kind: "collection",
            indexId: "workflow:commit-queue",
            filter: {
              op: "in",
              fieldId: "completionPercent",
              values: [{ kind: "param", name: "completion-bands" }],
            },
          },
        },
        { parameterDefinitions: richerParameterDefinitions },
      ),
    ).toThrowError(
      new SerializedQueryValidationError(
        "Serialized query request.params.completion-bands",
        'must match parameter type "percent-list".',
      ),
    );
  });

  it("rejects malformed filter clauses", () => {
    expect(() =>
      validateSerializedQueryRequest({
        version: 1,
        query: {
          kind: "collection",
          indexId: "workflow:commit-queue",
          filter: {
            op: "and",
            clauses: [],
          },
        },
      }),
    ).toThrowError(
      new SerializedQueryValidationError(
        "Serialized query request.query.filter.clauses",
        "must be a non-empty array.",
      ),
    );

    expect(() =>
      validateSerializedQueryRequest({
        version: 1,
        query: {
          kind: "collection",
          indexId: "workflow:commit-queue",
          filter: {
            op: "in",
            fieldId: "state",
            values: [],
          },
        },
      }),
    ).toThrowError(
      new SerializedQueryValidationError(
        "Serialized query request.query.filter.values",
        "must be a non-empty array.",
      ),
    );
  });

  it("rejects malformed ordering and pagination inputs", () => {
    expect(() =>
      validateSerializedQueryRequest({
        version: 1,
        query: {
          kind: "collection",
          indexId: "workflow:commit-queue",
          order: [
            { fieldId: "updatedAt", direction: "desc" },
            { fieldId: "updatedAt", direction: "asc" },
          ],
        },
      }),
    ).toThrowError(
      new SerializedQueryValidationError(
        "Serialized query request.query.order[1].fieldId",
        "must not repeat within one query.",
      ),
    );

    expect(() =>
      validateSerializedQueryRequest({
        version: 1,
        query: {
          kind: "collection",
          indexId: "workflow:commit-queue",
          window: {
            limit: 0,
          },
        },
      }),
    ).toThrowError(
      new SerializedQueryValidationError(
        "Serialized query request.query.window.limit",
        "must be greater than 0.",
      ),
    );
  });
});

describe("serialized query normalization", () => {
  it("normalizes equivalent collection queries to one bound internal form and stable hashes", async () => {
    const left = await normalizeSerializedQueryRequest(
      {
        version: 1,
        query: {
          kind: "collection",
          indexId: "workflow:commit-queue",
          filter: {
            op: "and",
            clauses: [
              {
                op: "in",
                fieldId: "state",
                values: [
                  { kind: "param", name: "states" },
                  { kind: "literal", value: ["running", "ready"] },
                ],
              },
              {
                op: "eq",
                fieldId: "branchId",
                value: { kind: "param", name: "branch-id" },
              },
            ],
          },
          window: {
            after: "cursor:1",
            limit: 25,
          },
        },
        params: {
          "branch-id": "branch:workflow-authority",
        },
      },
      {
        executionContext: {
          policyFilterVersion: "policy:v1",
          projectionCursor: "projection:12",
        },
        parameterDefinitions,
      },
    );

    const right = await normalizeSerializedQueryRequest(
      {
        version: 1,
        query: {
          kind: "collection",
          indexId: "workflow:commit-queue",
          filter: {
            op: "and",
            clauses: [
              {
                op: "eq",
                fieldId: "branchId",
                value: { kind: "param", name: "branch-id" },
              },
              {
                op: "in",
                fieldId: "state",
                values: [
                  { kind: "literal", value: ["running", "ready"] },
                  { kind: "param", name: "states" },
                ],
              },
            ],
          },
          window: {
            after: "cursor:9",
            limit: 25,
          },
        },
        params: {
          "branch-id": "branch:workflow-authority",
          states: ["ready"],
        },
      },
      {
        executionContext: {
          policyFilterVersion: "policy:v1",
          projectionCursor: "projection:12",
        },
        parameterDefinitions,
      },
    );

    expect(left.query).toEqual({
      kind: "collection",
      indexId: "workflow:commit-queue",
      filter: {
        op: "and",
        clauses: [
          {
            op: "eq",
            fieldId: "branchId",
            value: "branch:workflow-authority",
          },
          {
            op: "in",
            fieldId: "state",
            values: [["ready"], ["running", "ready"]],
          },
        ],
      },
      window: {
        limit: 25,
      },
    });
    expect(left.params).toEqual([
      {
        name: "branch-id",
        type: "entity-ref",
        value: "branch:workflow-authority",
      },
      {
        name: "states",
        type: "string-list",
        value: ["ready"],
      },
    ]);
    expect(left.query).toEqual(right.query);
    expect(left.params).toEqual(right.params);
    expect(left.metadata.queryHash).toBe(right.metadata.queryHash);
    expect(left.metadata.parameterHash).toBe(right.metadata.parameterHash);
    expect(left.metadata.identityHash).toBe(right.metadata.identityHash);
    expect(left.metadata.requestHash).not.toBe(right.metadata.requestHash);
    expect(left.metadata.pageCursor).toBe("cursor:1");
    expect(right.metadata.pageCursor).toBe("cursor:9");
  });

  it("rejects unresolved referenced params before execution", async () => {
    await expect(
      normalizeSerializedQueryRequest(
        {
          version: 1,
          query: {
            kind: "collection",
            indexId: "workflow:commit-queue",
            filter: {
              op: "eq",
              fieldId: "branchId",
              value: { kind: "param", name: "branch-id" },
            },
          },
        },
        {
          parameterDefinitions: [
            {
              name: "branch-id",
              label: "Branch",
              type: "entity-ref",
            },
          ],
        },
      ),
    ).rejects.toThrowError(
      new SerializedQueryValidationError(
        "Serialized query request.params.branch-id",
        "is referenced by the query but was not provided and has no default.",
      ),
    );
  });

  it("keeps query hashes stable while execution context changes identity hashes", async () => {
    const baseRequest = {
      version: 1,
      query: {
        kind: "scope",
        definition: {
          kind: "module",
          moduleIds: ["workflow", "core"],
          scopeId: "scope:workflow-review",
        },
        window: {
          after: "cursor:7",
          limit: 50,
        },
      },
    } as const;

    const first = await normalizeSerializedQueryRequest(baseRequest, {
      executionContext: {
        policyFilterVersion: "policy:v1",
        scopeDefinitionHash: "scope-def:1",
      },
    });
    const second = await normalizeSerializedQueryRequest(baseRequest, {
      executionContext: {
        policyFilterVersion: "policy:v2",
        scopeDefinitionHash: "scope-def:1",
      },
    });

    expect(first.query).toEqual({
      kind: "scope",
      definition: {
        kind: "module",
        moduleIds: ["core", "workflow"],
        scopeId: "scope:workflow-review",
      },
      window: {
        limit: 50,
      },
    });
    expect(first.metadata.queryHash).toBe(second.metadata.queryHash);
    expect(first.metadata.requestHash).toBe(second.metadata.requestHash);
    expect(first.metadata.executionContextHash).not.toBe(second.metadata.executionContextHash);
    expect(first.metadata.identityHash).not.toBe(second.metadata.identityHash);
    expect(first.metadata.pageCursor).toBe("cursor:7");
  });
});

describe("serialized query response validation", () => {
  it("accepts result pages and explicit error payloads", () => {
    expect(
      validateSerializedQueryResponse({
        ok: true,
        result: {
          kind: "collection",
          items: [
            {
              key: "row:1",
              entityId: "branch:workflow-authority",
              payload: { title: "Workflow authority" },
            },
          ],
          freshness: {
            completeness: "complete",
            freshness: "current",
            projectedAt: "2026-03-24T00:00:00.000Z",
            projectionCursor: "projection:1",
          },
          nextCursor: "cursor:2",
        },
      }),
    ).toEqual({
      ok: true,
      result: {
        kind: "collection",
        items: [
          {
            key: "row:1",
            entityId: "branch:workflow-authority",
            payload: { title: "Workflow authority" },
          },
        ],
        freshness: {
          completeness: "complete",
          freshness: "current",
          projectedAt: "2026-03-24T00:00:00.000Z",
          projectionCursor: "projection:1",
        },
        nextCursor: "cursor:2",
      },
    });

    expect(
      validateSerializedQueryResponse({
        ok: false,
        error: "Projection is stale.",
        code: "projection-stale",
      }),
    ).toEqual({
      ok: false,
      error: "Projection is stale.",
      code: "projection-stale",
    });
  });
});
