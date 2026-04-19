import { describe, expect, it } from "bun:test";

import { bootstrap } from "@dpeek/graphle-bootstrap";
import { createGraphClient } from "@dpeek/graphle-client";
import { createGraphStore as createStore } from "@dpeek/graphle-kernel";
import { defineDefaultEnumTypeModule, defineEnum, defineType } from "@dpeek/graphle-module";
import {
  aggregateValidationIssues,
  createPathValidationIssue,
  createScopedValidationIssue,
  type EditSessionFieldController,
} from "@dpeek/graphle-react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  booleanTypeModule,
  core,
  coreGraphBootstrapOptions,
  markdownTypeModule,
  stringTypeModule,
} from "../index.js";
import {
  PredicateField,
  PredicateFieldControl,
  PredicateFieldEditor,
  PredicateFieldView,
  createWebFieldResolver,
} from "./resolver.js";

const probeStatusType = defineEnum({
  values: { key: "probe:status", name: "Status" },
  options: {
    draft: { name: "Draft" },
    published: { name: "Published" },
  },
});
const probeStatusTypeModule = defineDefaultEnumTypeModule(probeStatusType);

const probeRecord = defineType({
  values: { key: "probe:record", name: "Probe Record" },
  fields: {
    name: stringTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Name",
        description: "Readable probe label.",
      },
    }),
    active: booleanTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Active",
        description: "Whether the probe is active.",
      },
    }),
    status: probeStatusTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Status",
        description: "Workflow state for the probe.",
      },
    }),
    notes: markdownTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Notes",
        description: "Markdown notes for the probe.",
      },
    }),
  },
});

function createProbeFields() {
  const store = createStore();
  bootstrap(store, core, coreGraphBootstrapOptions);
  bootstrap(store, { probeRecord, probeStatusType }, coreGraphBootstrapOptions);

  const graph = createGraphClient(store, { ...core, probeRecord, probeStatusType });
  const recordId = graph.probeRecord.create({
    active: true,
    name: "Probe Name",
    notes: "# Probe notes",
  });
  return graph.probeRecord.ref(recordId).fields;
}

function createFieldController(path: readonly string[]): EditSessionFieldController<unknown> {
  return {
    commit() {
      return false;
    },
    getSnapshot() {
      return {
        committedValue: undefined,
        dirty: false,
        draftValue: undefined,
        touched: true,
      };
    },
    path,
    revert() {
      return false;
    },
    setDraftValue() {},
    setTouched() {},
    subscribe() {
      return () => undefined;
    },
  };
}

describe("@dpeek/graphle-module-core/react-dom resolver", () => {
  it("resolves explicit view, control, and field capabilities through the browser wrappers", () => {
    const { name: nameField } = createProbeFields();
    const resolver = createWebFieldResolver({
      control: [
        {
          kind: "text",
          Component: ({ mode }) => <input data-probe-control={mode} readOnly value="Probe Name" />,
        },
      ],
      field: [
        {
          kind: "text",
          Component: ({ mode }) => <div data-probe-field={mode}>Probe Field</div>,
        },
      ],
      view: [
        {
          kind: "text",
          Component: () => <span data-probe-view="text">Probe View</span>,
        },
      ],
    });

    expect(resolver.resolveMode("view", nameField)).toMatchObject({ status: "resolved" });
    expect(resolver.resolveMode("control", nameField)).toMatchObject({ status: "resolved" });
    expect(resolver.resolveMode("field", nameField)).toMatchObject({ status: "resolved" });

    const viewMarkup = renderToStaticMarkup(
      <PredicateFieldView predicate={nameField} resolver={resolver} />,
    );
    const controlMarkup = renderToStaticMarkup(
      <PredicateFieldControl predicate={nameField} resolver={resolver} />,
    );
    const fieldMarkup = renderToStaticMarkup(
      <PredicateField predicate={nameField} resolver={resolver} />,
    );

    expect(viewMarkup).toContain('data-probe-view="text"');
    expect(controlMarkup).toContain('data-probe-control="control"');
    expect(fieldMarkup).toContain('data-probe-field="field"');
  });

  it("derives full field rows from supplied control capabilities", () => {
    const { name: nameField } = createProbeFields();
    const resolver = createWebFieldResolver({
      control: [
        {
          kind: "text",
          Component: () => <input data-probe-control="text" readOnly value="Probe Name" />,
        },
      ],
    });

    const controlResolution = resolver.resolveControl(nameField);
    const fieldResolution = resolver.resolveField(nameField);

    expect(controlResolution.status).toBe("resolved");
    expect(fieldResolution.status).toBe("resolved");

    const controlMarkup = renderToStaticMarkup(
      <PredicateFieldControl predicate={nameField} resolver={resolver} />,
    );
    const fieldMarkup = renderToStaticMarkup(
      <PredicateField predicate={nameField} resolver={resolver} />,
    );
    const editorMarkup = renderToStaticMarkup(
      <PredicateFieldEditor predicate={nameField} resolver={resolver} />,
    );

    expect(controlMarkup).toContain('data-probe-control="text"');
    expect(fieldMarkup).toContain('data-web-field-mode="field"');
    expect(fieldMarkup).toContain('data-web-field-kind="text"');
    expect(fieldMarkup).toContain("Name");
    expect(fieldMarkup).toContain("Readable probe label.");
    expect(fieldMarkup).toContain('data-probe-control="text"');
    expect(editorMarkup).toContain('data-probe-control="text"');
    expect(editorMarkup).not.toContain('data-web-field-mode="field"');
  });

  it("reports unsupported control and field modes through the browser fallback", () => {
    const { name: nameField } = createProbeFields();
    const resolver = createWebFieldResolver({
      control: [],
      field: [],
      view: [],
    });

    const viewMarkup = renderToStaticMarkup(
      <PredicateFieldView predicate={nameField} resolver={resolver} />,
    );

    const controlMarkup = renderToStaticMarkup(
      <PredicateFieldControl predicate={nameField} resolver={resolver} />,
    );
    const fieldMarkup = renderToStaticMarkup(
      <PredicateField predicate={nameField} resolver={resolver} />,
    );

    expect(viewMarkup).toContain('data-web-field-mode="view"');
    expect(viewMarkup).toContain("unsupported-display-kind:text");
    expect(controlMarkup).toContain('data-web-field-mode="control"');
    expect(controlMarkup).toContain("unsupported-editor-kind:text");
    expect(fieldMarkup).toContain('data-web-field-mode="field"');
    expect(fieldMarkup).toContain("unsupported-editor-kind:text");
  });

  it("threads shared path issues through representative control and field modes", () => {
    const { active: activeField, name: nameField, status: statusField } = createProbeFields();
    const issues = aggregateValidationIssues([
      createPathValidationIssue({
        code: "field.required",
        message: "Name is required",
        path: ["name"],
        source: "field",
      }),
      createPathValidationIssue({
        code: "field.invalid",
        message: "Active must be confirmed",
        path: ["active"],
        source: "field",
      }),
      createPathValidationIssue({
        code: "field.required",
        message: "Status must be selected",
        path: ["status"],
        source: "field",
      }),
      createScopedValidationIssue({
        code: "form.blocked",
        message: "Form cannot be submitted yet",
        scope: "probe-form",
        source: "form",
      }),
    ]);

    const nameControlMarkup = renderToStaticMarkup(
      <PredicateFieldControl
        controller={createFieldController(["name"])}
        issues={issues}
        predicate={nameField}
      />,
    );
    const nameFieldMarkup = renderToStaticMarkup(
      <PredicateField
        controller={createFieldController(["name"])}
        issues={issues}
        predicate={nameField}
      />,
    );
    const activeFieldMarkup = renderToStaticMarkup(
      <PredicateField
        controller={createFieldController(["active"])}
        issues={issues}
        predicate={activeField}
      />,
    );
    const statusControlMarkup = renderToStaticMarkup(
      <PredicateFieldControl
        controller={createFieldController(["status"])}
        issues={issues}
        predicate={statusField}
      />,
    );
    const statusFieldMarkup = renderToStaticMarkup(
      <PredicateField
        controller={createFieldController(["status"])}
        issues={issues}
        predicate={statusField}
      />,
    );

    expect(nameControlMarkup).toContain('aria-invalid="true"');
    expect(nameFieldMarkup).toContain("Name is required");
    expect(nameFieldMarkup).not.toContain("Status must be selected");
    expect(nameFieldMarkup).not.toContain("Form cannot be submitted yet");
    expect(nameFieldMarkup).toContain('data-web-field-touched="true"');
    expect(activeFieldMarkup).toContain('data-orientation="horizontal"');
    expect(activeFieldMarkup).toContain("Active must be confirmed");
    expect(activeFieldMarkup).toContain('data-slot="field-label"');
    expect(statusControlMarkup).toContain('aria-invalid="true"');
    expect(statusFieldMarkup).toContain('data-web-field-kind="select"');
    expect(statusFieldMarkup).toContain("Workflow state for the probe.");
    expect(statusFieldMarkup).toContain("Status must be selected");
  });

  it("renders markdown controls with editable Plate markup", () => {
    const { notes: notesField } = createProbeFields();

    const controlMarkup = renderToStaticMarkup(<PredicateFieldControl predicate={notesField} />);
    const viewMarkup = renderToStaticMarkup(<PredicateFieldView predicate={notesField} />);

    expect(controlMarkup).toContain('data-web-field-kind="markdown"');
    expect(controlMarkup).toContain("graph-markdown");
    expect(controlMarkup).toContain('data-web-markdown-editor="plate"');
    expect(controlMarkup).toContain('data-slate-editor="true"');
    expect(controlMarkup).toContain('contentEditable="true"');
    expect(controlMarkup).toContain("Probe notes");
    expect(controlMarkup).not.toContain('data-web-markdown-source="textarea"');
    expect(controlMarkup).not.toContain("Monaco");
    expect(controlMarkup).not.toContain('data-web-markdown-source="monaco"');
    expect(controlMarkup).not.toContain("Preview");
    expect(controlMarkup).not.toContain("data-web-source-preview-toggle");
    expect(controlMarkup).not.toContain("data-web-markdown-preview");
    expect(viewMarkup).toContain('data-web-field-kind="markdown"');
    expect(viewMarkup).toContain("graph-markdown");
    expect(viewMarkup).toContain("Probe notes");
  });
});
