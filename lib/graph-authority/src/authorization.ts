import type { PolicyAudience, PolicyCapabilityKey, PolicyMutationMode } from "@io/graph-kernel";

import type {
  AuthorizationCommandTouchedPredicate,
  AuthorizationContext,
  AuthorizationDecision,
  AuthorizationPredicateTarget,
  AuthorizeCommandInput,
  AuthorizeReadInput,
  AuthorizeWriteInput,
  GraphCommandPolicy,
  PolicyError,
  PolicyErrorCode,
} from "./contracts.js";

const graphMemberRoleKeys = new Set(["graph:member", "graph:owner"]);
const authorityRoleKeys = new Set(["graph:authority"]);

const writeScopeLevel: Record<AuthorizeWriteInput["writeScope"], number> = {
  "client-tx": 0,
  "server-command": 1,
  "authority-only": 2,
};

function allow(): AuthorizationDecision {
  return { allowed: true };
}

function deny(
  code: PolicyErrorCode,
  message: string,
  options: Pick<PolicyError, "retryable" | "refreshRequired"> = {
    retryable: false,
  },
): AuthorizationDecision {
  return {
    allowed: false,
    error: {
      code,
      message,
      retryable: options.retryable,
      ...(options.refreshRequired === undefined
        ? {}
        : { refreshRequired: options.refreshRequired }),
    },
  };
}

function joinCapabilities(capabilityKeys: readonly PolicyCapabilityKey[]): string {
  return capabilityKeys.map((capability) => `"${capability}"`).join(", ");
}

function describePredicateTarget(target: AuthorizationPredicateTarget): string {
  return `predicate "${target.predicateId}" on subject "${target.subjectId}"`;
}

function hasAnyRole(roleKeys: readonly string[], expected: ReadonlySet<string>): boolean {
  return roleKeys.some((roleKey) => expected.has(roleKey));
}

function isAuthorityContext(authorization: AuthorizationContext): boolean {
  return (
    authorization.principalKind === "service" ||
    authorization.principalKind === "agent" ||
    hasAnyRole(authorization.roleKeys, authorityRoleKeys)
  );
}

function isOwnerContext(
  authorization: AuthorizationContext,
  target: AuthorizationPredicateTarget,
): boolean {
  return (
    authorization.principalId !== null &&
    target.ownerPrincipalId !== undefined &&
    target.ownerPrincipalId !== null &&
    authorization.principalId === target.ownerPrincipalId
  );
}

function isGraphMemberContext(
  authorization: AuthorizationContext,
  target: AuthorizationPredicateTarget,
): boolean {
  return (
    isAuthorityContext(authorization) ||
    isOwnerContext(authorization, target) ||
    hasAnyRole(authorization.roleKeys, graphMemberRoleKeys)
  );
}

function validateTargetPolicy(
  target: AuthorizationPredicateTarget,
  code: Extract<PolicyErrorCode, "policy.read.forbidden" | "policy.write.forbidden">,
): AuthorizationDecision | NonNullable<AuthorizationPredicateTarget["policy"]> {
  if (!target.policy) {
    return deny(
      code,
      `${describePredicateTarget(target)} is forbidden because no predicate policy was provided.`,
    );
  }

  if (target.policy.predicateId !== target.predicateId) {
    return deny(
      code,
      `${describePredicateTarget(target)} is forbidden because the provided predicate policy targeted "${target.policy.predicateId}".`,
    );
  }

  return target.policy;
}

function denyUnauthenticated(
  code: Extract<
    PolicyErrorCode,
    "auth.unauthenticated" | "policy.read.forbidden" | "policy.write.forbidden"
  >,
  message: string,
): AuthorizationDecision {
  if (code === "auth.unauthenticated") {
    return deny(code, message);
  }

  return deny(code, message);
}

function evaluateReadAudience(
  authorization: AuthorizationContext,
  target: AuthorizationPredicateTarget,
  audience: PolicyAudience,
): AuthorizationDecision {
  switch (audience) {
    case "public":
      return allow();
    case "owner":
      if (isAuthorityContext(authorization) || isOwnerContext(authorization, target)) {
        return allow();
      }
      return authorization.principalId === null
        ? denyUnauthenticated(
            "auth.unauthenticated",
            `${describePredicateTarget(target)} requires an authenticated owner.`,
          )
        : deny(
            "policy.read.forbidden",
            `${describePredicateTarget(target)} is not readable by principal "${authorization.principalId}".`,
          );
    case "graph-member":
      if (isGraphMemberContext(authorization, target)) {
        return allow();
      }
      return authorization.principalId === null
        ? denyUnauthenticated(
            "auth.unauthenticated",
            `${describePredicateTarget(target)} requires an authenticated graph member.`,
          )
        : deny(
            "policy.read.forbidden",
            `${describePredicateTarget(target)} requires graph-member access.`,
          );
    case "capability":
      return allow();
    case "authority":
      if (isAuthorityContext(authorization)) {
        return allow();
      }
      return authorization.principalId === null
        ? denyUnauthenticated(
            "auth.unauthenticated",
            `${describePredicateTarget(target)} requires an authority principal.`,
          )
        : deny(
            "policy.read.forbidden",
            `${describePredicateTarget(target)} requires authority access.`,
          );
    default: {
      const exhaustive: never = audience;
      return exhaustive;
    }
  }
}

function evaluateWriteAudience(
  authorization: AuthorizationContext,
  target: AuthorizationPredicateTarget,
  writeAudience: PolicyMutationMode,
  intent: NonNullable<AuthorizeWriteInput["intent"]>,
): AuthorizationDecision {
  switch (writeAudience) {
    case "owner-edit":
      if (isAuthorityContext(authorization) || isOwnerContext(authorization, target)) {
        return allow();
      }
      return authorization.principalId === null
        ? denyUnauthenticated(
            "auth.unauthenticated",
            `${describePredicateTarget(target)} requires an authenticated owner write.`,
          )
        : deny(
            "policy.write.forbidden",
            `${describePredicateTarget(target)} is not writable by principal "${authorization.principalId}".`,
          );
    case "graph-member-edit":
      if (isGraphMemberContext(authorization, target)) {
        return allow();
      }
      return authorization.principalId === null
        ? denyUnauthenticated(
            "auth.unauthenticated",
            `${describePredicateTarget(target)} requires an authenticated graph member write.`,
          )
        : deny(
            "policy.write.forbidden",
            `${describePredicateTarget(target)} requires graph-member write access.`,
          );
    case "capability":
      return allow();
    case "module-command":
      return intent === "command"
        ? allow()
        : deny(
            "policy.write.forbidden",
            `${describePredicateTarget(target)} requires a command-authorized write path.`,
          );
    case "authority":
      if (isAuthorityContext(authorization)) {
        return allow();
      }
      return authorization.principalId === null
        ? denyUnauthenticated(
            "auth.unauthenticated",
            `${describePredicateTarget(target)} requires an authority principal.`,
          )
        : deny(
            "policy.write.forbidden",
            `${describePredicateTarget(target)} requires authority access.`,
          );
    default: {
      const exhaustive: never = writeAudience;
      return exhaustive;
    }
  }
}

function evaluateRequiredCapabilities(input: {
  readonly capabilityKeys?: readonly PolicyCapabilityKey[];
  readonly requiredCapabilities?: readonly PolicyCapabilityKey[];
  readonly targetLabel: string;
  readonly missingCapabilityCode:
    | "policy.read.forbidden"
    | "policy.write.forbidden"
    | "policy.command.forbidden";
  readonly capabilityAudience: boolean;
}): AuthorizationDecision {
  const requiredCapabilities = input.requiredCapabilities ?? [];
  if (requiredCapabilities.length === 0) {
    return input.capabilityAudience
      ? deny(
          input.missingCapabilityCode,
          `${input.targetLabel} declares capability-gated access but no required capabilities were provided.`,
        )
      : allow();
  }

  const grantedCapabilities = new Set(input.capabilityKeys ?? []);
  const missingCapabilities = requiredCapabilities.filter(
    (capabilityKey) => !grantedCapabilities.has(capabilityKey),
  );
  if (missingCapabilities.length === 0) {
    return allow();
  }

  return deny(
    input.missingCapabilityCode,
    `${input.targetLabel} requires capabilities ${joinCapabilities(missingCapabilities)}.`,
  );
}

function writeScopeAllows(
  writeScope: AuthorizeWriteInput["writeScope"],
  requiredWriteScope: AuthorizeWriteInput["writeScope"],
): boolean {
  return writeScopeLevel[writeScope] >= writeScopeLevel[requiredWriteScope];
}

function getDeclaredTouchedPredicateIds(
  touchedPredicates: GraphCommandPolicy["touchesPredicates"],
): ReadonlySet<string> {
  return new Set<string>((touchedPredicates ?? []).map((target) => target.predicateId));
}

function wrapCommandWriteDecision(
  commandKey: string,
  target: AuthorizationCommandTouchedPredicate,
  decision: AuthorizationDecision,
): AuthorizationDecision {
  if (decision.allowed) return decision;
  if (decision.error.code === "auth.unauthenticated") {
    return decision;
  }

  return deny(
    "policy.command.forbidden",
    `Command "${commandKey}" is forbidden because ${describePredicateTarget(target)} denied command writes.`,
  );
}

/**
 * Evaluates graph-owned read policy for one predicate target.
 *
 * This helper fails closed when policy data is missing or malformed. It does
 * not refresh policy or capability snapshots on its own; callers are expected
 * to supply a current request-bound `AuthorizationContext`.
 */
export function authorizeRead(input: AuthorizeReadInput): AuthorizationDecision {
  const policy = validateTargetPolicy(input.target, "policy.read.forbidden");
  if ("allowed" in policy) {
    return policy;
  }

  if (input.sharedRead && policy.shareable && policy.transportVisibility === "replicated") {
    return allow();
  }

  const audienceDecision = evaluateReadAudience(
    input.authorization,
    input.target,
    policy.readAudience,
  );
  if (!audienceDecision.allowed) {
    return audienceDecision;
  }

  return evaluateRequiredCapabilities({
    capabilityKeys: input.capabilityKeys,
    requiredCapabilities: policy.requiredCapabilities,
    targetLabel: describePredicateTarget(input.target),
    missingCapabilityCode: "policy.read.forbidden",
    capabilityAudience: policy.readAudience === "capability",
  });
}

/**
 * Evaluates graph-owned write policy for one predicate target.
 *
 * Required write scope is enforced after audience and capability checks so
 * authority-only or command-only predicates fail closed when a narrower write
 * path attempts to mutate them.
 */
export function authorizeWrite(input: AuthorizeWriteInput): AuthorizationDecision {
  const policy = validateTargetPolicy(input.target, "policy.write.forbidden");
  if ("allowed" in policy) {
    return policy;
  }

  const intent = input.intent ?? "transaction";
  const audienceDecision = evaluateWriteAudience(
    input.authorization,
    input.target,
    policy.writeAudience,
    intent,
  );
  if (!audienceDecision.allowed) {
    return audienceDecision;
  }

  const capabilityDecision = evaluateRequiredCapabilities({
    capabilityKeys: input.capabilityKeys,
    requiredCapabilities: policy.requiredCapabilities,
    targetLabel: describePredicateTarget(input.target),
    missingCapabilityCode: "policy.write.forbidden",
    capabilityAudience: policy.writeAudience === "capability",
  });
  if (!capabilityDecision.allowed) {
    return capabilityDecision;
  }

  if (writeScopeAllows(input.writeScope, policy.requiredWriteScope)) {
    return allow();
  }

  return deny(
    "policy.write.forbidden",
    `${describePredicateTarget(input.target)} requires "${policy.requiredWriteScope}" writes.`,
  );
}

/**
 * Evaluates graph-owned command policy plus per-predicate write policy.
 *
 * Every declared touched predicate must be evaluated explicitly. Missing
 * touched predicates are denied so downstream authority paths cannot silently
 * skip protected writes.
 */
export function authorizeCommand(input: AuthorizeCommandInput): AuthorizationDecision {
  if (!input.commandPolicy) {
    return deny(
      "policy.command.forbidden",
      `Command "${input.commandKey}" is forbidden because no command policy was provided.`,
    );
  }

  const commandCapabilityDecision = evaluateRequiredCapabilities({
    capabilityKeys: input.capabilityKeys,
    requiredCapabilities: input.commandPolicy.capabilities,
    targetLabel: `Command "${input.commandKey}"`,
    missingCapabilityCode: "policy.command.forbidden",
    capabilityAudience: false,
  });
  if (!commandCapabilityDecision.allowed) {
    return commandCapabilityDecision;
  }

  const declaredTouchedPredicateIds = getDeclaredTouchedPredicateIds(
    input.commandPolicy.touchesPredicates,
  );
  const touchedPredicates = input.touchedPredicates ?? [];
  const seenPredicateIds = new Set<string>();

  for (const target of touchedPredicates) {
    seenPredicateIds.add(target.predicateId);
    if (!declaredTouchedPredicateIds.has(target.predicateId)) {
      return deny(
        "policy.command.forbidden",
        `Command "${input.commandKey}" is forbidden because predicate "${target.predicateId}" was not declared in the command policy.`,
      );
    }

    const writeDecision = authorizeWrite({
      authorization: input.authorization,
      capabilityKeys: input.capabilityKeys,
      target,
      writeScope: input.writeScope ?? "server-command",
      intent: "command",
    });
    if (!writeDecision.allowed) {
      return wrapCommandWriteDecision(input.commandKey, target, writeDecision);
    }
  }

  // Commands must supply policy data for every declared touched predicate so
  // later authority paths cannot silently skip a protected write.
  for (const predicateId of declaredTouchedPredicateIds) {
    if (seenPredicateIds.has(predicateId)) continue;
    return deny(
      "policy.command.forbidden",
      `Command "${input.commandKey}" is forbidden because touched predicate "${predicateId}" was not evaluated.`,
    );
  }

  return allow();
}
