import { type GraphSecretFieldAuthority as RootGraphSecretFieldAuthority } from "@io/core/graph";
import type { GraphSecretFieldAuthority as RuntimeGraphSecretFieldAuthority } from "@io/core/graph/runtime";

import { core } from "./core.js";
import { isSecretBackedField } from "./schema.js";
import { defineSecretField } from "./type-module.js";

const secretField = defineSecretField({
  range: core.secretHandle,
  cardinality: "one?",
  revealCapability: "secret:reveal",
  rotateCapability: "secret:rotate",
});

void (secretField.authority.secret satisfies RootGraphSecretFieldAuthority);
void (secretField.authority.secret satisfies RuntimeGraphSecretFieldAuthority);

if (isSecretBackedField(secretField)) {
  void (secretField.authority.secret satisfies RootGraphSecretFieldAuthority);
  void secretField.authority.secret.revealCapability;
  void secretField.authority.secret.rotateCapability;

  // @ts-expect-error transport details stay out of the shared secret-field authority contract
  void secretField.authority.secret.command;
}

void ({
  kind: "sealed-handle",
  metadataVisibility: "replicated",
} satisfies RootGraphSecretFieldAuthority);

void ({
  kind: "sealed-handle",
  revealCapability: "secret:reveal",
  rotateCapability: "secret:rotate",
} satisfies RuntimeGraphSecretFieldAuthority);

void ({
  kind: "sealed-handle",
  // @ts-expect-error the shared secret-field contract does not encode transport wiring
  transport: "write-secret-field",
} satisfies RootGraphSecretFieldAuthority);
