import { defineScalar, defineScalarModule } from "@io/graph-module";

function parseKitchenSinkScore(raw: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid kitchen sink score "${raw}"`);
  }
  return value;
}

function encodeKitchenSinkScore(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error("Kitchen sink score values must be finite.");
  }
  return String(value);
}

function formatKitchenSinkScore(value: number): string {
  return `${value}%`;
}

export const kitchenSinkScore = defineScalar({
  values: { key: "kitchen:score", name: "Kitchen Sink Score" },
  encode: encodeKitchenSinkScore,
  decode: parseKitchenSinkScore,
  validate: ({ value }) =>
    value >= 0 && value <= 100
      ? undefined
      : {
          code: "score.range",
          message: "Score must be between 0 and 100.",
        },
});

export const kitchenSinkScoreTypeModule = defineScalarModule({
  type: kitchenSinkScore,
  meta: {
    label: "Score",
    description: "Coverage score for kitchen sink fixtures.",
    searchable: false,
    summary: {
      kind: "value",
      format: formatKitchenSinkScore,
    },
    display: {
      kind: "text",
      allowed: ["text"] as const,
      format: formatKitchenSinkScore,
    },
    editor: {
      kind: "text",
      allowed: ["text"] as const,
      inputMode: "numeric",
      placeholder: "0-100",
      parse: parseKitchenSinkScore,
      format: (value) => String(value),
    },
  },
  filter: {
    defaultOperator: "gte",
    operators: {
      equals: {
        label: "Equals",
        operand: {
          kind: "number",
          inputMode: "numeric",
        },
        parse: parseKitchenSinkScore,
        format: (operand: number) => String(operand),
        test: (value: number, operand: number) => value === operand,
      },
      gte: {
        label: "At least",
        operand: {
          kind: "number",
          inputMode: "numeric",
        },
        parse: parseKitchenSinkScore,
        format: (operand: number) => String(operand),
        test: (value: number, operand: number) => value >= operand,
      },
      lte: {
        label: "At most",
        operand: {
          kind: "number",
          inputMode: "numeric",
        },
        parse: parseKitchenSinkScore,
        format: (operand: number) => String(operand),
        test: (value: number, operand: number) => value <= operand,
      },
    },
  },
});

export const kitchenSinkScalarSchema = {
  score: kitchenSinkScore,
} as const;
