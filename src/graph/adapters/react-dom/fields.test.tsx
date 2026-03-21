import { describe, expect, it } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { bootstrap, createStore, createTypeClient } from "../../index.js";
import { core, defaultMoneyCurrencyKey } from "../../modules/index.js";
import { kitchenSink } from "../../testing/kitchen-sink.js";
import { PredicateFieldEditor, PredicateFieldView, defaultWebFieldResolver } from "./resolver.js";

function createRecordFields() {
  const store = createStore();
  bootstrap(store, core);
  bootstrap(store, kitchenSink);
  const graph = createTypeClient(store, { ...core, ...kitchenSink });
  const platformTagId = graph.tag.create({
    color: "#2563eb",
    key: "platform",
    name: "Platform",
  });
  const recordId = graph.record.create({
    name: "Kitchen sink fixture",
    headline: "KS-1",
    status: kitchenSink.status.values.draft.id,
    statusHistory: [kitchenSink.status.values.draft.id],
    score: 84,
    completion: 72.5,
    estimate: 1_800_000,
    quantity: { amount: 12.5, unit: "kg" },
    budget: { amount: 1250, currency: defaultMoneyCurrencyKey },
    burnRate: {
      numerator: {
        kind: "money",
        value: { amount: 1250, currency: defaultMoneyCurrencyKey },
      },
      denominator: {
        kind: "duration",
        value: 86_400_000,
      },
    },
    completionBand: {
      kind: "percent",
      min: 10,
      max: 80,
    },
    quantityBand: {
      kind: "quantity",
      min: { amount: 10, unit: "kg" },
      max: { amount: 25, unit: "kg" },
    },
    tags: [platformTagId],
    budgetBand: {
      kind: "money",
      min: { amount: 1500, currency: defaultMoneyCurrencyKey },
      max: { amount: 3000, currency: defaultMoneyCurrencyKey },
    },
    details: "# Kitchen sink\n\nThis is **markdown**.",
  });
  const recordRef = graph.record.ref(recordId);
  const iconId = graph.icon.create({
    key: "kitchen-sink",
    name: "Kitchen Sink",
    svg: '<svg viewBox="0 0 24 24"><path d="M4 12h16" /></svg>',
  });
  const iconRef = graph.icon.ref(iconId);

  return {
    budget: recordRef.fields.budget,
    budgetBand: recordRef.fields.budgetBand,
    burnRate: recordRef.fields.burnRate,
    completion: recordRef.fields.completion,
    completionBand: recordRef.fields.completionBand,
    details: recordRef.fields.details,
    estimate: recordRef.fields.estimate,
    iconSvg: iconRef.fields.svg,
    quantity: recordRef.fields.quantity,
    tags: recordRef.fields.tags,
    tagId: platformTagId,
  };
}

describe("generic react-dom field coverage", () => {
  it("resolves structured value fields through the shared web resolver", () => {
    const fields = createRecordFields();

    const moneyView = defaultWebFieldResolver.resolveView(fields.budget);
    const moneyEditor = defaultWebFieldResolver.resolveEditor(fields.budget);
    const percentView = defaultWebFieldResolver.resolveView(fields.completion);
    const percentEditor = defaultWebFieldResolver.resolveEditor(fields.completion);
    const estimateView = defaultWebFieldResolver.resolveView(fields.estimate);
    const estimateEditor = defaultWebFieldResolver.resolveEditor(fields.estimate);
    const quantityView = defaultWebFieldResolver.resolveView(fields.quantity);
    const quantityEditor = defaultWebFieldResolver.resolveEditor(fields.quantity);
    const rateView = defaultWebFieldResolver.resolveView(fields.burnRate);
    const rateEditor = defaultWebFieldResolver.resolveEditor(fields.burnRate);
    const percentRangeView = defaultWebFieldResolver.resolveView(fields.completionBand);
    const percentRangeEditor = defaultWebFieldResolver.resolveEditor(fields.completionBand);
    const budgetRangeView = defaultWebFieldResolver.resolveView(fields.budgetBand);
    const budgetRangeEditor = defaultWebFieldResolver.resolveEditor(fields.budgetBand);
    const markdownView = defaultWebFieldResolver.resolveView(fields.details);
    const markdownEditor = defaultWebFieldResolver.resolveEditor(fields.details);
    const svgView = defaultWebFieldResolver.resolveView(fields.iconSvg);
    const svgEditor = defaultWebFieldResolver.resolveEditor(fields.iconSvg);
    const tagsView = defaultWebFieldResolver.resolveView(fields.tags);
    const tagsEditor = defaultWebFieldResolver.resolveEditor(fields.tags);

    expect(moneyView.status).toBe("resolved");
    expect(moneyEditor.status).toBe("resolved");
    expect(percentView.status).toBe("resolved");
    expect(percentEditor.status).toBe("resolved");
    expect(estimateView.status).toBe("resolved");
    expect(estimateEditor.status).toBe("resolved");
    expect(quantityView.status).toBe("resolved");
    expect(quantityEditor.status).toBe("resolved");
    expect(rateView.status).toBe("resolved");
    expect(rateEditor.status).toBe("resolved");
    expect(percentRangeView.status).toBe("resolved");
    expect(percentRangeEditor.status).toBe("resolved");
    expect(budgetRangeView.status).toBe("resolved");
    expect(budgetRangeEditor.status).toBe("resolved");
    expect(markdownView.status).toBe("resolved");
    expect(markdownEditor.status).toBe("resolved");
    expect(svgView.status).toBe("resolved");
    expect(svgEditor.status).toBe("resolved");
    expect(tagsView.status).toBe("resolved");
    expect(tagsEditor.status).toBe("resolved");

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
    if (estimateView.status === "resolved") {
      expect(estimateView.capability.kind).toBe("number/duration");
    }
    if (estimateEditor.status === "resolved") {
      expect(estimateEditor.capability.kind).toBe("number/duration");
    }
    if (quantityView.status === "resolved") {
      expect(quantityView.capability.kind).toBe("number/quantity");
    }
    if (quantityEditor.status === "resolved") {
      expect(quantityEditor.capability.kind).toBe("number/quantity");
    }
    if (rateView.status === "resolved") {
      expect(rateView.capability.kind).toBe("number/rate");
    }
    if (rateEditor.status === "resolved") {
      expect(rateEditor.capability.kind).toBe("number/rate");
    }
    if (percentRangeView.status === "resolved") {
      expect(percentRangeView.capability.kind).toBe("number/range");
    }
    if (percentRangeEditor.status === "resolved") {
      expect(percentRangeEditor.capability.kind).toBe("number/range");
    }
    if (budgetRangeView.status === "resolved") {
      expect(budgetRangeView.capability.kind).toBe("number/range");
    }
    if (budgetRangeEditor.status === "resolved") {
      expect(budgetRangeEditor.capability.kind).toBe("number/range");
    }
    if (markdownView.status === "resolved") {
      expect(markdownView.capability.kind).toBe("markdown");
    }
    if (markdownEditor.status === "resolved") {
      expect(markdownEditor.capability.kind).toBe("markdown");
    }
    if (svgView.status === "resolved") {
      expect(svgView.capability.kind).toBe("svg");
    }
    if (svgEditor.status === "resolved") {
      expect(svgEditor.capability.kind).toBe("svg");
    }
    if (tagsView.status === "resolved") {
      expect(tagsView.capability.kind).toBe("entity-reference-list");
    }
    if (tagsEditor.status === "resolved") {
      expect(tagsEditor.capability.kind).toBe("entity-reference-combobox");
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
    const estimateViewMarkup = renderToStaticMarkup(
      <PredicateFieldView predicate={fields.estimate} />,
    );
    const percentEditorMarkup = renderToStaticMarkup(
      <PredicateFieldEditor predicate={fields.completion} />,
    );
    const estimateEditorMarkup = renderToStaticMarkup(
      <PredicateFieldEditor predicate={fields.estimate} />,
    );
    const quantityViewMarkup = renderToStaticMarkup(
      <PredicateFieldView predicate={fields.quantity} />,
    );
    const quantityEditorMarkup = renderToStaticMarkup(
      <PredicateFieldEditor predicate={fields.quantity} />,
    );
    const rateViewMarkup = renderToStaticMarkup(<PredicateFieldView predicate={fields.burnRate} />);
    const rateEditorMarkup = renderToStaticMarkup(
      <PredicateFieldEditor predicate={fields.burnRate} />,
    );
    const percentRangeViewMarkup = renderToStaticMarkup(
      <PredicateFieldView predicate={fields.completionBand} />,
    );
    const percentRangeEditorMarkup = renderToStaticMarkup(
      <PredicateFieldEditor predicate={fields.completionBand} />,
    );
    const budgetRangeViewMarkup = renderToStaticMarkup(
      <PredicateFieldView predicate={fields.budgetBand} />,
    );
    const budgetRangeEditorMarkup = renderToStaticMarkup(
      <PredicateFieldEditor predicate={fields.budgetBand} />,
    );
    const markdownViewMarkup = renderToStaticMarkup(
      <PredicateFieldView predicate={fields.details} />,
    );
    const markdownEditorMarkup = renderToStaticMarkup(
      <PredicateFieldEditor predicate={fields.details} />,
    );
    const svgViewMarkup = renderToStaticMarkup(<PredicateFieldView predicate={fields.iconSvg} />);
    const svgEditorMarkup = renderToStaticMarkup(
      <PredicateFieldEditor predicate={fields.iconSvg} />,
    );
    const tagsViewMarkup = renderToStaticMarkup(<PredicateFieldView predicate={fields.tags} />);
    const tagsEditorMarkup = renderToStaticMarkup(<PredicateFieldEditor predicate={fields.tags} />);

    expect(moneyViewMarkup).toContain('data-web-field-kind="money/amount"');
    expect(moneyViewMarkup).toContain("1250 USD");
    expect(moneyEditorMarkup).toContain('data-web-field-kind="money/amount"');
    expect(moneyEditorMarkup).toContain('value="1250"');
    expect(percentViewMarkup).toContain('data-web-field-kind="number/percent"');
    expect(percentViewMarkup).toContain("72.5%");
    expect(estimateViewMarkup).toContain('data-web-field-kind="number/duration"');
    expect(estimateViewMarkup).toContain("30 min");
    expect(quantityViewMarkup).toContain('data-web-field-kind="number/quantity"');
    expect(quantityViewMarkup).toContain("12.5 kg");
    expect(rateViewMarkup).toContain('data-web-field-kind="number/rate"');
    expect(rateViewMarkup).toContain("1250 USD / 1 day");
    expect(percentRangeViewMarkup).toContain('data-web-field-kind="number/range"');
    expect(percentRangeViewMarkup).toContain("10% .. 80%");
    expect(budgetRangeViewMarkup).toContain('data-web-field-kind="number/range"');
    expect(budgetRangeViewMarkup).toContain("1500 USD .. 3000 USD");
    expect(percentEditorMarkup).toContain('data-web-field-kind="number/percent"');
    expect(percentEditorMarkup).toContain("%");
    expect(estimateEditorMarkup).toContain('data-web-field-kind="number/duration"');
    expect(estimateEditorMarkup).toContain('value="30"');
    expect(quantityEditorMarkup).toContain('data-web-field-kind="number/quantity"');
    expect(quantityEditorMarkup).toContain('value="12.5"');
    expect(quantityEditorMarkup).toContain('value="kg"');
    expect(rateEditorMarkup).toContain('data-web-field-kind="number/rate"');
    expect(rateEditorMarkup).toContain("per");
    expect(rateEditorMarkup).toContain('value="1250"');
    expect(percentRangeEditorMarkup).toContain('data-web-field-kind="number/range"');
    expect(percentRangeEditorMarkup).toContain('value="10"');
    expect(budgetRangeEditorMarkup).toContain('data-web-field-kind="number/range"');
    expect(budgetRangeEditorMarkup).toContain('value="1500"');
    expect(budgetRangeEditorMarkup).toContain('value="3000"');
    expect(markdownViewMarkup).toContain('data-web-field-kind="markdown"');
    expect(markdownViewMarkup).toContain("<strong>markdown</strong>");
    expect(markdownEditorMarkup).toContain('data-web-field-kind="markdown"');
    expect(markdownEditorMarkup).toContain('data-web-markdown-source="textarea"');
    expect(svgViewMarkup).toContain('data-web-field-kind="svg"');
    expect(svgViewMarkup).toContain('data-web-svg-preview="ready"');
    expect(svgEditorMarkup).toContain('data-web-field-kind="svg"');
    expect(svgEditorMarkup).toContain('data-web-svg-preview="ready"');
    expect(tagsViewMarkup).toContain('data-web-field-kind="entity-reference-list"');
    expect(tagsViewMarkup).toContain(`data-web-reference-id="${fields.tagId}"`);
    expect(tagsViewMarkup).toContain("Platform");
    expect(tagsViewMarkup).toContain(`<code>${fields.tagId}</code>`);
    expect(tagsEditorMarkup).toContain('data-web-field-kind="entity-reference-combobox"');
    expect(tagsEditorMarkup).toContain(`data-web-reference-selected-id="${fields.tagId}"`);
    expect(tagsEditorMarkup).toContain("Platform");
  });
});
