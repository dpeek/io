import type {
  AuthSubjectRef as AuthSubjectRefFromRoot,
  AuthenticatedSession as AuthenticatedSessionFromRoot,
  AuthorizationContext as AuthorizationContextFromRoot,
  CapabilityVersion as CapabilityVersionFromRoot,
  GraphCommandPolicy as GraphCommandPolicyFromRoot,
  GraphCommandSpec as GraphCommandSpecFromRoot,
  GraphCommandTouchedPredicate as GraphCommandTouchedPredicateFromRoot,
  ModulePermissionRequest as ModulePermissionRequestFromRoot,
  ObjectViewSpec as ObjectViewSpecFromRoot,
  PolicyVersion as PolicyVersionFromRoot,
  PrincipalKind as PrincipalKindFromRoot,
  PredicatePolicyDescriptor as PredicatePolicyDescriptorFromRoot,
  WorkflowSpec as WorkflowSpecFromRoot,
} from "../index.js";
import type {
  AuthSubjectRef,
  AuthenticatedSession,
  AuthorizationContext,
  CapabilityVersion,
  GraphCommandPolicy,
  GraphCommandSpec,
  GraphCommandTouchedPredicate,
  ModulePermissionRequest,
  ObjectViewSpec,
  PolicyVersion,
  PrincipalKind,
  PredicatePolicyDescriptor,
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

const rootAuthSubject: AuthSubjectRefFromRoot = authSubject;
const rootAuthenticatedSession: AuthenticatedSessionFromRoot = authenticatedSession;
const rootAuthorizationContext: AuthorizationContextFromRoot = authorizationContext;
const rootPredicatePolicy: PredicatePolicyDescriptorFromRoot = topicContentPolicy;
const rootCommandPolicy: GraphCommandPolicyFromRoot = saveTopicCommand.policy!;
const rootTouchedPredicate: GraphCommandTouchedPredicateFromRoot = topicContentTouch;
const rootCapabilityVersion: CapabilityVersionFromRoot = authorizationContext.capabilityVersion;
const rootPolicyVersion: PolicyVersionFromRoot = authorizationContext.policyVersion;
const rootPrincipalKind: PrincipalKindFromRoot = "remoteGraph";
const runtimeCapabilityVersion: CapabilityVersion = rootCapabilityVersion;
const runtimePolicyVersion: PolicyVersion = rootPolicyVersion;
const runtimePredicatePolicy: PredicatePolicyDescriptor = rootPredicatePolicy;
const runtimeCommandPolicy: GraphCommandPolicy = rootCommandPolicy;
const runtimeTouchedPredicate: GraphCommandTouchedPredicate = rootTouchedPredicate;
const runtimePrincipalKind: PrincipalKind = rootPrincipalKind;
const runtimeReadPermission: ModulePermissionRequest = rootReadPermission;
const runtimeSavePermission: ModulePermissionRequest = rootSavePermission;
const runtimeBlobPermission: ModulePermissionRequest = rootBlobPermission;

void rootObjectView;
void rootWorkflow;
void rootCommand;
void rootReadPermission;
void rootSavePermission;
void rootBlobPermission;
void rootAuthSubject;
void rootAuthenticatedSession;
void rootAuthorizationContext;
void rootPredicatePolicy;
void rootCommandPolicy;
void rootTouchedPredicate;
void rootCapabilityVersion;
void rootPolicyVersion;
void rootPrincipalKind;
void runtimeCapabilityVersion;
void runtimePolicyVersion;
void runtimePredicatePolicy;
void runtimeCommandPolicy;
void runtimeTouchedPredicate;
void runtimePrincipalKind;
void runtimeReadPermission;
void runtimeSavePermission;
void runtimeBlobPermission;

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
  sessionId: "session-1",
  subject: {
    issuer: "better-auth",
    provider: "github",
    // @ts-expect-error auth subject ids stay stringly typed at the shared seam
    providerAccountId: 123,
    authUserId: "auth-user-1",
  },
} satisfies AuthenticatedSession);
