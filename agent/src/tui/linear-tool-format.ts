function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function truncateInlineText(text: string, maxLength = 120) {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function formatInlineValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    const compact = value.replace(/\s+/g, " ").trim();
    return compact ? truncateInlineText(compact) : undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const items = value
      .map((item) => formatInlineValue(item))
      .filter((item): item is string => Boolean(item));
    return items.length ? truncateInlineText(items.join(", ")) : undefined;
  }
  return undefined;
}

type LinearToolStatus = "completed" | "failed" | "running";

type LinearToolConfig = {
  action: (argumentsRecord: Record<string, unknown> | undefined) => {
    failed: string;
    label: string;
    past: string;
  };
  detailKeys: string[];
  nestedKeys: string[];
  noun: string;
  targetKeys: string[];
};

const LINEAR_TOOL_CONFIG: Record<string, LinearToolConfig> = {
  create_attachment: {
    action: () => ({ failed: "create failed", label: "create", past: "created" }),
    detailKeys: ["issue", "filename", "title", "subtitle", "attachmentId", "id", "url"],
    nestedKeys: ["attachment", "issue"],
    noun: "attachment",
    targetKeys: ["issue", "filename", "title", "attachmentId", "id"],
  },
  create_document: {
    action: () => ({ failed: "create failed", label: "create", past: "created" }),
    detailKeys: ["title", "issue", "project", "icon", "documentId", "id", "url"],
    nestedKeys: ["document", "issue", "project"],
    noun: "document",
    targetKeys: ["title", "documentId", "id", "issue", "project"],
  },
  save_comment: {
    action: (argumentsRecord) =>
      argumentsRecord?.id
        ? { failed: "update failed", label: "update", past: "updated" }
        : { failed: "create failed", label: "create", past: "created" },
    detailKeys: ["issueId", "id", "commentId", "parentId", "body", "url"],
    nestedKeys: ["comment", "issue"],
    noun: "comment",
    targetKeys: ["issueId", "commentId", "id", "parentId"],
  },
  save_issue: {
    action: (argumentsRecord) =>
      argumentsRecord?.id
        ? { failed: "update failed", label: "update", past: "updated" }
        : { failed: "create failed", label: "create", past: "created" },
    detailKeys: [
      "identifier",
      "title",
      "state",
      "priority",
      "project",
      "assignee",
      "labels",
      "dueDate",
      "url",
    ],
    nestedKeys: ["issue", "state", "project", "assignee"],
    noun: "issue",
    targetKeys: ["identifier", "id", "title"],
  },
  update_document: {
    action: () => ({ failed: "update failed", label: "update", past: "updated" }),
    detailKeys: ["title", "id", "documentId", "issue", "project", "icon", "url"],
    nestedKeys: ["document", "issue", "project"],
    noun: "document",
    targetKeys: ["title", "documentId", "id", "issue", "project"],
  },
};

const FIELD_LABELS: Record<string, string> = {
  issueId: "issue",
  commentId: "comment",
  documentId: "document",
  attachmentId: "attachment",
  filename: "file",
  identifier: "issue",
};

function getCandidateRecords(
  primary: Record<string, unknown> | undefined,
  nestedKeys: readonly string[],
) {
  const records: Record<string, unknown>[] = [];
  if (primary) {
    records.push(primary);
    for (const key of nestedKeys) {
      const nested = asRecord(primary[key]);
      if (nested) {
        records.push(nested);
      }
    }
  }
  return records;
}

function pickFirstValue(records: readonly Record<string, unknown>[], keys: readonly string[]) {
  for (const key of keys) {
    for (const record of records) {
      if (record[key] === undefined || record[key] === null || record[key] === "") {
        continue;
      }
      return record[key];
    }
  }
  return undefined;
}

function buildDetailLines(
  records: readonly Record<string, unknown>[],
  keys: readonly string[],
) {
  const lines: string[] = [];
  const seenLabels = new Set<string>();

  for (const key of keys) {
    const value = pickFirstValue(records, [key]);
    const inlineValue = formatInlineValue(value);
    const label = FIELD_LABELS[key] ?? key;
    if (!inlineValue || seenLabels.has(label)) {
      continue;
    }
    seenLabels.add(label);
    lines.push(`${label}: ${inlineValue}`);
  }

  return lines;
}

export type LinearToolDisplaySummary = {
  detailLines: string[];
  summaryText: string;
};

export function summarizeLinearToolCall(options: {
  argumentsData?: unknown;
  resultData?: unknown;
  status: LinearToolStatus;
  tool?: string;
}) {
  const tool = options.tool ? LINEAR_TOOL_CONFIG[options.tool] : undefined;
  if (!tool) {
    return undefined;
  }

  const argumentsRecord = asRecord(options.argumentsData);
  const resultRecord = asRecord(options.resultData);
  const records = [
    ...getCandidateRecords(argumentsRecord, tool.nestedKeys),
    ...getCandidateRecords(resultRecord, tool.nestedKeys),
  ];
  const action = tool.action(argumentsRecord);
  const target = formatInlineValue(pickFirstValue(records, tool.targetKeys));
  const detailLines = buildDetailLines(records, tool.detailKeys);
  if (!target && !detailLines.length) {
    return undefined;
  }
  const summaryText =
    options.status === "running"
      ? `Linear ${tool.noun} ${action.label}${target ? `: ${target}` : ""}`
      : options.status === "failed"
        ? `Linear ${tool.noun} ${action.failed}${target ? `: ${target}` : ""}`
        : `Linear ${tool.noun} ${action.past}${target ? `: ${target}` : ""}`;

  return {
    detailLines,
    summaryText,
  } satisfies LinearToolDisplaySummary;
}
