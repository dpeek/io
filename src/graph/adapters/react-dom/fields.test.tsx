import { describe, expect, it } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import {
  bootstrap,
  core,
  createStore,
  createTypeClient,
  defaultMoneyCurrencyKey,
} from "../../index.js";
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
    quantity: { amount: 12.5, unit: "kg" },
    budget: { amount: 1250, currency: defaultMoneyCurrencyKey },
  });
  const recordRef = graph.record.ref(recordId);

  return {
    budget: recordRef.fields.budget,
    completion: recordRef.fields.completion,
    duration: recordRef.fields.duration,
    quantity: recordRef.fields.quantity,
  };
}

describe("generic react-dom field coverage", () => {
  it("resolves structured value fields through the shared web resolver", () => {
    const fields = createRecordFields();

    const moneyView = defaultWebFieldResolver.resolveView(fields.budget);
    const moneyEditor = defaultWebFieldResolver.resolveEditor(fields.budget);
    const percentView = defaultWebFieldResolver.resolveView(fields.completion);
    const percentEditor = defaultWebFieldResolver.resolveEditor(fields.completion);
    const durationView = defaultWebFieldResolver.resolveView(fields.duration);
    const durationEditor = defaultWebFieldResolver.resolveEditor(fields.duration);
    const quantityView = defaultWebFieldResolver.resolveView(fields.quantity);
    const quantityEditor = defaultWebFieldResolver.resolveEditor(fields.quantity);

    expect(moneyView.status).toBe("resolved");
    expect(moneyEditor.status).toBe("resolved");
    expect(percentView.status).toBe("resolved");
    expect(percentEditor.status).toBe("resolved");
    expect(durationView.status).toBe("resolved");
    expect(durationEditor.status).toBe("resolved");
    expect(quantityView.status).toBe("resolved");
    expect(quantityEditor.status).toBe("resolved");

    if (moneyView.status === "resolved") {
      expect(moneyView.capability.kind).toBe("money/amount");
    }
    if (moneyEditor.status === "resolved") {
      expect(moneyEditor.capability.kind).toBe("money/amount");
    }
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
    if (quantityView.status === "resolved") {
      expect(quantityView.capability.kind).toBe("number/quantity");
    }
    if (quantityEditor.status === "resolved") {
      expect(quantityEditor.capability.kind).toBe("number/quantity");
    }
  });

  it("renders structured value fields with their specialized shared components", () => {
    const fields = createRecordFields();

    const moneyViewMarkup = renderToStaticMarkup(<PredicateFieldView predicate={fields.budget} />);
    const moneyEditorMarkup = renderToStaticMarkup(
      <PredicateFieldEditor predicate={fields.budget} />,
    );
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
    const quantityViewMarkup = renderToStaticMarkup(
      <PredicateFieldView predicate={fields.quantity} />,
    );
    const quantityEditorMarkup = renderToStaticMarkup(
      <PredicateFieldEditor predicate={fields.quantity} />,
    );

    expect(moneyViewMarkup).toContain('data-web-field-kind="money/amount"');
    expect(moneyViewMarkup).toContain("1250 USD");
    expect(moneyEditorMarkup).toContain('data-web-field-kind="money/amount"');
    expect(moneyEditorMarkup).toContain('value="1250"');
    expect(percentViewMarkup).toContain('data-web-field-kind="number/percent"');
    expect(percentViewMarkup).toContain("72.5%");
    expect(durationViewMarkup).toContain('data-web-field-kind="number/duration"');
    expect(durationViewMarkup).toContain("1.5 min");
    expect(quantityViewMarkup).toContain('data-web-field-kind="number/quantity"');
    expect(quantityViewMarkup).toContain("12.5 kg");
    expect(percentEditorMarkup).toContain('data-web-field-kind="number/percent"');
    expect(percentEditorMarkup).toContain("%");
    expect(durationEditorMarkup).toContain('data-web-field-kind="number/duration"');
    expect(durationEditorMarkup).toContain('value="1.5"');
    expect(quantityEditorMarkup).toContain('data-web-field-kind="number/quantity"');
    expect(quantityEditorMarkup).toContain('value="12.5"');
    expect(quantityEditorMarkup).toContain('value="kg"');
  });
});
