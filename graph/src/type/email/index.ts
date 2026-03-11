import type { TypeModuleFilter } from "../../graph/type-module.js";
import { defineValidatedStringTypeModule } from "../validated-string.js";

const emailLocalPattern = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i;
const emailDomainLabel = "example.com";
const emailAddressLabel = "name@example.com";
const emailDomainPattern =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

function parseEmail(raw: string): string {
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

function parseEmailQuery(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (!value) {
    throw new Error("Email filter value cannot be empty");
  }
  return value;
}

function parseEmailDomain(raw: string): string {
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
  values: { key: "core:email", name: "Email" },
  parse: parseEmail,
  filter: emailFilter,
  placeholder: emailAddressLabel,
  inputType: "email",
  inputMode: "email",
  autocomplete: "email",
});

export const emailType = emailTypeModule.type;
