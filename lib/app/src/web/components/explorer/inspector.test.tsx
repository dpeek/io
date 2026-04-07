import { describe, expect, it } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { InspectorFieldSection } from "./inspector.js";

describe("inspector field section", () => {
  it("routes injected validation messages by field path and supports one-column layout", () => {
    const html = renderToStaticMarkup(
      <InspectorFieldSection
        chrome={false}
        columns={1}
        mode="edit"
        rows={[
          {
            pathLabel: "name",
            title: "Name",
            value: "Alpha",
          },
          {
            pathLabel: "description",
            title: "Description",
            value: "Body copy",
          },
        ]}
        validationMessagesByPath={
          new Map([
            [
              "description",
              [
                {
                  id: "description:type:required:0",
                  message: "Description is required.",
                  pathLabel: "description",
                  source: "type",
                },
              ],
            ],
          ])
        }
      />,
    );

    expect(html).toContain('data-record-surface-section-columns="1"');
    expect(html).toContain('data-explorer-field-validation="description"');
    expect(html).not.toContain('data-explorer-field-validation="name"');
    expect(html).toContain("Description is required.");
  });
});
