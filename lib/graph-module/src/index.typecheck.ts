import { isSecretBackedField } from "@io/graph-kernel";

import {
  type CollectionSurfaceSpec,
  type CollectionSurfacePresentationHints,
  type CollectionSurfacePresentationKind,
  type CollectionSurfaceSourceSpec,
  defineGraphModuleManifest,
  defineDefaultEnumTypeModule,
  defineEnum,
  defineReferenceField,
  defineScalar,
  defineScalarModule,
  defineSecretField,
  defineType,
  defineValidatedStringTypeModule,
  existingEntityReferenceField,
  type GraphModuleManifest,
  type GraphModuleManifestSource,
  type GraphCommandExecution,
  type GraphCommandSpec,
  type GraphCommandSurfaceSpec,
  type GraphCommandSurfaceInputPresentation,
  type GraphCommandSurfacePostSuccessBehavior,
  type GraphCommandSurfaceScope,
  type GraphCommandSurfaceSubjectModel,
  type GraphCommandSurfaceSubmitBehavior,
  type GraphSecretFieldAuthority,
  type ObjectViewFieldSpec,
  type ObjectViewRelatedSpec,
  type ObjectViewSectionSpec,
  type ObjectViewSpec,
  type RecordSurfaceFieldSpec,
  type RecordSurfaceRelatedContentSpec,
  type RecordSurfaceSectionSpec,
  type RecordSurfaceSpec,
  type TypeModule,
  type WorkflowStepSpec,
  type WorkflowSpec,
} from "./index.js";

const probeStringType = defineScalar({
  values: { key: "probe:string", name: "Probe String" },
  encode: (value: string) => value,
  decode: (raw) => raw,
});

const probeBooleanType = defineScalar({
  values: { key: "probe:boolean", name: "Probe Boolean" },
  encode: (value: boolean) => (value ? "true" : "false"),
  decode: (raw) => raw === "true",
});

const probeEntityType = defineType({
  values: { key: "probe:entity", name: "Probe Entity" },
  fields: {},
});

const probeSecretHandleType = defineType({
  values: { key: "probe:secretHandle", name: "Probe Secret Handle" },
  fields: {},
});

const probeStatusType = defineEnum({
  values: { key: "probe:status", name: "Probe Status" },
  options: {
    active: { name: "Active" },
    paused: { name: "Paused" },
  },
});

const probeStatusTypeModule = defineDefaultEnumTypeModule(probeStatusType);

const probeStringTypeModule = defineValidatedStringTypeModule({
  values: { key: "probe:validatedString", name: "Probe Validated String" },
  parse: (raw: string) => raw.trim(),
  filter: {
    defaultOperator: "equals",
    operators: {
      equals: {
        label: "Equals",
        operand: {
          kind: "string",
        },
        parse: (raw: string) => raw.trim(),
        format: (operand: string) => operand,
        test: (value: string, operand: string) => value === operand,
      },
      contains: {
        label: "Contains",
        operand: {
          kind: "string",
        },
        parse: (raw: string) => raw.trim(),
        format: (operand: string) => operand,
        test: (value: string, operand: string) => value.includes(operand),
      },
    },
  },
});

const probeBooleanTypeModule = defineScalarModule({
  type: probeBooleanType,
  meta: {
    display: {
      kind: "boolean",
      allowed: ["boolean", "text"] as const,
    },
    editor: {
      kind: "checkbox",
      allowed: ["checkbox", "switch"] as const,
    },
  },
  filter: {
    defaultOperator: "is",
    operators: {
      is: {
        label: "Is",
        operand: {
          kind: "boolean",
        },
        parse: (raw: string) => raw === "true",
        format: (operand: boolean) => String(operand),
        test: (value: boolean, operand: boolean) => value === operand,
      },
      isNot: {
        label: "Is not",
        operand: {
          kind: "boolean",
        },
        parse: (raw: string) => raw === "true",
        format: (operand: boolean) => String(operand),
        test: (value: boolean, operand: boolean) => value !== operand,
      },
    },
  },
});

void (probeBooleanTypeModule satisfies TypeModule<any, any, any>);

void defineReferenceField({
  range: probeEntityType,
  cardinality: "many",
});

void existingEntityReferenceField(probeEntityType, {
  cardinality: "many",
  label: "Related entities",
});

void existingEntityReferenceField(probeEntityType, {
  cardinality: "many",
  collection: "unordered",
  create: true,
  editorKind: "entity-reference-combobox",
  label: "Searchable related entities",
});

const secretField = defineSecretField({
  range: probeSecretHandleType,
  cardinality: "one?",
  revealCapability: "secret:reveal",
  rotateCapability: "secret:rotate",
});

void (secretField.authority.secret satisfies GraphSecretFieldAuthority);

if (isSecretBackedField(secretField)) {
  void (secretField.authority.secret satisfies GraphSecretFieldAuthority);
  void secretField.authority.secret.revealCapability;
  void secretField.authority.secret.rotateCapability;

  // @ts-expect-error transport details stay out of the shared secret-field authority contract
  void secretField.authority.secret.command;
}

void probeStringTypeModule.field({
  cardinality: "one",
  authority: {
    visibility: "authority-only",
    write: "authority-only",
  },
  meta: {
    editor: {
      kind: "text",
      multiline: true,
    },
  },
});

void probeStringTypeModule.field({
  cardinality: "one",
  meta: {
    editor: {
      // @ts-expect-error string fields cannot switch to an unrelated editor kind
      kind: "checkbox",
    },
  },
});

void probeStringTypeModule.field({
  cardinality: "one",
  filter: {
    // @ts-expect-error string fields cannot narrow to unknown filter operators
    operators: ["gt"] as const,
  },
});

void probeStatusTypeModule.field({
  cardinality: "one",
  filter: {
    operators: ["is"] as const,
    // @ts-expect-error the chosen default operator must belong to the narrowed operator set
    defaultOperator: "oneOf",
  },
});

void probeBooleanTypeModule.field({
  cardinality: "one?",
  meta: {
    editor: {
      kind: "switch",
    },
  },
});

void probeBooleanTypeModule.field({
  cardinality: "one?",
  meta: {
    editor: {
      // @ts-expect-error boolean fields cannot switch to text editing semantics
      kind: "text",
    },
  },
});

void defineScalarModule({
  type: probeStringType,
  meta: {
    summary: {
      kind: "value",
      // @ts-expect-error scalar metadata formatters must align with the decoded scalar value type
      format: (value: number) => String(value),
    },
    display: {
      kind: "text",
      allowed: ["text"] as const,
      format: (value: string) => value,
    },
    editor: {
      kind: "text",
      allowed: ["text"] as const,
    },
  },
  filter: {
    defaultOperator: "equals",
    operators: {
      equals: {
        label: "Equals",
        operand: {
          kind: "string",
        },
        parse: (raw: string) => raw,
        format: (operand: string) => operand,
        test: (value: string, operand: string) => value === operand,
      },
    },
  },
});

const probeObjectFields = [
  { path: "name", label: "Name", span: 2 },
] satisfies readonly ObjectViewFieldSpec[];
void (probeObjectFields satisfies readonly RecordSurfaceFieldSpec[]);

const probeObjectSections = [
  {
    key: "summary",
    title: "Summary",
    fields: probeObjectFields,
  },
] satisfies readonly ObjectViewSectionSpec[];
void (probeObjectSections satisfies readonly RecordSurfaceSectionSpec[]);

void ([
  {
    key: "relatedItems",
    title: "Related items",
    relationPath: "relatedItems",
    presentation: "table",
  },
] satisfies readonly ObjectViewRelatedSpec[]);

void ([
  {
    key: "relatedItems",
    title: "Related items",
    collection: "probe:relatedItems",
  },
] satisfies readonly RecordSurfaceRelatedContentSpec[]);

const probeCollectionPresentationKind: CollectionSurfacePresentationKind = "card-grid";
void probeCollectionPresentationKind;

void ({
  kind: "table",
  fields: ["name", "status"],
  recordSurface: "probe:record",
} satisfies CollectionSurfacePresentationHints);

void ({
  kind: "query",
  query: "probe:savedQuery",
  savedView: "probe:savedView",
} satisfies CollectionSurfaceSourceSpec);

void ({
  kind: "local",
  specifier: "./modules/probe.ts",
  exportName: "manifest",
} satisfies GraphModuleManifestSource);

const probeCommandSurfaceScope: GraphCommandSurfaceScope = "collection";
void probeCommandSurfaceScope;

void ({
  kind: "scope",
  scope: probeCommandSurfaceScope,
} satisfies GraphCommandSurfaceSubjectModel);

void ({
  kind: "dedicatedForm",
} satisfies GraphCommandSurfaceInputPresentation);

void ({
  kind: "confirm",
  title: "Save probe",
  confirmLabel: "Save",
} satisfies GraphCommandSurfaceSubmitBehavior);

void ([
  { kind: "navigate", target: "/probes" },
  { kind: "openCreatedEntity", entity: probeEntityType.values.key },
] satisfies readonly GraphCommandSurfacePostSuccessBehavior[]);

const probeCommandExecution: GraphCommandExecution = "serverOnly";
void probeCommandExecution;

void ([
  {
    key: "review",
    title: "Review",
    objectView: "probe:view",
  },
  {
    key: "save",
    title: "Save",
    command: "probe:save",
  },
] satisfies readonly WorkflowStepSpec[]);

void ({
  key: "probe:workflow-step",
  title: "Review",
  // @ts-expect-error workflow steps stay keyed to object-view compatibility ids for now
  recordSurface: "probe:record",
} satisfies WorkflowStepSpec);

void ({
  key: "probe:save",
  label: "Save probe",
  execution: "serverOnly",
  input: undefined,
  output: undefined,
  // @ts-expect-error UI invocation metadata belongs on GraphCommandSurfaceSpec
  inputPresentation: {
    kind: "dialog",
  },
} satisfies GraphCommandSpec);

void ({
  key: "probe:view",
  entity: probeEntityType.values.key,
  titleField: "name",
  sections: [
    {
      key: "summary",
      title: "Summary",
      fields: [{ path: "name", label: "Name", span: 2 }],
    },
  ],
  commands: ["probe:save"],
} satisfies ObjectViewSpec);

void ({
  key: "probe:record",
  subject: probeEntityType.values.key,
  titleField: "name",
  subtitleField: "status",
  sections: [
    {
      key: "summary",
      title: "Summary",
      description: "Probe record surface sections stay aligned with object-view fields.",
      fields: [
        { path: "name", label: "Name", span: 2 },
        { path: "status", label: "Status" },
      ],
    },
  ],
  related: [
    {
      key: "relatedItems",
      title: "Related items",
      collection: "probe:relatedItems",
    },
  ],
  commandSurfaces: ["probe:saveRecord"],
} satisfies RecordSurfaceSpec);

void ({
  key: "probe:relatedItems",
  title: "Related items",
  description: "Show probe entities related to the current record subject.",
  source: {
    kind: "relation",
    subject: probeEntityType.values.key,
    relationPath: "relatedItems",
  },
  presentation: {
    kind: "table",
    fields: ["name", "status"],
    recordSurface: "probe:record",
  },
  commandSurfaces: ["probe:saveSelection"],
} satisfies CollectionSurfaceSpec);

void ({
  key: "probe:saveRecord",
  command: "probe:save",
  label: "Save probe",
  subject: {
    kind: "entity",
    entity: probeEntityType.values.key,
  },
  inputPresentation: {
    kind: "sheet",
  },
  submitBehavior: {
    kind: "blocking",
  },
  postSuccess: [{ kind: "refresh" }, { kind: "close" }],
} satisfies GraphCommandSurfaceSpec);

void ({
  key: "probe:saveSelection",
  command: "probe:save",
  subject: {
    kind: "selection",
    entity: probeEntityType.values.key,
  },
  inputPresentation: {
    kind: "dialog",
  },
  submitBehavior: {
    kind: "confirm",
    title: "Save selected probes",
    confirmLabel: "Save",
  },
  postSuccess: [{ kind: "refresh" }],
} satisfies GraphCommandSurfaceSpec);

void ({
  key: "probe:save",
  label: "Save probe",
  subject: probeEntityType.values.key,
  execution: "optimisticVerify",
  input: {
    name: "Probe",
  },
  output: {
    itemId: "probe-1",
  },
} satisfies GraphCommandSpec<{ name: string }, { itemId: string }>);

void ({
  key: "probe:workflow",
  label: "Probe workflow",
  description: "Review a probe entity.",
  subjects: [probeEntityType.values.key],
  steps: [
    {
      key: "review",
      title: "Review",
      objectView: "probe:view",
    },
    {
      key: "save",
      title: "Save",
      command: "probe:save",
    },
  ],
  commands: ["probe:save"],
} satisfies WorkflowSpec);

const probeManifest = defineGraphModuleManifest({
  moduleId: "probe.contract",
  version: "0.0.1",
  source: {
    kind: "local",
    specifier: "./modules/probe-contract.ts",
    exportName: "manifest",
  },
  compatibility: {
    graph: "graph-schema:v1",
    runtime: "graph-runtime:v1",
  },
  runtime: {
    schemas: [
      {
        key: "probe.contract",
        namespace: {
          entity: probeEntityType,
        },
      },
    ],
    commands: [
      {
        key: "probe:save",
        label: "Save probe",
        execution: "optimisticVerify",
        input: {
          name: "Probe",
        },
        output: {
          itemId: "probe-1",
        },
      },
    ],
    workflows: [
      {
        key: "probe:workflow",
        label: "Probe workflow",
        description: "Review a probe entity.",
        subjects: [probeEntityType.values.key],
        steps: [
          {
            key: "review",
            title: "Review",
            objectView: "probe:view",
          },
          {
            key: "save",
            title: "Save",
            command: "probe:save",
          },
        ],
      },
    ],
    activationHooks: [
      {
        key: "probe.contract.activate",
        stage: "activate",
      },
    ],
  },
});

void (probeManifest satisfies GraphModuleManifest);
