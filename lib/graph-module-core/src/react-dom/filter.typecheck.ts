import { defineDefaultEnumTypeModule, defineType } from "@io/graph-module";
import { core } from "@io/graph-module-core";

import { kitchenSink } from "../../../app/src/graph/testing/kitchen-sink.js";
import type { FilterOperandEditorProps } from "./index.js";
import { defaultWebFilterResolver } from "./index.js";

const defs = { ...core, ...kitchenSink };
const statusTypeModule = defineDefaultEnumTypeModule(kitchenSink.status);

const estimateResolution = defaultWebFilterResolver.resolveField(
  kitchenSink.record.fields.estimate,
  defs,
);

if (estimateResolution.status === "resolved") {
  const greaterThan = estimateResolution.resolveOperator("gt");

  if (greaterThan) {
    const acceptsNumber: FilterOperandEditorProps<
      typeof kitchenSink.record.fields.estimate,
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
      typeof kitchenSink.record.fields.estimate,
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

const statusResolution = defaultWebFilterResolver.resolveField(
  kitchenSink.record.fields.status,
  defs,
);

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
      value: [kitchenSink.status.values.draft.id],
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
      value: kitchenSink.status.values.draft.id,
      onChange(value) {
        const nextValue: string[] | undefined = value;
        void nextValue;
      },
    };

    void rejectsSingleId;
  }
}
