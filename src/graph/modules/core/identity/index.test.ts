import { describe, expect, it } from "bun:test";

import { createGraphIdMap as createIdMap } from "@io/graph-kernel";

import { core } from "../../core.js";
import {
  admissionApproval,
  admissionApprovalStatus,
  admissionBootstrapMode,
  admissionPolicy,
  admissionSignupPolicy,
  authSubjectProjection,
  authSubjectStatus,
  capabilityGrant,
  capabilityGrantResourceKind,
  capabilityGrantStatus,
  capabilityGrantTargetKind,
  principal,
  principalKind,
  principalRoleBinding,
  principalRoleBindingStatus,
  principalStatus,
  shareGrant,
  shareSurfaceKind,
} from "./index.js";

describe("core identity family", () => {
  it("owns stable keys for the branch-2 identity anchors", () => {
    const { map } = createIdMap({
      principalKind,
      principalStatus,
      authSubjectStatus,
      principalRoleBindingStatus,
      admissionApprovalStatus,
      admissionBootstrapMode,
      admissionSignupPolicy,
      capabilityGrantResourceKind,
      capabilityGrantTargetKind,
      capabilityGrantStatus,
      shareSurfaceKind,
      principal,
      authSubjectProjection,
      principalRoleBinding,
      admissionPolicy,
      admissionApproval,
      capabilityGrant,
      shareGrant,
    });

    expect(Object.keys(map.keys)).toEqual(
      expect.arrayContaining([
        "core:capabilityGrant",
        "core:capabilityGrant:grantedByPrincipal",
        "core:capabilityGrant:resourceKind",
        "core:capabilityGrant:status",
        "core:capabilityGrant:targetKind",
        "core:capabilityGrant:targetPrincipal",
        "core:capabilityGrantResourceKind",
        "core:capabilityGrantResourceKind.predicateRead",
        "core:capabilityGrantStatus",
        "core:capabilityGrantStatus.revoked",
        "core:capabilityGrantTargetKind",
        "core:capabilityGrantTargetKind.principal",
        "core:principalKind",
        "core:principalKind.remoteGraph",
        "core:principalStatus",
        "core:principalStatus.disabled",
        "core:authSubjectStatus",
        "core:principalRoleBindingStatus",
        "core:admissionApprovalStatus",
        "core:admissionApprovalStatus.active",
        "core:admissionBootstrapMode",
        "core:admissionBootstrapMode.firstUser",
        "core:admissionSignupPolicy",
        "core:admissionSignupPolicy.open",
        "core:admissionApproval",
        "core:admissionApproval:email",
        "core:admissionApproval:graphId",
        "core:admissionApproval:roleKey",
        "core:admissionApproval:status",
        "core:admissionPolicy",
        "core:admissionPolicy:graphId",
        "core:admissionPolicy:bootstrapMode",
        "core:admissionPolicy:signupPolicy",
        "core:admissionPolicy:allowedEmailDomain",
        "core:admissionPolicy:firstUserRoleKey",
        "core:admissionPolicy:signupRoleKey",
        "core:shareGrant",
        "core:shareGrant:capabilityGrant",
        "core:shareGrant:status",
        "core:shareGrant:surfaceId",
        "core:shareGrant:surfaceKind",
        "core:shareGrant:surfacePredicateId",
        "core:shareGrant:surfaceRootEntityId",
        "core:shareSurfaceKind",
        "core:shareSurfaceKind.entityPredicateSlice",
        "core:principal",
        "core:principal:capabilityVersion",
        "core:principal:kind",
        "core:principal:status",
        "core:principal:homeGraphId",
        "core:authSubjectProjection",
        "core:authSubjectProjection:principal",
        "core:authSubjectProjection:providerAccountId",
        "core:principalRoleBinding",
        "core:principalRoleBinding:principal",
        "core:principalRoleBinding:roleKey",
      ]),
    );
  });

  it("resolves identity references through the canonical core namespace", () => {
    expect(String(core.principal.fields.kind.range)).toBe(core.principalKind.values.id);
    expect(String(core.principal.fields.status.range)).toBe(core.principalStatus.values.id);
    expect(String(core.authSubjectProjection.fields.principal.range)).toBe(
      core.principal.values.id,
    );
    expect(String(core.authSubjectProjection.fields.status.range)).toBe(
      core.authSubjectStatus.values.id,
    );
    expect(String(core.principalRoleBinding.fields.principal.range)).toBe(core.principal.values.id);
    expect(String(core.principalRoleBinding.fields.status.range)).toBe(
      core.principalRoleBindingStatus.values.id,
    );
    expect(String(core.admissionApproval.fields.status.range)).toBe(
      core.admissionApprovalStatus.values.id,
    );
    expect(String(core.admissionPolicy.fields.bootstrapMode.range)).toBe(
      core.admissionBootstrapMode.values.id,
    );
    expect(String(core.admissionPolicy.fields.signupPolicy.range)).toBe(
      core.admissionSignupPolicy.values.id,
    );
    expect(String(core.capabilityGrant.fields.resourceKind.range)).toBe(
      core.capabilityGrantResourceKind.values.id,
    );
    expect(String(core.capabilityGrant.fields.targetKind.range)).toBe(
      core.capabilityGrantTargetKind.values.id,
    );
    expect(String(core.capabilityGrant.fields.targetPrincipal.range)).toBe(
      core.principal.values.id,
    );
    expect(String(core.capabilityGrant.fields.grantedByPrincipal.range)).toBe(
      core.principal.values.id,
    );
    expect(String(core.capabilityGrant.fields.status.range)).toBe(
      core.capabilityGrantStatus.values.id,
    );
    expect(String(core.shareGrant.fields.surfaceKind.range)).toBe(core.shareSurfaceKind.values.id);
    expect(String(core.shareGrant.fields.capabilityGrant.range)).toBe(
      core.capabilityGrant.values.id,
    );
    expect(String(core.shareGrant.fields.status.range)).toBe(core.capabilityGrantStatus.values.id);
    expect(typeof core.principal.fields.homeGraphId.id).toBe("string");
    expect(typeof core.principal.fields.capabilityVersion.id).toBe("string");
    expect(typeof core.authSubjectProjection.fields.mirroredAt.id).toBe("string");
    expect(typeof core.principalRoleBinding.fields.roleKey.id).toBe("string");
    expect(typeof core.admissionApproval.fields.email.id).toBe("string");
    expect(typeof core.admissionPolicy.fields.allowedEmailDomain.id).toBe("string");
    expect(typeof core.capabilityGrant.fields.constraintPredicateId.id).toBe("string");
    expect(typeof core.shareGrant.fields.surfacePredicateId.id).toBe("string");
    expect(typeof core.admissionApprovalStatus.values.active.id).toBe("string");
    expect(typeof core.admissionBootstrapMode.values.firstUser.id).toBe("string");
    expect(typeof core.admissionSignupPolicy.values.open.id).toBe("string");
    expect(typeof core.principalKind.values.remoteGraph.id).toBe("string");
    expect(typeof core.capabilityGrantTargetKind.values.principal.id).toBe("string");
    expect(typeof core.shareSurfaceKind.values.entityPredicateSlice.id).toBe("string");
  });

  it("keeps authority-owned identity strings off current replicated read surfaces", () => {
    expect(core.principal.fields.homeGraphId.authority?.visibility).toBe("authority-only");
    expect(core.principal.fields.homeGraphId.authority?.write).toBe("authority-only");
    expect(core.principal.fields.personId.authority?.visibility).toBe("authority-only");
    expect(core.principal.fields.capabilityVersion.authority?.visibility).toBe("authority-only");
    expect(core.authSubjectProjection.fields.providerAccountId.authority?.visibility).toBe(
      "authority-only",
    );
    expect(core.principalRoleBinding.fields.roleKey.authority?.visibility).toBe("authority-only");
    expect(core.admissionApproval.fields.email.authority?.visibility).toBe("authority-only");
    expect(core.admissionApproval.fields.status.authority?.write).toBe("authority-only");
    expect(core.admissionPolicy.fields.graphId.authority?.visibility).toBe("authority-only");
    expect(core.admissionPolicy.fields.bootstrapMode.authority?.write).toBe("authority-only");
    expect(core.admissionPolicy.fields.allowedEmailDomain.authority?.visibility).toBe(
      "authority-only",
    );
    expect(core.admissionPolicy.fields.signupRoleKey.authority?.write).toBe("authority-only");
    expect(core.capabilityGrant.fields.resourcePredicateId.authority?.visibility).toBe(
      "authority-only",
    );
    expect(core.capabilityGrant.fields.targetPrincipal.authority?.write).toBe("authority-only");
    expect(core.capabilityGrant.fields.status.authority?.visibility).toBe("authority-only");
    expect(core.shareGrant.fields.surfaceId.authority?.visibility).toBe("authority-only");
    expect(core.shareGrant.fields.surfaceKind.authority?.write).toBe("authority-only");
    expect(core.shareGrant.fields.capabilityGrant.authority?.visibility).toBe("authority-only");
    expect(core.shareGrant.fields.status.authority?.visibility).toBe("authority-only");
  });
});
