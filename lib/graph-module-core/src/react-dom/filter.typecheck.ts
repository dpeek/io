import { defineDefaultEnumTypeModule, defineEnum, defineType } from "@io/graph-module";
import { core, durationTypeModule } from "@io/graph-module-core";
import type { FilterOperandEditorProps } from "./index.js";
import { defaultWebFilterResolver } from "./index.js";

const statusType = defineEnum({
  values: { key: "probe:status", name: "Probe Status" },
  options: {
    draft: { name: "Draft" },
    approved: { name: "Approved" },
  },
});
const statusTypeModule = defineDefaultEnumTypeModule(statusType);
const record = defineType({
  values: { key: "probe:record", name: "Probe Record" },
  fields: {
    estimate: durationTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Estimate",
      },
    }),
    status: statusTypeModule.field({
      cardinality: "one",
      filter: {
        operators: ["is"] as const,
        defaultOperator: "is",
      },
    }),
  },
});
const defs = { ...core, record, status: statusType } as const;

const estimateResolution = defaultWebFilterResolver.resolveField(record.fields.estimate, defs);

if (estimateResolution.status === "resolved") {
  const greaterThan = estimateResolution.resolveOperator("gt");

  if (greaterThan) {
    const acceptsNumber: FilterOperandEditorProps<
      typeof record.fields.estimate,
      typeof defs,
      "gt"
    > = {
      operator: greaterThan,
      value: 1999,
      onChange(value) {
        const nextValue: number | undefined = value;
        void nextValue;
      },
    };

    void acceptsNumber;

    const rejectsString: FilterOperandEditorProps<
      typeof record.fields.estimate,
      typeof defs,
      "gt"
    > = {
      operator: greaterThan,
      // @ts-expect-error number operators do not accept string operands
      value: "1999",
      onChange(value) {
        const nextValue: number | undefined = value;
        void nextValue;
      },
    };

    void rejectsString;
  }

  // @ts-expect-error estimate does not expose string operators
  estimateResolution.resolveOperator("contains");
}

const statusResolution = defaultWebFilterResolver.resolveField(record.fields.status, defs);

if (statusResolution.status === "resolved") {
  // @ts-expect-error record status narrows enum operators to "is"
  statusResolution.resolveOperator("oneOf");
}

const broadStatusProbe = defineType({
  values: { key: "probe:status-filter", name: "Probe Status Filter" },
  fields: {
    status: statusTypeModule.field({
      cardinality: "one",
    }),
  },
});
const broadStatusResolution = defaultWebFilterResolver.resolveField(
  broadStatusProbe.fields.status,
  defs,
);

if (broadStatusResolution.status === "resolved") {
  const oneOf = broadStatusResolution.resolveOperator("oneOf");

  if (oneOf) {
    const acceptsIds: FilterOperandEditorProps<
      typeof broadStatusProbe.fields.status,
      typeof defs,
      "oneOf"
    > = {
      operator: oneOf,
      value: ["probe:status.draft"],
      onChange(value) {
        const nextValue: string[] | undefined = value;
        void nextValue;
      },
    };

    void acceptsIds;

    const rejectsSingleId: FilterOperandEditorProps<
      typeof broadStatusProbe.fields.status,
      typeof defs,
      "oneOf"
    > = {
      operator: oneOf,
      // @ts-expect-error enum multi-select operators require string arrays
      value: "probe:status.draft",
      onChange(value) {
        const nextValue: string[] | undefined = value;
        void nextValue;
      },
    };

    void rejectsSingleId;
  }
}
