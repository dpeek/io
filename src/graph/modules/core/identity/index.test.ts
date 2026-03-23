import { describe, expect, it } from "bun:test";

import { createIdMap } from "../../../runtime/identity.js";
import { core } from "../../core.js";
import {
  authSubjectProjection,
  authSubjectStatus,
  principal,
  principalKind,
  principalRoleBinding,
  principalRoleBindingStatus,
  principalStatus,
} from "./index.js";

describe("core identity family", () => {
  it("owns stable keys for the branch-2 identity anchors", () => {
    const { map } = createIdMap({
      principalKind,
      principalStatus,
      authSubjectStatus,
      principalRoleBindingStatus,
      principal,
      authSubjectProjection,
      principalRoleBinding,
    });

    expect(Object.keys(map.keys)).toEqual(
      expect.arrayContaining([
        "core:principalKind",
        "core:principalKind.remoteGraph",
        "core:principalStatus",
        "core:principalStatus.disabled",
        "core:authSubjectStatus",
        "core:principalRoleBindingStatus",
        "core:principal",
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
    expect(typeof core.principal.fields.homeGraphId.id).toBe("string");
    expect(typeof core.authSubjectProjection.fields.mirroredAt.id).toBe("string");
    expect(typeof core.principalRoleBinding.fields.roleKey.id).toBe("string");
    expect(typeof core.principalKind.values.remoteGraph.id).toBe("string");
  });
});
