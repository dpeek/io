export type WriteSecretFieldInput = {
  readonly entityId: string;
  readonly predicateId: string;
  readonly plaintext: string;
};

export type WriteSecretFieldResult = {
  readonly entityId: string;
  readonly predicateId: string;
  readonly secretId: string;
  readonly created: boolean;
  readonly rotated: boolean;
  readonly secretVersion: number;
};

export const secretFieldEntityIdRequiredMessage = "Entity id is required.";
export const secretFieldPredicateIdRequiredMessage = "Predicate id is required.";
export const secretFieldPlaintextRequiredMessage = "Secret value is required.";

function trimRequiredString(value: string): string {
  return value.trim();
}

function normalizeSecretLabel(fieldLabel: string): string {
  const trimmed = trimRequiredString(fieldLabel);
  if (trimmed.length === 0) return "secret";
  if (trimmed.toLowerCase().includes("secret")) return trimmed.toLowerCase();
  return `${trimmed} secret`;
}

export function buildSecretHandleName(entityLabel: string, fieldLabel: string): string {
  const subject = trimRequiredString(entityLabel);
  const secretLabel = normalizeSecretLabel(fieldLabel);
  if (subject.length === 0) return secretLabel;
  return `${subject} ${secretLabel}`;
}
