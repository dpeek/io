import type { TypeModuleFilter } from "@io/graph-module";
import { defineValidatedStringTypeModule } from "@io/graph-module";

import { defineCoreIconSeed } from "../icon/seed.js";

const emailIconSeed = defineCoreIconSeed("email", {
  name: "Email",
  svg: `<svg viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" fill="none" width="24" height="24" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <rect width="20" height="16" rx="2" x="2" y="4" />
  <path d="M22 7l-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
</svg>`,
});

const emailLocalPattern = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i;

const emailDomainPattern =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

export const emailDomainLabel = "example.com";

export const emailAddressLabel = "name@example.com";

export function parseEmail(raw: string): string {
  const value = raw.trim().toLowerCase();
  const [local, domain, ...rest] = value.split("@");
  if (!local || !domain || rest.length > 0) {
    throw new Error(`Invalid email value "${raw}"`);
  }
  if (!emailLocalPattern.test(local) || !emailDomainPattern.test(domain)) {
    throw new Error(`Invalid email value "${raw}"`);
  }
  return `${local}@${domain}`;
}

export function parseEmailQuery(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (!value) {
    throw new Error("Email filter value cannot be empty");
  }
  return value;
}

export function parseEmailDomain(raw: string): string {
  const value = raw.trim().toLowerCase().replace(/^@+/, "");
  if (!emailDomainPattern.test(value)) {
    throw new Error(`Invalid email domain "${raw}"`);
  }
  return value;
}

export const emailFilter = {
  defaultOperator: "contains",
  operators: {
    equals: {
      label: "Equals",
      operand: {
        kind: "string",
        placeholder: emailAddressLabel,
      },
      parse: parseEmail,
      format: (operand: string) => operand,
      test: (value: string, operand: string) => value === operand,
    },
    contains: {
      label: "Contains",
      operand: {
        kind: "string",
        placeholder: emailDomainLabel,
      },
      parse: parseEmailQuery,
      format: (operand: string) => operand,
      test: (value: string, operand: string) => value.includes(operand),
    },
    domain: {
      label: "Domain",
      operand: {
        kind: "string",
        placeholder: emailDomainLabel,
      },
      parse: parseEmailDomain,
      format: (operand: string) => operand,
      test: (value: string, operand: string) => value.endsWith(`@${operand}`),
    },
  },
} satisfies TypeModuleFilter<string>;

export const emailTypeModule = defineValidatedStringTypeModule({
  values: { key: "core:email", name: "Email", icon: emailIconSeed },
  parse: parseEmail,
  filter: emailFilter,
  placeholder: emailAddressLabel,
  inputType: "email",
  inputMode: "email",
  autocomplete: "email",
});

export const emailType = emailTypeModule.type;
