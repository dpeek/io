import type { PredicatePolicyDescriptor } from "@io/graph-kernel";

import type {
  AdmissionPolicy,
  AuthenticatedSession,
  AuthSubjectRef,
  AuthorizationContext,
  CapabilityGrant,
  GraphCommandPolicy,
  ModulePermissionApprovalRecord,
  ModulePermissionRequest,
  PrincipalRoleBinding,
  ShareGrant,
  ShareSurface,
  WebPrincipalBootstrapPayload,
  WebPrincipalSession,
  WebPrincipalSummary,
} from "./index.js";

const authorizationContext = {
  graphId: "graph:1",
  principalId: "principal:1",
  principalKind: "human",
  sessionId: "session:1",
  roleKeys: ["graph:member"],
  capabilityGrantIds: ["grant:1"],
  capabilityVersion: 1,
  policyVersion: 2,
} satisfies AuthorizationContext;

const admissionPolicy = {
  graphId: "graph:1",
  bootstrapMode: "manual",
  signupPolicy: "closed",
  allowedEmailDomains: [],
  firstUserProvisioning: {
    roleKeys: ["graph:owner"],
  },
  signupProvisioning: {
    roleKeys: [],
  },
} satisfies AdmissionPolicy;

const predicatePolicy = {
  predicateId: "topic.summary",
  transportVisibility: "replicated",
  requiredWriteScope: "server-command",
  readAudience: "graph-member",
  writeAudience: "module-command",
  shareable: true,
  requiredCapabilities: ["topic.write"],
} satisfies PredicatePolicyDescriptor;

const commandPolicy = {
  capabilities: ["topic.write"],
  touchesPredicates: [{ predicateId: predicatePolicy.predicateId }],
} satisfies GraphCommandPolicy;

const capabilityGrant = {
  id: "grant:1",
  resource: {
    kind: "share-surface",
    surfaceId: "share:topic",
  },
  target: {
    kind: "principal",
    principalId: "principal:1",
  },
  grantedByPrincipalId: "principal:operator",
  status: "active",
  issuedAt: "2026-03-26T00:00:00.000Z",
} satisfies CapabilityGrant;

const roleBinding = {
  id: "binding:1",
  principalId: "principal:1",
  roleKey: "graph:member",
  status: "active",
} satisfies PrincipalRoleBinding;

const shareSurface = {
  surfaceId: "share:topic",
  kind: "entity-predicate-slice",
  rootEntityId: "topic:1",
  predicateIds: [predicatePolicy.predicateId],
} satisfies ShareSurface;

const shareGrant = {
  id: "share-grant:1",
  surface: shareSurface,
  capabilityGrantId: capabilityGrant.id,
  status: "active",
} satisfies ShareGrant;

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

const webPrincipalSession = {
  authState: "ready",
  sessionId: authenticatedSession.sessionId,
  principalId: "principal-1",
  capabilityVersion: 3,
  displayName: "Operator",
} satisfies WebPrincipalSession;

const webPrincipalSummary = {
  graphId: "graph-1",
  principalId: "principal-1",
  principalKind: "human",
  roleKeys: ["graph:member"],
  capabilityGrantIds: ["grant-1"],
  access: {
    authority: false,
    graphMember: true,
    sharedRead: false,
  },
  capabilityVersion: 3,
  policyVersion: 5,
} satisfies WebPrincipalSummary;

const webPrincipalBootstrapPayload = {
  session: webPrincipalSession,
  principal: webPrincipalSummary,
} satisfies WebPrincipalBootstrapPayload;

const readDocumentPermission = {
  key: "workflow.document.read.summary",
  kind: "predicate-read",
  predicateIds: ["workflow:document.name", "workflow:document.description"],
  reason: "Read document summary data during install-planned views.",
  required: true,
} satisfies ModulePermissionRequest;

const saveDocumentPermission = {
  key: "workflow.document.command.save",
  kind: "command-execute",
  commandKeys: ["workflow:document:save"],
  touchesPredicates: ["workflow:document.name", "workflow:document.description"],
  reason: "Execute the document save command from a module workflow.",
  required: true,
} satisfies ModulePermissionRequest;

const approvedModulePermissionRecord = {
  moduleId: "workflow.document",
  permissionKey: readDocumentPermission.key,
  request: readDocumentPermission,
  status: "approved",
  decidedAt: "2026-03-24T00:00:00.000Z",
  decidedByPrincipalId: "principal:operator",
  lowerings: [
    {
      kind: "capability-grant",
      grant: {
        id: "grant-module-1",
        resource: {
          kind: "module-permission",
          permissionKey: readDocumentPermission.key,
        },
        target: {
          kind: "principal",
          principalId: "principal-1",
        },
        grantedByPrincipalId: "principal:operator",
        status: "active",
        issuedAt: "2026-03-24T00:00:00.000Z",
      },
    },
    {
      kind: "role-binding",
      binding: {
        id: "binding-1",
        principalId: "principal-1",
        roleKey: "graph:member",
        status: "active",
      },
    },
  ],
} satisfies ModulePermissionApprovalRecord;

void authorizationContext;
void admissionPolicy;
void commandPolicy;
void capabilityGrant;
void roleBinding;
void shareSurface;
void shareGrant;
void authSubject;
void authenticatedSession;
void webPrincipalSession;
void webPrincipalSummary;
void webPrincipalBootstrapPayload;
void readDocumentPermission;
void saveDocumentPermission;
void approvedModulePermissionRecord;
