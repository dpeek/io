import { describe, expect, it } from "bun:test";

import type { CollectionSurfaceSpec, ObjectViewSpec, RecordSurfaceSpec } from "@io/graph-module";

import { adaptObjectViewToRecordSurface, resolveRecordSurfaceBinding } from "./record-surface.js";

describe("record surface binding", () => {
  it("reads title, subtitle, sections, and related collection specs", async () => {
    const record = {
      commandSurfaces: ["record:open"],
      key: "record:task",
      related: [
        {
          collection: "collection:children",
          description: "Child records stay grouped here.",
          key: "children",
          title: "Children",
        },
      ],
      sections: [
        {
          fields: [
            {
              description: "Stable durable identifier.",
              path: "id",
            },
            {
              label: "Status",
              path: "status",
            },
          ],
          key: "details",
          title: "Details",
        },
      ],
      subtitleField: "status",
      subject: "task",
      titleField: "name",
    } as const satisfies RecordSurfaceSpec;

    const relatedCollection = {
      description: "Related tasks for the current record.",
      key: "collection:children",
      presentation: {
        kind: "table",
      },
      source: {
        kind: "query",
        query: "saved-query:children",
      },
      title: "Child tasks",
    } as const satisfies CollectionSurfaceSpec;

    const result = await resolveRecordSurfaceBinding({
      lookup: {
        getCollectionSurface: (key) =>
          key === relatedCollection.key ? relatedCollection : undefined,
        getFieldValue: (path) =>
          ({
            id: "task:42",
            name: "Runtime extraction",
            status: "active",
          })[path],
      },
      surface: record,
    });

    expect(result).toMatchObject({
      binding: {
        commandSurfaces: ["record:open"],
        related: [
          {
            collection: relatedCollection,
            description: "Child records stay grouped here.",
            key: "children",
            title: "Children",
          },
        ],
        sections: [
          {
            fields: [
              {
                description: "Stable durable identifier.",
                label: "id",
                path: "id",
                value: "task:42",
              },
              {
                label: "Status",
                path: "status",
                value: "active",
              },
            ],
            key: "details",
            title: "Details",
          },
        ],
        subtitle: "active",
        title: "Runtime extraction",
      },
      ok: true,
    });
  });

  it("reports missing related collection specs clearly", async () => {
    const result = await resolveRecordSurfaceBinding({
      lookup: {
        getCollectionSurface: () => undefined,
        getFieldValue: () => "value",
      },
      surface: {
        key: "record:task",
        related: [
          {
            collection: "collection:missing",
            key: "missing",
            title: "Missing",
          },
        ],
        sections: [],
        subject: "task",
      } satisfies RecordSurfaceSpec,
    });

    expect(result).toEqual({
      issue: {
        code: "related-collection-missing",
        message:
          'Record surface "record:task" references missing related collection surface "collection:missing".',
      },
      ok: false,
    });
  });
});

describe("object-view compatibility adapter", () => {
  it("maps legacy object-view contracts into record-surface specs", () => {
    const objectView = {
      commands: ["record:open"],
      entity: "task",
      key: "view:task",
      related: [
        {
          key: "children",
          presentation: "table",
          relationPath: "children",
          title: "Children",
        },
      ],
      sections: [
        {
          fields: [{ path: "name" }],
          key: "overview",
          title: "Overview",
        },
      ],
      subtitleField: "status",
      titleField: "name",
    } as const satisfies ObjectViewSpec;

    expect(
      adaptObjectViewToRecordSurface(objectView, {
        mapRelatedCollectionKey: (related) =>
          related.relationPath === "children" ? "collection:children" : undefined,
      }),
    ).toEqual({
      commandSurfaces: ["record:open"],
      key: "view:task",
      related: [
        {
          collection: "collection:children",
          key: "children",
          title: "Children",
        },
      ],
      sections: [
        {
          fields: [{ path: "name" }],
          key: "overview",
          title: "Overview",
        },
      ],
      subtitleField: "status",
      subject: "task",
      titleField: "name",
    });
  });
});
