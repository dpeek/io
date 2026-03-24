import { createIdMap, defineNamespace, defineReferenceField, defineType } from "../index.js";
import type {
  AuthSubjectRef,
  AuthenticatedSession,
  AuthorizationContext,
  GraphCommandSpec,
  ModulePermissionRequest,
  ObjectViewSpec,
  PredicatePolicyDescriptor,
  WorkflowSpec,
} from "../index.js";
import { fieldPolicyDescriptor } from "../index.js";
import { core, stringTypeModule } from "../modules/index.js";

// Test-only root-safe contract probes that feature work can copy from.
export const probeContractItem = defineType({
  values: { key: "probe:contractItem", name: "Probe Contract Item" },
  fields: {
    ...core.node.fields,
    name: {
      ...core.node.fields.name,
      authority: {
        write: "server-command",
        policy: {
          readAudience: "graph-member",
          writeAudience: "module-command",
          shareable: true,
          requiredCapabilities: ["probe.contract.write"],
        },
      },
    },
    summary: stringTypeModule.field({
      cardinality: "one?",
      authority: {
        write: "server-command",
        policy: {
          readAudience: "graph-member",
          writeAudience: "module-command",
          shareable: true,
          requiredCapabilities: ["probe.contract.write"],
        },
      },
      meta: {
        label: "Summary",
        editor: {
          kind: "textarea",
          multiline: true,
        },
      },
      filter: {
        operators: ["contains", "equals"] as const,
        defaultOperator: "contains",
      },
    }),
    parent: defineReferenceField({
      range: "probe:contractItem",
      cardinality: "one?",
    }),
    relatedItems: defineReferenceField({
      range: "probe:contractItem",
      cardinality: "many",
    }),
  },
});

export const probeContractGraph = defineNamespace(
  createIdMap({ contractItem: probeContractItem }).map,
  { contractItem: probeContractItem },
);

export const probeAuthSubject = {
  issuer: "better-auth",
  provider: "github",
  providerAccountId: "acct-probe-1",
  authUserId: "auth-user-probe-1",
} satisfies AuthSubjectRef;

export const probeAuthenticatedSession = {
  sessionId: "session-probe-1",
  subject: probeAuthSubject,
} satisfies AuthenticatedSession;

export const probeAuthorizationContext = {
  graphId: "graph:probe",
  principalId: "principal:probe",
  principalKind: "human",
  sessionId: probeAuthenticatedSession.sessionId,
  roleKeys: ["graph:member"],
  capabilityGrantIds: ["grant:probe:1"],
  capabilityVersion: 2,
  policyVersion: 7,
} satisfies AuthorizationContext;

const resolvedProbeContractSummaryPolicy = fieldPolicyDescriptor(probeContractItem.fields.summary);
const resolvedProbeContractNamePolicy = fieldPolicyDescriptor(probeContractItem.fields.name);

if (!resolvedProbeContractSummaryPolicy) {
  throw new Error("Probe contract summary field must resolve a predicate policy descriptor.");
}
if (!resolvedProbeContractNamePolicy) {
  throw new Error("Probe contract name field must resolve a predicate policy descriptor.");
}

export const probeContractSummaryPolicy =
  resolvedProbeContractSummaryPolicy satisfies PredicatePolicyDescriptor;
export const probeContractNamePolicy =
  resolvedProbeContractNamePolicy satisfies PredicatePolicyDescriptor;

export const probeContractObjectView = {
  key: "probe:contractItem:summary",
  entity: probeContractItem.values.key,
  titleField: "name",
  subtitleField: "summary",
  sections: [
    {
      key: "summary",
      title: "Summary",
      description: "Fields authored against the root-safe graph surface.",
      fields: [
        { path: "name", label: "Name", span: 2 },
        { path: "summary", label: "Summary", span: 2 },
      ],
    },
  ],
  related: [
    {
      key: "relatedItems",
      title: "Related items",
      relationPath: "relatedItems",
      presentation: "list",
    },
  ],
  commands: ["probe:contractItem:save"],
} satisfies ObjectViewSpec;

export const probeSaveContractItemCommand = {
  key: "probe:contractItem:save",
  label: "Save contract item",
  subject: probeContractItem.values.key,
  execution: "optimisticVerify",
  input: {
    name: "Probe contract item",
    summary: "Validate the contract surface without React.",
  },
  output: {
    itemId: "probe-item-1",
  },
  policy: {
    capabilities: ["probe.contract.write"],
    touchesPredicates: [
      { predicateId: probeContractNamePolicy.predicateId },
      { predicateId: probeContractSummaryPolicy.predicateId },
    ],
  },
} satisfies GraphCommandSpec<{ name: string; summary?: string }, { itemId: string }>;

export const probeModulePermissionRequests = [
  {
    key: "probe.contract.read.summary",
    kind: "predicate-read",
    predicateIds: [probeContractSummaryPolicy.predicateId],
    reason: "Read contract summaries during review.",
    required: true,
  },
  {
    key: "probe.contract.write.item",
    kind: "predicate-write",
    predicateIds: [probeContractNamePolicy.predicateId, probeContractSummaryPolicy.predicateId],
    writeScope: "server-command",
    reason: "Write contract fields through the authoritative save command.",
    required: true,
  },
  {
    key: "probe.contract.command.save",
    kind: "command-execute",
    commandKeys: [probeSaveContractItemCommand.key],
    touchesPredicates: [
      probeContractNamePolicy.predicateId,
      probeContractSummaryPolicy.predicateId,
    ],
    reason: "Execute the contract save command from review surfaces.",
    required: true,
  },
  {
    key: "probe.contract.secret.sync",
    kind: "secret-use",
    capabilityKeys: ["probe.contract.secret.use"],
    reason: "Use secret-backed integrations during contract sync.",
    required: false,
  },
  {
    key: "probe.contract.share.summary",
    kind: "share-admin",
    surfaceIds: ["probe:contractItem:summary"],
    reason: "Manage share surfaces for reviewed contract summaries.",
    required: false,
  },
  {
    key: "probe.contract.job.rebuild",
    kind: "background-job",
    jobKeys: ["probe.contract.rebuild-index"],
    reason: "Schedule asynchronous contract index rebuilds.",
    required: false,
  },
] satisfies readonly ModulePermissionRequest[];

export const probeContractWorkflow = {
  key: "probe:contractItem:review",
  label: "Review contract item",
  description: "Review a graph-authored probe item before saving it.",
  subjects: [probeContractItem.values.key],
  steps: [
    {
      key: "review",
      title: "Review details",
      objectView: probeContractObjectView.key,
    },
    {
      key: "save",
      title: "Save item",
      command: probeSaveContractItemCommand.key,
    },
  ],
  commands: [probeSaveContractItemCommand.key],
} satisfies WorkflowSpec;
