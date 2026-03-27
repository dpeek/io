import type {
  AuthSubjectRef,
  AuthenticatedSession,
  ModulePermissionApprovalRecord,
  ModulePermissionCapabilityGrant,
  ModulePermissionGrantResource,
  ModulePermissionRequest,
  PrincipalRoleBinding,
} from "@io/graph-authority";
import {
  applyGraphIdMap as applyIdMap,
  createGraphIdMap as createIdMap,
  fieldPolicyDescriptor,
  type PredicatePolicyDescriptor,
} from "@io/graph-kernel";
import { defineReferenceField, defineType, type GraphCommandSpec } from "@io/graph-module";
import type { ObjectViewSpec, WorkflowSpec } from "@io/graph-module";
import { core, stringTypeModule } from "@io/graph-module-core";

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

export const probeContractGraph = applyIdMap(createIdMap({ contractItem: probeContractItem }).map, {
  contractItem: probeContractItem,
});

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

const probeReadSummaryPermission = probeModulePermissionRequests[0]!;
const probeSaveCommandPermission = probeModulePermissionRequests[2]!;
const probeRebuildJobPermission = probeModulePermissionRequests[5]!;

export const probeModulePermissionGrantResource = {
  kind: "module-permission",
  permissionKey: probeReadSummaryPermission.key,
} satisfies ModulePermissionGrantResource;

export const probeModulePermissionGrant = {
  id: "grant:probe:module-summary-read",
  resource: probeModulePermissionGrantResource,
  target: {
    kind: "principal",
    principalId: "principal:probe",
  },
  grantedByPrincipalId: "principal:operator",
  status: "active",
  issuedAt: "2026-03-24T00:00:00.000Z",
} satisfies ModulePermissionCapabilityGrant;

export const probeModulePermissionRoleBinding = {
  id: "binding:probe:contract-reviewer",
  principalId: "principal:module:probe-contract",
  roleKey: "module:probe.contract.reviewer",
  status: "active",
} satisfies PrincipalRoleBinding;

export const probeApprovedModulePermissionRecord = {
  moduleId: "probe.contract",
  permissionKey: probeReadSummaryPermission.key,
  request: probeReadSummaryPermission,
  status: "approved",
  decidedAt: "2026-03-24T00:00:00.000Z",
  decidedByPrincipalId: "principal:operator",
  lowerings: [
    {
      kind: "capability-grant",
      grant: probeModulePermissionGrant,
    },
    {
      kind: "role-binding",
      binding: probeModulePermissionRoleBinding,
    },
  ] as const,
} satisfies ModulePermissionApprovalRecord;

export const probeDeniedModulePermissionRecord = {
  moduleId: "probe.contract",
  permissionKey: probeRebuildJobPermission.key,
  request: probeRebuildJobPermission,
  status: "denied",
  decidedAt: "2026-03-24T00:05:00.000Z",
  decidedByPrincipalId: "principal:operator",
  note: "Background jobs stay disabled in the single-authority proof.",
  lowerings: [] as const,
} satisfies ModulePermissionApprovalRecord;

export const probeRevokedModulePermissionRecord = {
  moduleId: "probe.contract",
  permissionKey: probeSaveCommandPermission.key,
  request: probeSaveCommandPermission,
  status: "revoked",
  decidedAt: "2026-03-24T00:10:00.000Z",
  decidedByPrincipalId: "principal:operator",
  revokedAt: "2026-03-24T01:00:00.000Z",
  revokedByPrincipalId: "principal:authority",
  revocationNote: "Save command access was removed after install review changed.",
  lowerings: [
    {
      kind: "capability-grant",
      grant: {
        id: "grant:probe:module-command-save",
        resource: {
          kind: "module-permission",
          permissionKey: probeSaveCommandPermission.key,
        },
        target: {
          kind: "principal",
          principalId: "principal:module:probe-contract",
        },
        grantedByPrincipalId: "principal:operator",
        status: "revoked",
        issuedAt: "2026-03-24T00:10:00.000Z",
        revokedAt: "2026-03-24T01:00:00.000Z",
      },
    },
    {
      kind: "role-binding",
      binding: {
        ...probeModulePermissionRoleBinding,
        id: "binding:probe:contract-executor",
        roleKey: "module:probe.contract.executor",
        status: "revoked",
      },
    },
  ] as const,
} satisfies ModulePermissionApprovalRecord;

export const probeModulePermissionApprovalRecords = [
  probeApprovedModulePermissionRecord,
  probeDeniedModulePermissionRecord,
  probeRevokedModulePermissionRecord,
] as const;

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
