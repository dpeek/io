import type {
  GraphCommandSpec as GraphCommandSpecFromRoot,
  ObjectViewSpec as ObjectViewSpecFromRoot,
  WorkflowSpec as WorkflowSpecFromRoot,
} from "../index.js";
import type { GraphCommandSpec, ObjectViewSpec, WorkflowSpec } from "./index.js";

const topicSummaryView = {
  key: "app:topic:summary",
  entity: "app:topic",
  titleField: "name",
  subtitleField: "kind",
  sections: [
    {
      key: "summary",
      title: "Summary",
      fields: [
        { path: "name", label: "Name", span: 2 },
        { path: "kind", label: "Kind" },
      ],
    },
  ],
  related: [
    {
      key: "references",
      title: "References",
      relationPath: "references",
      presentation: "list",
    },
  ],
  commands: ["app:topic:save"],
} satisfies ObjectViewSpec;

const topicReviewWorkflow = {
  key: "app:topic:review",
  label: "Review topic",
  description: "Review and update a topic.",
  subjects: ["app:topic"],
  steps: [
    {
      key: "review",
      title: "Review details",
      objectView: topicSummaryView.key,
    },
    {
      key: "save",
      title: "Save changes",
      command: "app:topic:save",
    },
  ],
  commands: ["app:topic:save"],
} satisfies WorkflowSpec;

const saveTopicCommand = {
  key: "app:topic:save",
  label: "Save topic",
  subject: "app:topic",
  execution: "optimisticVerify",
  input: {
    title: "Document graph explorer affordances",
  },
  output: {
    topicId: "topic-1",
  },
  policy: {
    capabilities: ["topic.write"],
    touchesPredicates: ["app:topic.name", "app:topic.content"],
  },
} satisfies GraphCommandSpec<{ title: string }, { topicId: string }>;

const rootObjectView: ObjectViewSpecFromRoot = topicSummaryView;
const rootWorkflow: WorkflowSpecFromRoot = topicReviewWorkflow;
const rootCommand: GraphCommandSpecFromRoot<{ title: string }, { topicId: string }> =
  saveTopicCommand;

void rootObjectView;
void rootWorkflow;
void rootCommand;

void ({
  key: "app:topic:summary",
  entity: "app:topic",
  sections: [
    {
      key: "summary",
      title: "Summary",
      fields: [
        {
          path: "name",
          // @ts-expect-error object view field spans are limited to one or two columns
          span: 3,
        },
      ],
    },
  ],
} satisfies ObjectViewSpec);

void ({
  key: "app:topic:review",
  label: "Review topic",
  description: "Review and update a topic.",
  subjects: ["app:topic"],
  steps: [
    {
      key: "review",
      title: "Review details",
      // @ts-expect-error workflow steps refer to object view keys, not numeric ids
      objectView: 123,
    },
  ],
} satisfies WorkflowSpec);

void ({
  key: "app:topic:save",
  label: "Save topic",
  // @ts-expect-error commands must use one of the supported execution modes
  execution: "eventual",
  input: {
    title: "Document graph explorer affordances",
  },
  output: {
    topicId: "topic-1",
  },
} satisfies GraphCommandSpec);
