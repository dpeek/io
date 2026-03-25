import type {
  AdmissionBootstrapMode as AdmissionBootstrapModeFromRoot,
  AdmissionPolicy as AdmissionPolicyFromRoot,
  AdmissionProvisioning as AdmissionProvisioningFromRoot,
  AdmissionSignupPolicy as AdmissionSignupPolicyFromRoot,
  AuthSubjectRef as AuthSubjectRefFromRoot,
  AuthenticatedSession as AuthenticatedSessionFromRoot,
  AuthorizationContext as AuthorizationContextFromRoot,
  CapabilityGrant as CapabilityGrantFromRoot,
  CapabilityGrantConstraints as CapabilityGrantConstraintsFromRoot,
  CapabilityGrantResource as CapabilityGrantResourceFromRoot,
  CapabilityGrantStatus as CapabilityGrantStatusFromRoot,
  CapabilityGrantTarget as CapabilityGrantTargetFromRoot,
  CapabilityVersion as CapabilityVersionFromRoot,
  GraphCommandPolicy as GraphCommandPolicyFromRoot,
  GraphCommandSpec as GraphCommandSpecFromRoot,
  GraphCommandTouchedPredicate as GraphCommandTouchedPredicateFromRoot,
  ModulePermissionApprovalRecord as ModulePermissionApprovalRecordFromRoot,
  ModulePermissionCapabilityGrant as ModulePermissionCapabilityGrantFromRoot,
  ModulePermissionGrantResource as ModulePermissionGrantResourceFromRoot,
  ModulePermissionRequest as ModulePermissionRequestFromRoot,
  ObjectViewSpec as ObjectViewSpecFromRoot,
  PolicyVersion as PolicyVersionFromRoot,
  PrincipalRoleBinding as PrincipalRoleBindingFromRoot,
  PrincipalKind as PrincipalKindFromRoot,
  PredicatePolicyDescriptor as PredicatePolicyDescriptorFromRoot,
  ShareGrant as ShareGrantFromRoot,
  ShareSurface as ShareSurfaceFromRoot,
  WorkflowSpec as WorkflowSpecFromRoot,
} from "../index.js";
import type {
  AdmissionBootstrapMode,
  AdmissionPolicy,
  AdmissionProvisioning,
  AdmissionSignupPolicy,
  AuthSubjectRef,
  AuthenticatedSession,
  AuthorizationContext,
  CapabilityGrant,
  CapabilityGrantConstraints,
  CapabilityGrantResource,
  CapabilityGrantStatus,
  CapabilityGrantTarget,
  CapabilityVersion,
  GraphCommandPolicy,
  GraphCommandSpec,
  GraphCommandTouchedPredicate,
  ModulePermissionApprovalRecord,
  ModulePermissionCapabilityGrant,
  ModulePermissionGrantResource,
  ModulePermissionRequest,
  ObjectViewSpec,
  PolicyVersion,
  PrincipalRoleBinding,
  PrincipalKind,
  PredicatePolicyDescriptor,
  ShareGrant,
  ShareSurface,
  WorkflowSpec,
} from "./index.js";

const topicSummaryView = {
  key: "pkm:topic:summary",
  entity: "pkm:topic",
  titleField: "name",
  subtitleField: "kind",
  sections: [
    {
      key: "summary",
      title: "Summary",
      fields: [
        { path: "name", label: "Name", span: 2 },
        { path: "kind", label: "Kind" },
      ],
    },
  ],
  related: [
    {
      key: "references",
      title: "References",
      relationPath: "references",
      presentation: "list",
    },
  ],
  commands: ["pkm:topic:save"],
} satisfies ObjectViewSpec;

const topicReviewWorkflow = {
  key: "pkm:topic:review",
  label: "Review topic",
  description: "Review and update a topic.",
  subjects: ["pkm:topic"],
  steps: [
    {
      key: "review",
      title: "Review details",
      objectView: topicSummaryView.key,
    },
    {
      key: "save",
      title: "Save changes",
      command: "pkm:topic:save",
    },
  ],
  commands: ["pkm:topic:save"],
} satisfies WorkflowSpec;

const topicContentPolicy = {
  predicateId: "pkm:topic.content",
  transportVisibility: "replicated",
  requiredWriteScope: "server-command",
  readAudience: "graph-member",
  writeAudience: "module-command",
  shareable: true,
  requiredCapabilities: ["topic.write"],
} satisfies PredicatePolicyDescriptor;

const topicNameTouch = {
  predicateId: "pkm:topic.name",
} satisfies GraphCommandTouchedPredicate;

const topicContentTouch = {
  predicateId: topicContentPolicy.predicateId,
} satisfies GraphCommandTouchedPredicate;

const saveTopicCommand = {
  key: "pkm:topic:save",
  label: "Save topic",
  subject: "pkm:topic",
  execution: "optimisticVerify",
  input: {
    title: "Document graph explorer affordances",
  },
  output: {
    topicId: "topic-1",
  },
  policy: {
    capabilities: ["topic.write"],
    touchesPredicates: [topicNameTouch, topicContentTouch],
  },
} satisfies GraphCommandSpec<{ title: string }, { topicId: string }>;

const readTopicPermission = {
  key: "pkm.topic.read.summary",
  kind: "predicate-read",
  predicateIds: ["pkm:topic.name", topicContentPolicy.predicateId],
  reason: "Read topic summary data during install-planned views.",
  required: true,
} satisfies ModulePermissionRequest;

const saveTopicPermission = {
  key: "pkm.topic.command.save",
  kind: "command-execute",
  commandKeys: [saveTopicCommand.key],
  touchesPredicates: [topicNameTouch.predicateId, topicContentTouch.predicateId],
  reason: "Execute the topic save command from a module workflow.",
  required: true,
} satisfies ModulePermissionRequest;

const blobPreviewPermission = {
  key: "pkm.topic.blob.preview",
  kind: "blob-class",
  blobClassKeys: ["preview-image"],
  reason: "Access derived blob previews for topic cards.",
  required: false,
} satisfies ModulePermissionRequest;

const rootObjectView: ObjectViewSpecFromRoot = topicSummaryView;
const rootWorkflow: WorkflowSpecFromRoot = topicReviewWorkflow;
const rootCommand: GraphCommandSpecFromRoot<{ title: string }, { topicId: string }> =
  saveTopicCommand;
const rootReadPermission: ModulePermissionRequestFromRoot = readTopicPermission;
const rootSavePermission: ModulePermissionRequestFromRoot = saveTopicPermission;
const rootBlobPermission: ModulePermissionRequestFromRoot = blobPreviewPermission;

const authSubject = {
  issuer: "better-auth",
  provider: "github",
  providerAccountId: "acct-1",
  authUserId: "auth-user-1",
} satisfies AuthSubjectRef;

const authenticatedSession = {
  sessionId: "session-1",
  subject: authSubject,
} satisfies AuthenticatedSession;

const authorizationContext = {
  graphId: "graph-1",
  principalId: "principal-1",
  principalKind: "remoteGraph",
  sessionId: authenticatedSession.sessionId,
  roleKeys: ["graph:member"],
  capabilityGrantIds: ["grant-1"],
  capabilityVersion: 3,
  policyVersion: 5,
} satisfies AuthorizationContext;

const admissionProvisioning = {
  roleKeys: ["graph:member"],
} satisfies AdmissionProvisioning;

const admissionPolicy = {
  graphId: "graph:global",
  bootstrapMode: "first-user",
  signupPolicy: "open",
  allowedEmailDomains: ["example.com"],
  firstUserProvisioning: {
    roleKeys: ["graph:owner", "graph:authority"],
  },
  signupProvisioning: admissionProvisioning,
} satisfies AdmissionPolicy;

const capabilityGrantResource = {
  kind: "predicate-read",
  predicateId: "pkm:topic.content",
} satisfies CapabilityGrantResource;

const capabilityGrantTarget = {
  kind: "principal",
  principalId: "principal-1",
} satisfies CapabilityGrantTarget;

const modulePermissionGrantResource = {
  kind: "module-permission",
  permissionKey: saveTopicPermission.key,
} satisfies ModulePermissionGrantResource;

const modulePermissionCapabilityGrant = {
  id: "grant-module-permission-1",
  resource: modulePermissionGrantResource,
  target: capabilityGrantTarget,
  grantedByPrincipalId: "principal-admin",
  status: "active",
  issuedAt: "2026-03-24T00:00:00.000Z",
} satisfies ModulePermissionCapabilityGrant;

const modulePermissionRoleBinding = {
  id: "binding-module-permission-1",
  principalId: "principal-module-1",
  roleKey: "module:pkm.topic.editor",
  status: "active",
} satisfies PrincipalRoleBinding;

const approvedModulePermissionRecord = {
  moduleId: "pkm/topic",
  permissionKey: saveTopicPermission.key,
  request: saveTopicPermission,
  status: "approved",
  decidedAt: "2026-03-24T00:00:00.000Z",
  decidedByPrincipalId: "principal-admin",
  lowerings: [
    {
      kind: "capability-grant",
      grant: modulePermissionCapabilityGrant,
    },
    {
      kind: "role-binding",
      binding: modulePermissionRoleBinding,
    },
  ] as const,
} satisfies ModulePermissionApprovalRecord;

const deniedModulePermissionRecord = {
  moduleId: "pkm/topic",
  permissionKey: blobPreviewPermission.key,
  request: blobPreviewPermission,
  status: "denied",
  decidedAt: "2026-03-24T00:05:00.000Z",
  decidedByPrincipalId: "principal-admin",
  lowerings: [] as const,
} satisfies ModulePermissionApprovalRecord;

const revokedModulePermissionRecord = {
  moduleId: "pkm/topic",
  permissionKey: readTopicPermission.key,
  request: readTopicPermission,
  status: "revoked",
  decidedAt: "2026-03-24T00:10:00.000Z",
  decidedByPrincipalId: "principal-admin",
  revokedAt: "2026-03-24T01:00:00.000Z",
  revokedByPrincipalId: "principal-admin",
  lowerings: [
    {
      kind: "capability-grant",
      grant: {
        ...modulePermissionCapabilityGrant,
        id: "grant-module-permission-2",
        resource: {
          kind: "module-permission",
          permissionKey: readTopicPermission.key,
        },
        status: "revoked",
        revokedAt: "2026-03-24T01:00:00.000Z",
      },
    },
  ] as const,
} satisfies ModulePermissionApprovalRecord;

const rootModulePermissionGrantResource: ModulePermissionGrantResourceFromRoot =
  modulePermissionGrantResource;
const rootModulePermissionCapabilityGrant: ModulePermissionCapabilityGrantFromRoot =
  modulePermissionCapabilityGrant;
const rootModulePermissionRoleBinding: PrincipalRoleBindingFromRoot = modulePermissionRoleBinding;
const rootApprovedModulePermissionRecord: ModulePermissionApprovalRecordFromRoot =
  approvedModulePermissionRecord;
const rootDeniedModulePermissionRecord: ModulePermissionApprovalRecordFromRoot =
  deniedModulePermissionRecord;
const rootRevokedModulePermissionRecord: ModulePermissionApprovalRecordFromRoot =
  revokedModulePermissionRecord;

const capabilityGrantConstraints = {
  predicateIds: ["pkm:topic.content"],
  rootEntityId: "topic-1",
} satisfies CapabilityGrantConstraints;

const capabilityGrant = {
  id: "grant-1",
  resource: capabilityGrantResource,
  target: capabilityGrantTarget,
  grantedByPrincipalId: "principal-admin",
  constraints: capabilityGrantConstraints,
  status: "active",
  issuedAt: "2026-03-24T00:00:00.000Z",
} satisfies CapabilityGrant;

const topicShareSurface = {
  surfaceId: "share:topic-1:summary",
  kind: "entity-predicate-slice",
  rootEntityId: "topic-1",
  predicateIds: ["pkm:topic.name", topicContentPolicy.predicateId],
} satisfies ShareSurface;

const topicShareGrant = {
  id: "share-grant-1",
  surface: topicShareSurface,
  capabilityGrantId: "grant-share-1",
  status: "active",
} satisfies ShareGrant;

const rootAuthSubject: AuthSubjectRefFromRoot = authSubject;
const rootAuthenticatedSession: AuthenticatedSessionFromRoot = authenticatedSession;
const rootAuthorizationContext: AuthorizationContextFromRoot = authorizationContext;
const rootAdmissionPolicy: AdmissionPolicyFromRoot = admissionPolicy;
const rootAdmissionProvisioning: AdmissionProvisioningFromRoot = admissionProvisioning;
const rootAdmissionBootstrapMode: AdmissionBootstrapModeFromRoot = admissionPolicy.bootstrapMode;
const rootAdmissionSignupPolicy: AdmissionSignupPolicyFromRoot = admissionPolicy.signupPolicy;
const rootCapabilityGrantResource: CapabilityGrantResourceFromRoot = capabilityGrantResource;
const rootCapabilityGrantTarget: CapabilityGrantTargetFromRoot = capabilityGrantTarget;
const rootCapabilityGrantConstraints: CapabilityGrantConstraintsFromRoot =
  capabilityGrantConstraints;
const rootCapabilityGrantStatus: CapabilityGrantStatusFromRoot = capabilityGrant.status;
const rootCapabilityGrant: CapabilityGrantFromRoot = capabilityGrant;
const rootPredicatePolicy: PredicatePolicyDescriptorFromRoot = topicContentPolicy;
const rootCommandPolicy: GraphCommandPolicyFromRoot = saveTopicCommand.policy!;
const rootTouchedPredicate: GraphCommandTouchedPredicateFromRoot = topicContentTouch;
const rootShareSurface: ShareSurfaceFromRoot = topicShareSurface;
const rootShareGrant: ShareGrantFromRoot = topicShareGrant;
const rootCapabilityVersion: CapabilityVersionFromRoot = authorizationContext.capabilityVersion;
const rootPolicyVersion: PolicyVersionFromRoot = authorizationContext.policyVersion;
const rootPrincipalKind: PrincipalKindFromRoot = "remoteGraph";
const runtimeCapabilityVersion: CapabilityVersion = rootCapabilityVersion;
const runtimePolicyVersion: PolicyVersion = rootPolicyVersion;
const runtimeAdmissionPolicy: AdmissionPolicy = rootAdmissionPolicy;
const runtimeAdmissionProvisioning: AdmissionProvisioning = rootAdmissionProvisioning;
const runtimeAdmissionBootstrapMode: AdmissionBootstrapMode = rootAdmissionBootstrapMode;
const runtimeAdmissionSignupPolicy: AdmissionSignupPolicy = rootAdmissionSignupPolicy;
const runtimeCapabilityGrantResource: CapabilityGrantResource = rootCapabilityGrantResource;
const runtimeCapabilityGrantTarget: CapabilityGrantTarget = rootCapabilityGrantTarget;
const runtimeCapabilityGrantConstraints: CapabilityGrantConstraints =
  rootCapabilityGrantConstraints;
const runtimeCapabilityGrantStatus: CapabilityGrantStatus = rootCapabilityGrantStatus;
const runtimeCapabilityGrant: CapabilityGrant = rootCapabilityGrant;
const runtimePredicatePolicy: PredicatePolicyDescriptor = rootPredicatePolicy;
const runtimeCommandPolicy: GraphCommandPolicy = rootCommandPolicy;
const runtimeTouchedPredicate: GraphCommandTouchedPredicate = rootTouchedPredicate;
const runtimeShareSurface: ShareSurface = rootShareSurface;
const runtimeShareGrant: ShareGrant = rootShareGrant;
const runtimePrincipalKind: PrincipalKind = rootPrincipalKind;
const runtimeModulePermissionGrantResource: ModulePermissionGrantResource =
  rootModulePermissionGrantResource;
const runtimeModulePermissionCapabilityGrant: ModulePermissionCapabilityGrant =
  rootModulePermissionCapabilityGrant;
const runtimeModulePermissionRoleBinding: PrincipalRoleBinding = rootModulePermissionRoleBinding;
const runtimeApprovedModulePermissionRecord: ModulePermissionApprovalRecord =
  rootApprovedModulePermissionRecord;
const runtimeDeniedModulePermissionRecord: ModulePermissionApprovalRecord =
  rootDeniedModulePermissionRecord;
const runtimeRevokedModulePermissionRecord: ModulePermissionApprovalRecord =
  rootRevokedModulePermissionRecord;
const runtimeReadPermission: ModulePermissionRequest = rootReadPermission;
const runtimeSavePermission: ModulePermissionRequest = rootSavePermission;
const runtimeBlobPermission: ModulePermissionRequest = rootBlobPermission;

void rootObjectView;
void rootWorkflow;
void rootCommand;
void rootReadPermission;
void rootSavePermission;
void rootBlobPermission;
void rootModulePermissionGrantResource;
void rootModulePermissionCapabilityGrant;
void rootModulePermissionRoleBinding;
void rootApprovedModulePermissionRecord;
void rootDeniedModulePermissionRecord;
void rootRevokedModulePermissionRecord;
void rootAuthSubject;
void rootAuthenticatedSession;
void rootAuthorizationContext;
void rootAdmissionPolicy;
void rootAdmissionProvisioning;
void rootAdmissionBootstrapMode;
void rootAdmissionSignupPolicy;
void rootCapabilityGrantResource;
void rootCapabilityGrantTarget;
void rootCapabilityGrantConstraints;
void rootCapabilityGrantStatus;
void rootCapabilityGrant;
void rootPredicatePolicy;
void rootCommandPolicy;
void rootTouchedPredicate;
void rootShareSurface;
void rootShareGrant;
void rootCapabilityVersion;
void rootPolicyVersion;
void rootPrincipalKind;
void runtimeCapabilityVersion;
void runtimePolicyVersion;
void runtimeAdmissionPolicy;
void runtimeAdmissionProvisioning;
void runtimeAdmissionBootstrapMode;
void runtimeAdmissionSignupPolicy;
void runtimeCapabilityGrantResource;
void runtimeCapabilityGrantTarget;
void runtimeCapabilityGrantConstraints;
void runtimeCapabilityGrantStatus;
void runtimeCapabilityGrant;
void runtimePredicatePolicy;
void runtimeCommandPolicy;
void runtimeTouchedPredicate;
void runtimeShareSurface;
void runtimeShareGrant;
void runtimePrincipalKind;
void runtimeModulePermissionGrantResource;
void runtimeModulePermissionCapabilityGrant;
void runtimeModulePermissionRoleBinding;
void runtimeApprovedModulePermissionRecord;
void runtimeDeniedModulePermissionRecord;
void runtimeRevokedModulePermissionRecord;
void runtimeReadPermission;
void runtimeSavePermission;
void runtimeBlobPermission;

void ({
  graphId: "graph:global",
  // @ts-expect-error bootstrap mode follows the shared admission contract literals
  bootstrapMode: "bootstrap",
  signupPolicy: "closed",
  allowedEmailDomains: [],
  firstUserProvisioning: {
    roleKeys: [],
  },
  signupProvisioning: {
    roleKeys: [],
  },
} satisfies AdmissionPolicy);

void ({
  key: "pkm:topic:summary",
  entity: "pkm:topic",
  sections: [
    {
      key: "summary",
      title: "Summary",
      fields: [
        {
          path: "name",
          // @ts-expect-error object view field spans are limited to one or two columns
          span: 3,
        },
      ],
    },
  ],
} satisfies ObjectViewSpec);

void ({
  key: "pkm:topic:review",
  label: "Review topic",
  description: "Review and update a topic.",
  subjects: ["pkm:topic"],
  steps: [
    {
      key: "review",
      title: "Review details",
      // @ts-expect-error workflow steps refer to object view keys, not numeric ids
      objectView: 123,
    },
  ],
} satisfies WorkflowSpec);

void ({
  key: "pkm:topic:save",
  label: "Save topic",
  // @ts-expect-error commands must use one of the supported execution modes
  execution: "eventual",
  input: {
    title: "Document graph explorer affordances",
  },
  output: {
    topicId: "topic-1",
  },
} satisfies GraphCommandSpec);

void ({
  predicateId: "pkm:topic.content",
  transportVisibility: "replicated",
  requiredWriteScope: "server-command",
  // @ts-expect-error predicate policy audiences follow the shared authorization contract
  readAudience: "member",
  writeAudience: "module-command",
  shareable: true,
} satisfies PredicatePolicyDescriptor);

void ({
  capabilities: ["topic.write"],
  touchesPredicates: [
    {
      // @ts-expect-error touched predicates must use the shared predicateId shape
      id: "pkm:topic.content",
    },
  ],
} satisfies GraphCommandPolicy);

void ({
  key: "pkm.topic.read.summary",
  kind: "predicate-read",
  // @ts-expect-error predicate-read permissions must use an array of predicate ids
  predicateIds: "pkm:topic.name",
  reason: "Read topic summary data during install-planned views.",
  required: true,
} satisfies ModulePermissionRequest);

void ({
  key: "pkm.topic.write.content",
  kind: "predicate-write",
  predicateIds: [topicContentPolicy.predicateId],
  // @ts-expect-error predicate-write permissions must declare a shared write-scope literal
  writeScope: "server",
  reason: "Write topic content through a server command.",
  required: true,
} satisfies ModulePermissionRequest);

void ({
  key: "pkm.topic.jobs.reindex",
  kind: "background-job",
  // @ts-expect-error background-job permissions use jobKeys, not serviceKeys
  serviceKeys: ["queue:reindex"],
  reason: "Queue topic reindex work.",
  required: false,
} satisfies ModulePermissionRequest);

void ({
  moduleId: "pkm/topic",
  permissionKey: saveTopicPermission.key,
  request: saveTopicPermission,
  status: "approved",
  decidedAt: "2026-03-24T00:00:00.000Z",
  decidedByPrincipalId: "principal-admin",
  lowerings: [] as const,
  // @ts-expect-error approved module permissions must lower to at least one explicit grant or role binding
} satisfies ModulePermissionApprovalRecord);

void ({
  moduleId: "pkm/topic",
  permissionKey: blobPreviewPermission.key,
  request: blobPreviewPermission,
  status: "denied",
  decidedAt: "2026-03-24T00:05:00.000Z",
  decidedByPrincipalId: "principal-admin",
  lowerings: [
    {
      kind: "role-binding",
      binding: modulePermissionRoleBinding,
    },
  ] as const,
  // @ts-expect-error denied module permissions must not create explicit authorization records
} satisfies ModulePermissionApprovalRecord);

void ({
  kind: "module-permission",
  // @ts-expect-error module-permission grant resources use permissionKey
  commandKey: saveTopicCommand.key,
} satisfies ModulePermissionGrantResource);

void ({
  id: "binding-module-permission-2",
  principalId: "principal-module-1",
  roleKey: "module:pkm.topic.viewer",
  // @ts-expect-error role bindings use the shared active/revoked status literals
  status: "disabled",
} satisfies PrincipalRoleBinding);

void ({
  kind: "entity-predicate-slice",
  rootEntityId: "topic-1",
  predicateIds: [topicContentPolicy.predicateId],
  // @ts-expect-error share surfaces require a durable surfaceId
} satisfies ShareSurface);

void ({
  id: "share-grant-2",
  surface: topicShareSurface,
  status: "active",
  // @ts-expect-error share grants require a linked capabilityGrantId
} satisfies ShareGrant);

void ({
  graphId: "graph-1",
  principalId: "principal-1",
  // @ts-expect-error principal kinds follow the canonical core enum keys
  principalKind: "remote-graph",
  sessionId: "session-1",
  roleKeys: [],
  capabilityGrantIds: [],
  capabilityVersion: 1,
  policyVersion: 1,
} satisfies AuthorizationContext);

void ({
  kind: "principal",
  // @ts-expect-error principal-target grants require a principalId string
  graphId: "graph-1",
} satisfies CapabilityGrantTarget);

void ({
  id: "grant-1",
  resource: capabilityGrantResource,
  target: capabilityGrantTarget,
  grantedByPrincipalId: "principal-admin",
  // @ts-expect-error capability grants only accept the shared status literals
  status: "pending",
  issuedAt: "2026-03-24T00:00:00.000Z",
} satisfies CapabilityGrant);

void ({
  sessionId: "session-1",
  subject: {
    issuer: "better-auth",
    provider: "github",
    // @ts-expect-error auth subject ids stay stringly typed at the shared seam
    providerAccountId: 123,
    authUserId: "auth-user-1",
  },
} satisfies AuthenticatedSession);
