import { app } from "../graph/app.js";
import { core } from "../graph/core.js";
import { defineType } from "../graph/schema.js";
import { statusTypeModule } from "../type/status/index.js";
import { defaultWebFilterResolver, type FilterOperandEditorProps } from "./bindings.js";

const defs = { ...core, ...app };

const foundedYearResolution = defaultWebFilterResolver.resolveField(
  app.company.fields.foundedYear,
  defs,
);

if (foundedYearResolution.status === "resolved") {
  const greaterThan = foundedYearResolution.resolveOperator("gt");

  if (greaterThan) {
    const acceptsNumber: FilterOperandEditorProps<
      typeof app.company.fields.foundedYear,
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
      typeof app.company.fields.foundedYear,
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

  // @ts-expect-error founded year does not expose string operators
  foundedYearResolution.resolveOperator("contains");
}

const statusResolution = defaultWebFilterResolver.resolveField(app.company.fields.status, defs);

if (statusResolution.status === "resolved") {
  // @ts-expect-error company status narrows enum operators to "is"
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
      value: [app.status.values.active.id],
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
      value: app.status.values.active.id,
      onChange(value) {
        const nextValue: string[] | undefined = value;
        void nextValue;
      },
    };

    void rejectsSingleId;
  }
}
