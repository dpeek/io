"use client";

import { GraphValidationError } from "@io/core/graph";
import { PredicateFieldEditor } from "@io/core/graph/adapters/react-dom";
import { topicKind } from "@io/core/graph/modules/pkm/topic";
import {
  performValidatedMutation,
  usePersistedMutationCallbacks,
  usePredicateField,
  type MutationCallbacks,
} from "@io/core/graph/runtime/react";
import { Badge } from "@io/web/badge";
import { Button } from "@io/web/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@io/web/card";
import { Input } from "@io/web/input";
import { ScrollArea } from "@io/web/scroll-area";
import { cn } from "@io/web/utils";
import { FileText, Plus, Search } from "lucide-react";
import {
  startTransition,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { GraphAccessGate } from "./auth-shell.js";
import {
  GraphRuntimeBootstrap,
  useGraphRuntime,
  type GraphRuntime,
} from "./graph-runtime-bootstrap";

type TopicRef = ReturnType<GraphRuntime["graph"]["topic"]["ref"]>;
type TopicSnapshot = ReturnType<GraphRuntime["graph"]["topic"]["get"]>;
type TagSnapshot = ReturnType<GraphRuntime["graph"]["tag"]["get"]>;

const topicKindValues = [
  topicKind.values.module,
  topicKind.values.concept,
  topicKind.values.workflow,
  topicKind.values.decision,
  topicKind.values.runbook,
  topicKind.values.note,
] as const;

const topicSelectClassName =
  "border-input bg-background text-foreground h-9 w-full rounded-xl border px-3 text-sm shadow-sm outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30";

function resolvedEnumValue(value: { id?: string; key: string }): string {
  return value.id ?? value.key;
}

function useRuntimeRevision(runtime: GraphRuntime): string {
  return useSyncExternalStore(
    runtime.sync.subscribe,
    () =>
      [
        runtime.store.version(),
        runtime.sync.getPendingTransactions().length,
        runtime.sync.getState().cursor ?? "",
      ].join(":"),
    () => "server",
  );
}

function formatMutationError(error: unknown): string {
  if (error instanceof GraphValidationError) {
    return error.result.issues[0]?.message ?? error.message;
  }
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "The graph mutation failed.";
}

function createTopicName(existingCount: number): string {
  return `Untitled Topic ${existingCount + 1}`;
}

function topicKindLabel(kindId: string | undefined): string {
  if (!kindId) return "Unknown";
  return (
    topicKindValues.find((value) => resolvedEnumValue(value) === kindId)?.name ??
    kindId.split(":").at(-1) ??
    kindId
  );
}

function topicExcerpt(content: string | undefined): string {
  if (!content) return "No content yet.";
  const compact = content.replace(/\s+/g, " ").trim();
  if (compact.length === 0) return "No content yet.";
  return compact.length > 96 ? `${compact.slice(0, 93)}...` : compact;
}

function sortTopics(left: TopicSnapshot, right: TopicSnapshot): number {
  if (left.order !== right.order) return left.order - right.order;
  return left.name.localeCompare(right.name);
}

function sortTags(left: TagSnapshot, right: TagSnapshot): number {
  return left.name.localeCompare(right.name);
}

function TopicListItem({
  active,
  onSelect,
  topic,
}: {
  active: boolean;
  onSelect(): void;
  topic: TopicSnapshot;
}) {
  return (
    <button
      className={cn(
        "w-full rounded-[1.25rem] border px-3 py-3 text-left transition",
        active
          ? "border-primary/30 bg-primary/8 shadow-sm"
          : "border-border/70 bg-card/70 hover:border-primary/20 hover:bg-card",
      )}
      data-topic-item={topic.id}
      onClick={onSelect}
      type="button"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{topic.name}</div>
          <div className="text-muted-foreground mt-1 text-xs">{topicExcerpt(topic.content)}</div>
        </div>
        <Badge variant="outline">{topicKindLabel(topic.kind)}</Badge>
      </div>

      <div className="text-muted-foreground mt-3 flex flex-wrap gap-2 text-[11px] tracking-[0.14em] uppercase">
        <span>{topic.tags.length} tags</span>
        <span>order {topic.order}</span>
      </div>
    </button>
  );
}

function FieldBlock({
  children,
  description,
  label,
  props,
}: {
  children: ReactNode;
  description?: string;
  label: string;
  props?: Record<string, string>;
}) {
  return (
    <div className="space-y-2" {...props}>
      <div>
        <div className="text-sm font-medium">{label}</div>
        {description ? <div className="text-muted-foreground text-xs">{description}</div> : null}
      </div>
      {children}
    </div>
  );
}

function TopicTagsCard({
  callbacks,
  runtime,
  tags,
  topic,
}: {
  callbacks: MutationCallbacks;
  runtime: GraphRuntime;
  tags: readonly TagSnapshot[];
  topic: TopicRef;
}) {
  const { value } = usePredicateField(topic.fields.tags);
  const selectedTagIds = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
  const selectedTags = tags.filter((tag) => selectedTagIds.includes(tag.id));
  const previousSelectedTagIdsRef = useRef(selectedTagIds);
  const [activeTagId, setActiveTagId] = useState(selectedTagIds[0] ?? "");

  useEffect(() => {
    if (selectedTagIds.includes(activeTagId)) return;
    setActiveTagId(selectedTagIds[0] ?? "");
  }, [activeTagId, selectedTagIds]);

  useEffect(() => {
    const previousSelectedTagIds = previousSelectedTagIdsRef.current;
    const addedTagId = selectedTagIds.find((tagId) => !previousSelectedTagIds.includes(tagId));
    previousSelectedTagIdsRef.current = selectedTagIds;
    if (!addedTagId) return;
    setActiveTagId(addedTagId);
  }, [selectedTagIds]);

  const activeTag = activeTagId ? runtime.graph.tag.ref(activeTagId) : null;

  return (
    <Card className="border-border/70 bg-card/95 border shadow-sm">
      <CardHeader>
        <CardTitle>Tags</CardTitle>
        <CardDescription>
          Reuse existing tags or create new ones inline. Editing a tag updates every topic that
          references it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2" data-topic-selected-tags="">
          {selectedTags.length > 0 ? (
            selectedTags.map((tag) => (
              <button
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition",
                  activeTagId === tag.id ? "shadow-sm" : "opacity-85",
                )}
                data-topic-selected-tag={tag.id}
                key={tag.id}
                onClick={() => setActiveTagId(tag.id)}
                style={{
                  backgroundColor: `${tag.color}14`,
                  borderColor: tag.color,
                  color: tag.color,
                }}
                type="button"
              >
                {tag.name}
              </button>
            ))
          ) : (
            <div className="border-border bg-muted/20 text-muted-foreground rounded-[1rem] border border-dashed px-4 py-3 text-sm">
              No tags assigned.
            </div>
          )}
        </div>

        <div data-topic-tag-combobox={topic.id}>
          <PredicateFieldEditor
            onMutationError={callbacks.onMutationError}
            onMutationSuccess={callbacks.onMutationSuccess}
            predicate={topic.fields.tags}
          />
        </div>

        {activeTag ? (
          <div className="border-border/70 bg-muted/10 rounded-[1.25rem] border p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">Selected tag</div>
                <div className="text-muted-foreground text-xs">
                  Adjust shared tag metadata directly from the topic editor.
                </div>
              </div>
              <Button
                onClick={() => {
                  performValidatedMutation(
                    callbacks,
                    () => topic.fields.tags.validateRemove(activeTag.id),
                    () => {
                      topic.fields.tags.remove(activeTag.id);
                      return true;
                    },
                  );
                }}
                type="button"
                variant="outline"
              >
                Remove from topic
              </Button>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <FieldBlock label="Name" props={{ "data-topic-tag-field": "name" }}>
                <PredicateFieldEditor
                  onMutationError={callbacks.onMutationError}
                  onMutationSuccess={callbacks.onMutationSuccess}
                  predicate={activeTag.fields.name}
                />
              </FieldBlock>
              <FieldBlock label="Key" props={{ "data-topic-tag-field": "key" }}>
                <PredicateFieldEditor
                  onMutationError={callbacks.onMutationError}
                  onMutationSuccess={callbacks.onMutationSuccess}
                  predicate={activeTag.fields.key}
                />
              </FieldBlock>
              <FieldBlock label="Color" props={{ "data-topic-tag-field": "color" }}>
                <PredicateFieldEditor
                  onMutationError={callbacks.onMutationError}
                  onMutationSuccess={callbacks.onMutationSuccess}
                  predicate={activeTag.fields.color}
                />
              </FieldBlock>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function TopicMetadataCard({
  callbacks,
  topic,
}: {
  callbacks: MutationCallbacks;
  topic: TopicRef;
}) {
  return (
    <Card className="border-border/70 bg-card/95 border shadow-sm">
      <CardHeader>
        <CardTitle>Metadata</CardTitle>
        <CardDescription>
          Edit graph-backed topic metadata directly against predicate refs.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-2">
        <FieldBlock label="Name" props={{ "data-topic-field": "name" }}>
          <PredicateFieldEditor
            onMutationError={callbacks.onMutationError}
            onMutationSuccess={callbacks.onMutationSuccess}
            predicate={topic.fields.name}
          />
        </FieldBlock>
        <FieldBlock label="Kind" props={{ "data-topic-field": "kind" }}>
          <PredicateFieldEditor
            onMutationError={callbacks.onMutationError}
            onMutationSuccess={callbacks.onMutationSuccess}
            predicate={topic.fields.kind}
          />
        </FieldBlock>
        <FieldBlock label="Label" props={{ "data-topic-field": "label" }}>
          <PredicateFieldEditor
            onMutationError={callbacks.onMutationError}
            onMutationSuccess={callbacks.onMutationSuccess}
            predicate={topic.fields.label}
          />
        </FieldBlock>
        <FieldBlock label="Slug" props={{ "data-topic-field": "slug" }}>
          <PredicateFieldEditor
            onMutationError={callbacks.onMutationError}
            onMutationSuccess={callbacks.onMutationSuccess}
            predicate={topic.fields.slug}
          />
        </FieldBlock>
        <FieldBlock
          description="Lower numbers float toward the top of the list."
          label="Order"
          props={{ "data-topic-field": "order" }}
        >
          <PredicateFieldEditor
            onMutationError={callbacks.onMutationError}
            onMutationSuccess={callbacks.onMutationSuccess}
            predicate={topic.fields.order}
          />
        </FieldBlock>
        <FieldBlock label="Parent" props={{ "data-topic-field": "parent" }}>
          <PredicateFieldEditor
            onMutationError={callbacks.onMutationError}
            onMutationSuccess={callbacks.onMutationSuccess}
            predicate={topic.fields.parent}
          />
        </FieldBlock>
        <FieldBlock
          description="Short plain-text summary for list views and secondary context."
          label="Description"
          props={{ "data-topic-field": "description" }}
        >
          <PredicateFieldEditor
            onMutationError={callbacks.onMutationError}
            onMutationSuccess={callbacks.onMutationSuccess}
            predicate={topic.fields.description}
          />
        </FieldBlock>
      </CardContent>
    </Card>
  );
}

function TopicContentCard({ callbacks, topic }: { callbacks: MutationCallbacks; topic: TopicRef }) {
  return (
    <Card className="border-border/70 bg-card/95 border shadow-sm">
      <CardHeader>
        <CardTitle>Content</CardTitle>
        <CardDescription>
          Write markdown source on the left and review the rendered preview on the right.
        </CardDescription>
      </CardHeader>
      <CardContent data-topic-field="content">
        <PredicateFieldEditor
          onMutationError={callbacks.onMutationError}
          onMutationSuccess={callbacks.onMutationSuccess}
          predicate={topic.fields.content}
        />
      </CardContent>
    </Card>
  );
}

function TopicInspector({
  callbacks,
  runtime,
  tags,
  topic,
}: {
  callbacks: MutationCallbacks;
  runtime: GraphRuntime;
  tags: readonly TagSnapshot[];
  topic: TopicRef;
}) {
  const { value: content } = usePredicateField(topic.fields.content);
  const { value: kindId } = usePredicateField(topic.fields.kind);
  const { value: name } = usePredicateField(topic.fields.name);
  const { value: tagIds } = usePredicateField(topic.fields.tags);
  const selectedTagCount = Array.isArray(tagIds) ? tagIds.length : 0;

  return (
    <div className="space-y-4" data-topic-selected={topic.id}>
      <Card className="border-border/70 bg-card/95 border shadow-sm">
        <CardHeader className="border-border/60 border-b bg-[linear-gradient(135deg,rgba(14,165,233,0.14),transparent_55%),linear-gradient(180deg,rgba(15,23,42,0.02),transparent)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="text-xs font-medium tracking-[0.18em] text-sky-700 uppercase">
                Topic editor
              </div>
              <CardTitle className="text-2xl">
                {typeof name === "string" ? name : topic.id}
              </CardTitle>
              <CardDescription className="max-w-3xl">
                {topicExcerpt(typeof content === "string" ? content : "")}
              </CardDescription>
            </div>

            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">
                {topicKindLabel(typeof kindId === "string" ? kindId : undefined)}
              </Badge>
              <Badge variant="outline">{selectedTagCount} tags</Badge>
              <Badge variant="outline">{topic.id}</Badge>
            </div>
          </div>
        </CardHeader>
      </Card>

      <TopicMetadataCard callbacks={callbacks} topic={topic} />
      <TopicTagsCard callbacks={callbacks} runtime={runtime} tags={tags} topic={topic} />
      <TopicContentCard callbacks={callbacks} topic={topic} />
    </div>
  );
}

export function TopicBrowserSurface({ runtime }: { runtime?: GraphRuntime }) {
  const resolvedRuntime = runtime ?? useGraphRuntime();
  useRuntimeRevision(resolvedRuntime);

  const [topicQuery, setTopicQuery] = useState("");
  const [kindFilter, setKindFilter] = useState("all");
  const [selectedTopicId, setSelectedTopicId] = useState("");
  const [mutationError, setMutationError] = useState<string | null>(null);
  const deferredTopicQuery = useDeferredValue(topicQuery.trim().toLowerCase());

  const topics = resolvedRuntime.graph.topic.list().sort(sortTopics);
  const tags = resolvedRuntime.graph.tag.list().sort(sortTags);
  const filteredTopics = topics.filter((topic) => {
    const matchesQuery =
      deferredTopicQuery.length === 0 ||
      [topic.name, topic.label, topic.slug, topic.content]
        .filter((value): value is string => typeof value === "string")
        .some((value) => value.toLowerCase().includes(deferredTopicQuery));
    const matchesKind = kindFilter === "all" || topic.kind === kindFilter;
    return matchesQuery && matchesKind;
  });

  useEffect(() => {
    if (filteredTopics.some((topic) => topic.id === selectedTopicId)) return;
    startTransition(() => {
      setSelectedTopicId(filteredTopics[0]?.id ?? topics[0]?.id ?? "");
    });
  }, [filteredTopics, selectedTopicId, topics]);

  const selectedTopic = selectedTopicId ? resolvedRuntime.graph.topic.ref(selectedTopicId) : null;
  const mutationCallbacks = usePersistedMutationCallbacks(
    {
      onMutationError(error) {
        setMutationError(formatMutationError(error));
      },
      onMutationSuccess() {
        setMutationError(null);
      },
    },
    { sync: resolvedRuntime.sync },
  );

  function handleCreateTopic(): void {
    const name = createTopicName(topics.length);
    const input = {
      content: `# ${name}\n\nDescribe the topic here.`,
      isArchived: false,
      kind: resolvedEnumValue(topicKind.values.note),
      name,
      order: topics.length,
    };
    let nextTopicId = "";

    const committed = performValidatedMutation(
      mutationCallbacks,
      () => resolvedRuntime.graph.topic.validateCreate(input),
      () => {
        nextTopicId = resolvedRuntime.graph.topic.create(input);
        return true;
      },
    );
    if (!committed || nextTopicId.length === 0) return;

    startTransition(() => {
      setKindFilter("all");
      setSelectedTopicId(nextTopicId);
      setTopicQuery("");
    });
  }

  return (
    <div className="topic-browser flex min-h-0 flex-1 flex-col gap-4">
      <Card className="border-border/70 bg-card/95 border shadow-sm">
        <CardHeader className="border-border/60 border-b bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.16),transparent_30%),radial-gradient(circle_at_top_right,rgba(249,115,22,0.14),transparent_28%)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="text-xs font-medium tracking-[0.18em] text-sky-700 uppercase">
                Knowledge base
              </div>
              <CardTitle className="text-2xl">Topics</CardTitle>
              <CardDescription className="max-w-2xl">
                Browse graph-backed topics, edit structured metadata, and write markdown content
                with a live rendered preview.
              </CardDescription>
            </div>

            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{topics.length} topics</Badge>
              <Badge variant="outline">{tags.length} tags</Badge>
              <Button data-topic-create="" onClick={handleCreateTopic} type="button">
                <Plus />
                New topic
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {mutationError ? (
        <div
          className="rounded-[1.25rem] border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-950"
          data-topic-error=""
        >
          {mutationError}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
        <Card className="border-border/70 bg-card/95 flex min-h-0 flex-col border shadow-sm">
          <CardHeader className="border-border/60 border-b">
            <div className="space-y-3">
              <label className="relative block">
                <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                <Input
                  className="pl-9"
                  data-topic-search=""
                  onChange={(event) => setTopicQuery(event.target.value)}
                  placeholder="Search topics"
                  value={topicQuery}
                />
              </label>

              <select
                className={topicSelectClassName}
                data-topic-kind-filter=""
                onChange={(event) => setKindFilter(event.target.value)}
                value={kindFilter}
              >
                <option value="all">All kinds</option>
                {topicKindValues.map((value) => (
                  <option key={resolvedEnumValue(value)} value={resolvedEnumValue(value)}>
                    {value.name}
                  </option>
                ))}
              </select>
            </div>
          </CardHeader>

          <CardContent className="flex min-h-0 flex-1 flex-col pt-3">
            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-2 pr-3">
                {filteredTopics.length > 0 ? (
                  filteredTopics.map((topic) => (
                    <TopicListItem
                      active={topic.id === selectedTopicId}
                      key={topic.id}
                      onSelect={() => {
                        startTransition(() => {
                          setSelectedTopicId(topic.id);
                        });
                      }}
                      topic={topic}
                    />
                  ))
                ) : (
                  <div className="border-border bg-muted/20 text-muted-foreground rounded-[1.25rem] border border-dashed px-4 py-6 text-sm">
                    No topics match the current filter.
                  </div>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {selectedTopic ? (
          <ScrollArea className="min-h-0">
            <div className="pr-1">
              <TopicInspector
                callbacks={mutationCallbacks}
                runtime={resolvedRuntime}
                tags={tags}
                topic={selectedTopic}
              />
            </div>
          </ScrollArea>
        ) : (
          <Card className="border-border/70 bg-card/95 border shadow-sm">
            <CardHeader>
              <CardTitle>No topic selected</CardTitle>
              <CardDescription>
                Create the first topic to start building a graph-backed knowledge base.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button data-topic-create-empty="" onClick={handleCreateTopic} type="button">
                <FileText />
                Create topic
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

export function TopicBrowserPage() {
  return (
    <GraphAccessGate
      description="Resolve an authenticated Better Auth session before mounting the topic browser against the synced graph runtime."
      title="Sign in to open the topic browser"
    >
      <GraphRuntimeBootstrap>
        <TopicBrowserSurface />
      </GraphRuntimeBootstrap>
    </GraphAccessGate>
  );
}
