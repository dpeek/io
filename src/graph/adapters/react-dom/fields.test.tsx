import { describe, expect, it } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { bootstrap, core, createStore, createTypeClient } from "../../index.js";
import { kitchenSink } from "../../schema/test.js";
import { PredicateFieldEditor, PredicateFieldView, defaultWebFieldResolver } from "./resolver.js";

function createRecordFields() {
  const store = createStore();
  bootstrap(store, core);
  bootstrap(store, kitchenSink);
  const graph = createTypeClient(store, kitchenSink);
  const recordId = graph.record.create({
    name: "Kitchen sink fixture",
    headline: "KS-1",
    status: kitchenSink.status.values.draft.id,
    statusHistory: [kitchenSink.status.values.draft.id],
    score: 84,
    completion: 72.5,
    duration: 90_000,
  });
  const recordRef = graph.record.ref(recordId);

  return {
    completion: recordRef.fields.completion,
    duration: recordRef.fields.duration,
  };
}

describe("generic react-dom field coverage", () => {
  it("resolves duration and percent fields through the shared web resolver", () => {
    const fields = createRecordFields();

    const percentView = defaultWebFieldResolver.resolveView(fields.completion);
    const percentEditor = defaultWebFieldResolver.resolveEditor(fields.completion);
    const durationView = defaultWebFieldResolver.resolveView(fields.duration);
    const durationEditor = defaultWebFieldResolver.resolveEditor(fields.duration);

    expect(percentView.status).toBe("resolved");
    expect(percentEditor.status).toBe("resolved");
    expect(durationView.status).toBe("resolved");
    expect(durationEditor.status).toBe("resolved");

    if (percentView.status === "resolved") {
      expect(percentView.capability.kind).toBe("number/percent");
    }
    if (percentEditor.status === "resolved") {
      expect(percentEditor.capability.kind).toBe("number/percent");
    }
    if (durationView.status === "resolved") {
      expect(durationView.capability.kind).toBe("number/duration");
    }
    if (durationEditor.status === "resolved") {
      expect(durationEditor.capability.kind).toBe("number/duration");
    }
  });

  it("renders duration and percent fields with their specialized shared components", () => {
    const fields = createRecordFields();

    const percentViewMarkup = renderToStaticMarkup(
      <PredicateFieldView predicate={fields.completion} />,
    );
    const durationViewMarkup = renderToStaticMarkup(
      <PredicateFieldView predicate={fields.duration} />,
    );
    const percentEditorMarkup = renderToStaticMarkup(
      <PredicateFieldEditor predicate={fields.completion} />,
    );
    const durationEditorMarkup = renderToStaticMarkup(
      <PredicateFieldEditor predicate={fields.duration} />,
    );

    expect(percentViewMarkup).toContain('data-web-field-kind="number/percent"');
    expect(percentViewMarkup).toContain("72.5%");
    expect(durationViewMarkup).toContain('data-web-field-kind="number/duration"');
    expect(durationViewMarkup).toContain("1.5 min");
    expect(percentEditorMarkup).toContain('data-web-field-kind="number/percent"');
    expect(percentEditorMarkup).toContain("%");
    expect(durationEditorMarkup).toContain('data-web-field-kind="number/duration"');
    expect(durationEditorMarkup).toContain('value="1.5"');
  });
});
