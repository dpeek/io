import { defineEnum, defineType } from "@io/core/graph/def";

import { defineReferenceField } from "../../../runtime/type-module.js";
import { dateTypeModule } from "../date/index.js";
import { defineDefaultEnumTypeModule } from "../enum-module.js";
import { node } from "../node/index.js";
import { numberTypeModule } from "../number/index.js";
import { stringTypeModule } from "../string/index.js";

const authorityOwnedIdentityFieldAuthority = {
  visibility: "authority-only",
  write: "authority-only",
} as const;

function resolvedEnumValue(value: { key: string; id?: string }): string {
  return value.id ?? value.key;
}

function validateRequiredString(label: string, value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? undefined
    : {
        code: "string.blank",
        message: `${label} must not be blank.`,
      };
}

function validateNonNegativeInteger(label: string, value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? undefined
    : {
        code: "number.invalid",
        message: `${label} must be a non-negative integer.`,
      };
}

function validateRequiredStringList(label: string, value: unknown) {
  return value === undefined ||
    (Array.isArray(value) &&
      value.every((item) => typeof item === "string" && item.trim().length > 0))
    ? undefined
    : {
        code: "string.blank",
        message: `${label} entries must not be blank.`,
      };
}

function requiredIdentityStringField(label: string) {
  return stringTypeModule.field({
    cardinality: "one",
    validate: ({ value }) => validateRequiredString(label, value),
    meta: {
      label,
    },
    filter: {
      operators: ["equals", "prefix"] as const,
      defaultOperator: "equals",
    },
    authority: authorityOwnedIdentityFieldAuthority,
  });
}

function optionalIdentityStringField(label: string) {
  return stringTypeModule.field({
    cardinality: "one?",
    validate: ({ value }) =>
      value === undefined ? undefined : validateRequiredString(label, value),
    meta: {
      label,
    },
    filter: {
      operators: ["equals", "prefix"] as const,
      defaultOperator: "equals",
    },
    authority: authorityOwnedIdentityFieldAuthority,
  });
}

export const principalKind = defineEnum({
  values: { key: "core:principalKind", name: "Principal Kind" },
  options: {
    human: {
      name: "Human",
    },
    service: {
      name: "Service",
    },
    agent: {
      name: "Agent",
    },
    anonymous: {
      name: "Anonymous",
    },
    remoteGraph: {
      name: "Remote graph",
    },
  },
});

export const principalKindTypeModule = defineDefaultEnumTypeModule(principalKind);

export const principalStatus = defineEnum({
  values: { key: "core:principalStatus", name: "Principal Status" },
  options: {
    active: {
      name: "Active",
    },
    disabled: {
      name: "Disabled",
    },
    deleted: {
      name: "Deleted",
    },
  },
});

export const principalStatusTypeModule = defineDefaultEnumTypeModule(principalStatus);

export const authSubjectStatus = defineEnum({
  values: { key: "core:authSubjectStatus", name: "Auth Subject Status" },
  options: {
    active: {
      name: "Active",
    },
    revoked: {
      name: "Revoked",
    },
  },
});

export const authSubjectStatusTypeModule = defineDefaultEnumTypeModule(authSubjectStatus);

export const principalRoleBindingStatus = defineEnum({
  values: {
    key: "core:principalRoleBindingStatus",
    name: "Principal Role Binding Status",
  },
  options: {
    active: {
      name: "Active",
    },
    revoked: {
      name: "Revoked",
    },
  },
});

export const principalRoleBindingStatusTypeModule = defineDefaultEnumTypeModule(
  principalRoleBindingStatus,
);

export const admissionApprovalStatus = defineEnum({
  values: {
    key: "core:admissionApprovalStatus",
    name: "Admission Approval Status",
  },
  options: {
    active: {
      name: "Active",
    },
    revoked: {
      name: "Revoked",
    },
  },
});

export const admissionApprovalStatusTypeModule =
  defineDefaultEnumTypeModule(admissionApprovalStatus);

export const admissionBootstrapMode = defineEnum({
  values: {
    key: "core:admissionBootstrapMode",
    name: "Admission Bootstrap Mode",
  },
  options: {
    manual: {
      name: "Manual",
    },
    firstUser: {
      name: "First user",
    },
  },
});

export const admissionBootstrapModeTypeModule = defineDefaultEnumTypeModule(admissionBootstrapMode);

export const admissionSignupPolicy = defineEnum({
  values: {
    key: "core:admissionSignupPolicy",
    name: "Admission Signup Policy",
  },
  options: {
    closed: {
      name: "Closed",
    },
    open: {
      name: "Open",
    },
  },
});

export const admissionSignupPolicyTypeModule = defineDefaultEnumTypeModule(admissionSignupPolicy);

export const capabilityGrantResourceKind = defineEnum({
  values: {
    key: "core:capabilityGrantResourceKind",
    name: "Capability Grant Resource Kind",
  },
  options: {
    predicateRead: {
      name: "Predicate read",
    },
    predicateWrite: {
      name: "Predicate write",
    },
    commandExecute: {
      name: "Command execute",
    },
    modulePermission: {
      name: "Module permission",
    },
    shareSurface: {
      name: "Share surface",
    },
  },
});

export const capabilityGrantResourceKindTypeModule = defineDefaultEnumTypeModule(
  capabilityGrantResourceKind,
);

export const capabilityGrantTargetKind = defineEnum({
  values: {
    key: "core:capabilityGrantTargetKind",
    name: "Capability Grant Target Kind",
  },
  options: {
    principal: {
      name: "Principal",
    },
    graph: {
      name: "Graph",
    },
    bearer: {
      name: "Bearer",
    },
  },
});

export const capabilityGrantTargetKindTypeModule =
  defineDefaultEnumTypeModule(capabilityGrantTargetKind);

export const capabilityGrantStatus = defineEnum({
  values: { key: "core:capabilityGrantStatus", name: "Capability Grant Status" },
  options: {
    active: {
      name: "Active",
    },
    expired: {
      name: "Expired",
    },
    revoked: {
      name: "Revoked",
    },
  },
});

export const capabilityGrantStatusTypeModule = defineDefaultEnumTypeModule(capabilityGrantStatus);

export const shareSurfaceKind = defineEnum({
  values: { key: "core:shareSurfaceKind", name: "Share Surface Kind" },
  options: {
    entityPredicateSlice: {
      name: "Entity predicate slice",
    },
  },
});

export const shareSurfaceKindTypeModule = defineDefaultEnumTypeModule(shareSurfaceKind);

export const principal = defineType({
  values: { key: "core:principal", name: "Principal" },
  fields: {
    ...node.fields,
    kind: principalKindTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Kind",
      },
    }),
    status: principalStatusTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Status",
      },
    }),
    homeGraphId: requiredIdentityStringField("Home graph id"),
    personId: optionalIdentityStringField("Person id"),
    capabilityVersion: {
      ...numberTypeModule.field({
        cardinality: "one",
        validate: ({ value }) => validateNonNegativeInteger("Capability version", value),
        onCreate: ({ incoming }) => incoming ?? 0,
        meta: {
          label: "Capability version",
        },
        authority: authorityOwnedIdentityFieldAuthority,
      }),
      createOptional: true as const,
    },
  },
});

export const authSubjectProjection = defineType({
  values: { key: "core:authSubjectProjection", name: "Auth Subject Projection" },
  fields: {
    ...node.fields,
    principal: defineReferenceField({
      range: principal.values.key,
      cardinality: "one",
    }),
    issuer: requiredIdentityStringField("Issuer"),
    provider: requiredIdentityStringField("Provider"),
    providerAccountId: requiredIdentityStringField("Provider account id"),
    authUserId: requiredIdentityStringField("Auth user id"),
    status: authSubjectStatusTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Status",
      },
    }),
    mirroredAt: dateTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Mirrored at",
      },
    }),
  },
});

export const principalRoleBinding = defineType({
  values: { key: "core:principalRoleBinding", name: "Principal Role Binding" },
  fields: {
    ...node.fields,
    principal: defineReferenceField({
      range: principal.values.key,
      cardinality: "one",
    }),
    roleKey: requiredIdentityStringField("Role key"),
    status: principalRoleBindingStatusTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Status",
      },
    }),
  },
});

export const admissionPolicy = defineType({
  values: { key: "core:admissionPolicy", name: "Admission Policy" },
  fields: {
    ...node.fields,
    graphId: requiredIdentityStringField("Graph id"),
    bootstrapMode: admissionBootstrapModeTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Bootstrap mode",
      },
      authority: authorityOwnedIdentityFieldAuthority,
    }),
    signupPolicy: admissionSignupPolicyTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Signup policy",
      },
      authority: authorityOwnedIdentityFieldAuthority,
    }),
    allowedEmailDomain: stringTypeModule.field({
      cardinality: "many",
      validate: ({ value }) => validateRequiredStringList("Allowed email domain", value),
      meta: {
        label: "Allowed email domain",
      },
      filter: {
        operators: ["equals", "prefix"] as const,
        defaultOperator: "equals",
      },
      authority: authorityOwnedIdentityFieldAuthority,
    }),
    firstUserRoleKey: stringTypeModule.field({
      cardinality: "many",
      validate: ({ value }) => validateRequiredStringList("First user role key", value),
      meta: {
        label: "First user role key",
      },
      filter: {
        operators: ["equals", "prefix"] as const,
        defaultOperator: "equals",
      },
      authority: authorityOwnedIdentityFieldAuthority,
    }),
    signupRoleKey: stringTypeModule.field({
      cardinality: "many",
      validate: ({ value }) => validateRequiredStringList("Signup role key", value),
      meta: {
        label: "Signup role key",
      },
      filter: {
        operators: ["equals", "prefix"] as const,
        defaultOperator: "equals",
      },
      authority: authorityOwnedIdentityFieldAuthority,
    }),
  },
});

export const admissionApproval = defineType({
  values: { key: "core:admissionApproval", name: "Admission Approval" },
  fields: {
    ...node.fields,
    graphId: requiredIdentityStringField("Graph id"),
    email: requiredIdentityStringField("Email"),
    roleKey: stringTypeModule.field({
      cardinality: "many",
      validate: ({ value }) => validateRequiredStringList("Role key", value),
      meta: {
        label: "Role key",
      },
      filter: {
        operators: ["equals", "prefix"] as const,
        defaultOperator: "equals",
      },
      authority: authorityOwnedIdentityFieldAuthority,
    }),
    status: {
      ...admissionApprovalStatusTypeModule.field({
        cardinality: "one",
        onCreate: ({ incoming }) =>
          incoming ?? resolvedEnumValue(admissionApprovalStatus.values.active),
        meta: {
          label: "Status",
        },
        authority: authorityOwnedIdentityFieldAuthority,
      }),
      createOptional: true as const,
    },
  },
});

export const capabilityGrant = defineType({
  values: { key: "core:capabilityGrant", name: "Capability Grant" },
  fields: {
    ...node.fields,
    resourceKind: capabilityGrantResourceKindTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Resource kind",
      },
      authority: authorityOwnedIdentityFieldAuthority,
    }),
    resourcePredicateId: optionalIdentityStringField("Resource predicate id"),
    resourceCommandKey: optionalIdentityStringField("Resource command key"),
    resourcePermissionKey: optionalIdentityStringField("Resource permission key"),
    resourceSurfaceId: optionalIdentityStringField("Resource surface id"),
    targetKind: capabilityGrantTargetKindTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Target kind",
      },
      authority: authorityOwnedIdentityFieldAuthority,
    }),
    targetPrincipal: defineReferenceField({
      range: principal.values.key,
      cardinality: "one?",
      meta: {
        label: "Target principal",
      },
      authority: authorityOwnedIdentityFieldAuthority,
    }),
    targetGraphId: optionalIdentityStringField("Target graph id"),
    bearerTokenHash: optionalIdentityStringField("Bearer token hash"),
    grantedByPrincipal: defineReferenceField({
      range: principal.values.key,
      cardinality: "one",
      meta: {
        label: "Granted by principal",
      },
      authority: authorityOwnedIdentityFieldAuthority,
    }),
    constraintRootEntityId: optionalIdentityStringField("Constraint root entity id"),
    constraintPredicateId: stringTypeModule.field({
      cardinality: "many",
      validate: ({ value }) => validateRequiredStringList("Constraint predicate id", value),
      meta: {
        label: "Constraint predicate id",
      },
      filter: {
        operators: ["equals", "prefix"] as const,
        defaultOperator: "equals",
      },
      authority: authorityOwnedIdentityFieldAuthority,
    }),
    constraintExpiresAt: dateTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Constraint expires at",
      },
      authority: authorityOwnedIdentityFieldAuthority,
    }),
    constraintDelegatedFromGrantId: optionalIdentityStringField(
      "Constraint delegated from grant id",
    ),
    status: {
      ...capabilityGrantStatusTypeModule.field({
        cardinality: "one",
        onCreate: ({ incoming }) =>
          incoming ?? resolvedEnumValue(capabilityGrantStatus.values.active),
        meta: {
          label: "Status",
        },
        authority: authorityOwnedIdentityFieldAuthority,
      }),
      createOptional: true as const,
    },
    issuedAt: {
      ...dateTypeModule.field({
        cardinality: "one",
        onCreate: ({ incoming, now }) => incoming ?? now,
        meta: {
          label: "Issued at",
        },
        authority: authorityOwnedIdentityFieldAuthority,
      }),
      createOptional: true as const,
    },
    revokedAt: dateTypeModule.field({
      cardinality: "one?",
      meta: {
        label: "Revoked at",
      },
      authority: authorityOwnedIdentityFieldAuthority,
    }),
  },
});

export const shareGrant = defineType({
  values: { key: "core:shareGrant", name: "Share Grant" },
  fields: {
    ...node.fields,
    surfaceId: requiredIdentityStringField("Surface id"),
    surfaceKind: shareSurfaceKindTypeModule.field({
      cardinality: "one",
      meta: {
        label: "Surface kind",
      },
      authority: authorityOwnedIdentityFieldAuthority,
    }),
    surfaceRootEntityId: requiredIdentityStringField("Surface root entity id"),
    surfacePredicateId: stringTypeModule.field({
      cardinality: "many",
      validate: ({ value }) => validateRequiredStringList("Surface predicate id", value),
      meta: {
        label: "Surface predicate id",
      },
      filter: {
        operators: ["equals", "prefix"] as const,
        defaultOperator: "equals",
      },
      authority: authorityOwnedIdentityFieldAuthority,
    }),
    capabilityGrant: defineReferenceField({
      range: capabilityGrant.values.key,
      cardinality: "one",
      meta: {
        label: "Capability grant",
      },
      authority: authorityOwnedIdentityFieldAuthority,
    }),
    status: {
      ...capabilityGrantStatusTypeModule.field({
        cardinality: "one",
        onCreate: ({ incoming }) =>
          incoming ?? resolvedEnumValue(capabilityGrantStatus.values.active),
        meta: {
          label: "Status",
        },
        authority: authorityOwnedIdentityFieldAuthority,
      }),
      createOptional: true as const,
    },
  },
});
