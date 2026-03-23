import { defineEnum, defineType } from "@io/core/graph/def";

import { defineReferenceField } from "../../../runtime/type-module.js";
import { dateTypeModule } from "../date/index.js";
import { defineDefaultEnumTypeModule } from "../enum-module.js";
import { node } from "../node/index.js";
import { stringTypeModule } from "../string/index.js";

function validateRequiredString(label: string, value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? undefined
    : {
        code: "string.blank",
        message: `${label} must not be blank.`,
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
