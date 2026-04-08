import { describe, expect, it } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { InspectorFieldSection } from "../inspector.js";

describe("inspector field section", () => {
  it("routes injected validation messages by field path in the shared field layout", () => {
    const html = renderToStaticMarkup(
      <InspectorFieldSection
        chrome={false}
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

    expect(html).toContain('data-explorer-field-validation="description"');
    expect(html).not.toContain('data-explorer-field-validation="name"');
    expect(html).toContain("Description is required.");
  });
});
