import { describe, expect, it } from "bun:test";

import { bootstrap } from "@io/graph-bootstrap";
import { createGraphClient } from "@io/graph-client";
import { createGraphStore as createStore } from "@io/graph-kernel";
import { core, coreGraphBootstrapOptions, defaultMoneyCurrencyKey } from "@io/graph-module-core";
import {
  PredicateFieldEditor,
  PredicateFieldView,
  defaultWebFieldResolver,
} from "@io/graph-module-core/react-dom";
import { renderToStaticMarkup } from "react-dom/server";

import { kitchenSink } from "../fixtures/kitchen-sink.js";

function createRecordFields() {
  const store = createStore();
  bootstrap(store, core, coreGraphBootstrapOptions);
  bootstrap(store, kitchenSink, coreGraphBootstrapOptions);
  const graph = createGraphClient(store, { ...core, ...kitchenSink });
  const platformTagId = graph.tag.create({
    color: "#2563eb",
    key: "platform",
    name: "Platform",
  });
  const recordId = graph.record.create({
    accentColor: "#2563eb",
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
    accentColor: recordRef.fields.accentColor,
    completion: recordRef.fields.completion,
    details: recordRef.fields.details,
    headline: recordRef.fields.headline,
    iconSvg: iconRef.fields.svg,
  };
}

describe("@io/graph-module-core/react-dom generic field registry coverage", () => {
  it("resolves shared browser fields through the canonical module-core resolver", () => {
    const fields = createRecordFields();

    const colorView = defaultWebFieldResolver.resolveView(fields.accentColor);
    const colorEditor = defaultWebFieldResolver.resolveEditor(fields.accentColor);
    const percentView = defaultWebFieldResolver.resolveView(fields.completion);
    const percentEditor = defaultWebFieldResolver.resolveEditor(fields.completion);
    const textView = defaultWebFieldResolver.resolveView(fields.headline);
    const textEditor = defaultWebFieldResolver.resolveEditor(fields.headline);
    const markdownView = defaultWebFieldResolver.resolveView(fields.details);
    const markdownEditor = defaultWebFieldResolver.resolveEditor(fields.details);
    const svgView = defaultWebFieldResolver.resolveView(fields.iconSvg);
    const svgEditor = defaultWebFieldResolver.resolveEditor(fields.iconSvg);

    expect(colorView.status).toBe("resolved");
    expect(colorEditor.status).toBe("resolved");
    expect(percentView.status).toBe("resolved");
    expect(percentEditor.status).toBe("resolved");
    expect(textView.status).toBe("resolved");
    expect(textEditor.status).toBe("resolved");
    expect(markdownView.status).toBe("resolved");
    expect(markdownEditor.status).toBe("resolved");
    expect(svgView.status).toBe("resolved");
    expect(svgEditor.status).toBe("resolved");

    if (colorView.status === "resolved") {
      expect(colorView.capability.kind).toBe("color");
    }
    if (colorEditor.status === "resolved") {
      expect(colorEditor.capability.kind).toBe("color");
    }
    if (percentView.status === "resolved") {
      expect(percentView.capability.kind).toBe("number/percent");
    }
    if (percentEditor.status === "resolved") {
      expect(percentEditor.capability.kind).toBe("number/percent");
    }
    if (textView.status === "resolved") {
      expect(textView.capability.kind).toBe("text");
    }
    if (textEditor.status === "resolved") {
      expect(textEditor.capability.kind).toBe("text");
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
  });

  it("renders shared browser fields with their moved module-core components", () => {
    const fields = createRecordFields();

    const colorViewMarkup = renderToStaticMarkup(
      <PredicateFieldView predicate={fields.accentColor} />,
    );
    const colorEditorMarkup = renderToStaticMarkup(
      <PredicateFieldEditor predicate={fields.accentColor} />,
    );
    const percentViewMarkup = renderToStaticMarkup(
      <PredicateFieldView predicate={fields.completion} />,
    );
    const percentEditorMarkup = renderToStaticMarkup(
      <PredicateFieldEditor predicate={fields.completion} />,
    );
    const textViewMarkup = renderToStaticMarkup(<PredicateFieldView predicate={fields.headline} />);
    const textEditorMarkup = renderToStaticMarkup(
      <PredicateFieldEditor predicate={fields.headline} />,
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

    expect(colorViewMarkup).toContain('data-web-field-kind="color"');
    expect(colorViewMarkup).toContain('data-web-color-swatch="#2563eb"');
    expect(colorViewMarkup).toContain("#2563EB");
    expect(colorEditorMarkup).toContain('data-web-field-kind="color"');
    expect(colorEditorMarkup).toContain('value="#2563eb"');
    expect(percentViewMarkup).toContain('data-web-field-kind="number/percent"');
    expect(percentViewMarkup).toContain("72.5%");
    expect(percentEditorMarkup).toContain('data-web-field-kind="number/percent"');
    expect(percentEditorMarkup).toContain("%");
    expect(textViewMarkup).toContain('data-web-field-kind="text"');
    expect(textViewMarkup).toContain("KS-1");
    expect(textEditorMarkup).toContain('data-web-field-kind="text"');
    expect(textEditorMarkup).toContain('value="KS-1"');
    expect(markdownViewMarkup).toContain('data-web-field-kind="markdown"');
    expect(markdownViewMarkup).toContain("<strong>markdown</strong>");
    expect(markdownEditorMarkup).toContain('data-web-field-kind="markdown"');
    expect(markdownEditorMarkup).toContain('data-web-markdown-source="textarea"');
    expect(svgViewMarkup).toContain('data-web-field-kind="svg"');
    expect(svgViewMarkup).toContain('data-web-svg-preview="ready"');
    expect(svgEditorMarkup).toContain('data-web-field-kind="svg"');
    expect(svgEditorMarkup).toContain('data-web-svg-preview="ready"');
  });
});
