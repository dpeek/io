import { shareSurfaceContractVersion, type PolicyVersion } from "@io/graph-authority";
import {
  type GraphFieldAuthority,
  fieldPolicyDescriptor,
  fieldPolicyFallbackContractVersion,
  resolveFieldPolicyDescriptor,
} from "@io/graph-kernel";
import { core } from "@io/graph-module-core";
import { workflow } from "@io/graph-module-workflow";

import { webAuthorityPolicyEvaluatorVersion } from "./policy-contract.js";

type PolicyFieldDefinition = {
  readonly key: string;
  readonly id?: string;
  readonly range: string;
  readonly cardinality: string;
  readonly authority?: GraphFieldAuthority;
};

type PolicyTypeDefinition = {
  readonly values?: {
    readonly key?: string;
    readonly id?: string;
  };
  readonly fields?: Record<string, unknown>;
};

type ResolvedPolicyDescriptor = Exclude<
  ReturnType<typeof resolveFieldPolicyDescriptor>,
  null | undefined
>;

type WebAppPolicyContractDescriptor = ResolvedPolicyDescriptor & {
  readonly source: "authored" | "fallback";
};

type WebAppPolicyContractSnapshot = {
  readonly descriptors: readonly WebAppPolicyContractDescriptor[];
  readonly fallbackDescriptorVersion: number;
  readonly shareSurfaceVersion: number;
  readonly evaluatorVersion: number;
};

const webAppPolicyGraph = { ...core, ...workflow } as const;
const webAppPolicyVersionBaselineHash = 148409173;

function isPolicyFieldDefinition(value: unknown): value is PolicyFieldDefinition {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PolicyFieldDefinition>;
  return (
    typeof candidate.key === "string" &&
    typeof candidate.range === "string" &&
    typeof candidate.cardinality === "string"
  );
}

function isPolicyTypeDefinition(value: unknown): value is PolicyTypeDefinition {
  if (!value || typeof value !== "object") return false;
  const candidate = value as PolicyTypeDefinition;
  return typeof candidate.values?.key === "string" && !!candidate.fields;
}

function collectPolicyDescriptors(
  tree: Record<string, unknown>,
  entries: WebAppPolicyContractDescriptor[] = [],
): WebAppPolicyContractDescriptor[] {
  for (const value of Object.values(tree)) {
    if (isPolicyFieldDefinition(value)) {
      const resolved = resolveFieldPolicyDescriptor(value);
      if (!resolved) continue;
      entries.push({
        ...resolved,
        ...(resolved.requiredCapabilities
          ? { requiredCapabilities: [...resolved.requiredCapabilities].sort() }
          : {}),
        source: fieldPolicyDescriptor(value) ? "authored" : "fallback",
      });
      continue;
    }

    if (!value || typeof value !== "object") continue;
    collectPolicyDescriptors(value as Record<string, unknown>, entries);
  }

  return entries;
}

export function createWebAppPolicyContractSnapshot(): WebAppPolicyContractSnapshot {
  const descriptors: WebAppPolicyContractDescriptor[] = [];
  for (const typeDef of Object.values(webAppPolicyGraph)) {
    if (!isPolicyTypeDefinition(typeDef)) continue;
    collectPolicyDescriptors(typeDef.fields ?? {}, descriptors);
  }
  descriptors.sort((left, right) => {
    if (left.predicateId !== right.predicateId) {
      return left.predicateId.localeCompare(right.predicateId);
    }
    return left.source.localeCompare(right.source);
  });

  return Object.freeze({
    descriptors,
    fallbackDescriptorVersion: fieldPolicyFallbackContractVersion,
    shareSurfaceVersion: shareSurfaceContractVersion,
    evaluatorVersion: webAuthorityPolicyEvaluatorVersion,
  });
}

export function createWebAppPolicyContractFingerprint(
  snapshot: WebAppPolicyContractSnapshot = createWebAppPolicyContractSnapshot(),
): string {
  return JSON.stringify(snapshot);
}

export function hashWebAppPolicyContractFingerprint(fingerprint: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < fingerprint.length; index += 1) {
    hash ^= fingerprint.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

export function deriveWebAppPolicyVersion(
  snapshot: WebAppPolicyContractSnapshot = createWebAppPolicyContractSnapshot(),
  baselineHash: number = webAppPolicyVersionBaselineHash,
): PolicyVersion {
  const fingerprint = createWebAppPolicyContractFingerprint(snapshot);
  const hash = hashWebAppPolicyContractFingerprint(fingerprint);
  if (hash === baselineHash) return 0;
  return (hash === 0 ? 1 : hash) as PolicyVersion;
}

export const webAppPolicyContractSnapshot = createWebAppPolicyContractSnapshot();
export const webAppPolicyContractFingerprint = createWebAppPolicyContractFingerprint(
  webAppPolicyContractSnapshot,
);

/**
 * Authoritative policy snapshot version for the current single-graph web
 * proof. The Worker auth bridge and the authority runtime must import the same
 * value so request projection and stale-context enforcement evaluate against
 * one compiled policy contract.
 *
 * The current proof derives this number from one explicit contract snapshot:
 * resolved predicate policies for the shipped web graph plus explicit epoch
 * components for fallback-policy lowering, share-surface validation/lowering,
 * and authority evaluator semantics. Do not advance this for ordinary graph
 * data writes, Better Auth session churn, or principal/grant mutations.
 */
export const webAppPolicyVersion: PolicyVersion = deriveWebAppPolicyVersion(
  webAppPolicyContractSnapshot,
);
