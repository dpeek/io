import type { TypeModuleFilter } from "../../../graph/type-module.js";
import {
  emailAddressLabel,
  emailDomainLabel,
  parseEmail,
  parseEmailDomain,
  parseEmailQuery,
} from "./parse.js";

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
