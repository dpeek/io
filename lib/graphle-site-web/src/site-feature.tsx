import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { GraphleShellErrorState, GraphleShellLoadingState } from "@dpeek/graphle-web-shell";
import type { GraphleShellFeature } from "@dpeek/graphle-web-shell";
import { Badge } from "@dpeek/graphle-web-ui/badge";
import { Button } from "@dpeek/graphle-web-ui/button";
import { Input } from "@dpeek/graphle-web-ui/input";
import { MarkdownRenderer } from "@dpeek/graphle-web-ui/markdown";
import { Textarea } from "@dpeek/graphle-web-ui/textarea";
import {
  EyeOffIcon,
  FilePlus2Icon,
  NewspaperIcon,
  RefreshCwIcon,
  SaveIcon,
  SendIcon,
} from "lucide-react";

import type {
  GraphleSitePage,
  GraphleSitePageInput,
  GraphleSitePost,
  GraphleSitePostInput,
  GraphleSitePublicationStatus,
  GraphleSiteStatusSnapshot,
} from "./status.js";

export type GraphleSiteStatusState =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly snapshot: GraphleSiteStatusSnapshot }
  | { readonly state: "error"; readonly message: string };

export interface GraphleSiteFeatureOptions {
  readonly status: GraphleSiteStatusState;
  readonly onRefresh?: () => void;
  readonly onCreatePage?: (input: GraphleSitePageInput) => Promise<void>;
  readonly onUpdatePage?: (id: string, input: GraphleSitePageInput) => Promise<void>;
  readonly onCreatePost?: (input: GraphleSitePostInput) => Promise<void>;
  readonly onUpdatePost?: (id: string, input: GraphleSitePostInput) => Promise<void>;
}

type SaveState =
  | { readonly kind: "idle" }
  | { readonly kind: "saving" }
  | { readonly kind: "error"; readonly message: string };

const defaultPageDraft: GraphleSitePageInput = {
  title: "Untitled page",
  path: "/about",
  body: "# Untitled page\n\nStart writing here.",
  status: "draft",
};

const defaultPostDraft: GraphleSitePostInput = {
  title: "Untitled post",
  slug: "untitled-post",
  body: "# Untitled post\n\nStart writing here.",
  excerpt: "A short summary for the post list.",
  status: "draft",
};

function pageDraft(page: GraphleSitePage): GraphleSitePageInput {
  return {
    title: page.title,
    path: page.path,
    body: page.body,
    status: page.status,
  };
}

function postDraft(post: GraphleSitePost): GraphleSitePostInput {
  return {
    title: post.title,
    slug: post.slug,
    body: post.body,
    excerpt: post.excerpt,
    status: post.status,
  };
}

function messageForError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function StatusBadge({ status }: { readonly status: GraphleSitePublicationStatus }) {
  return <Badge variant={status === "published" ? "default" : "outline"}>{status}</Badge>;
}

function RoutePreview({ snapshot }: { readonly snapshot: GraphleSiteStatusSnapshot }) {
  const route = snapshot.route;

  if (route.kind === "page") {
    return (
      <article className="graphle-site-preview-article" data-route-kind="page">
        <div className="graphle-site-preview-meta">
          <StatusBadge status={route.page.status} />
          <span>{route.page.path}</span>
        </div>
        <h2>{route.page.title}</h2>
        <MarkdownRenderer className="graphle-site-markdown" content={route.page.body} />
      </article>
    );
  }

  if (route.kind === "post") {
    return (
      <article className="graphle-site-preview-article" data-route-kind="post">
        <div className="graphle-site-preview-meta">
          <StatusBadge status={route.post.status} />
          <span>/posts/{route.post.slug}</span>
          {route.post.publishedAt ? <time>{route.post.publishedAt.slice(0, 10)}</time> : null}
        </div>
        <h2>{route.post.title}</h2>
        <p className="graphle-site-excerpt">{route.post.excerpt}</p>
        <MarkdownRenderer className="graphle-site-markdown" content={route.post.body} />
      </article>
    );
  }

  return (
    <article className="graphle-site-preview-article" data-route-kind="not-found">
      <div className="graphle-site-preview-meta">
        <Badge variant="outline">404</Badge>
        <span>{route.path}</span>
      </div>
      <h2>Page not found</h2>
      <p className="graphle-site-excerpt">{route.message}</p>
    </article>
  );
}

function Field({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <label className="graphle-site-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function StatusSelect({
  value,
  onChange,
}: {
  readonly value: GraphleSitePublicationStatus;
  readonly onChange: (value: GraphleSitePublicationStatus) => void;
}) {
  return (
    <select
      className="graphle-site-select"
      value={value}
      onChange={(event) =>
        onChange(event.currentTarget.value === "published" ? "published" : "draft")
      }
    >
      <option value="draft">Draft</option>
      <option value="published">Published</option>
    </select>
  );
}

function SaveError({ state }: { readonly state: SaveState }) {
  if (state.kind !== "error") return null;
  return <p className="graphle-site-save-error">{state.message}</p>;
}

function PageEditor({
  page,
  onSave,
}: {
  readonly page: GraphleSitePage;
  readonly onSave?: (id: string, input: GraphleSitePageInput) => Promise<void>;
}) {
  const [draft, setDraft] = useState<GraphleSitePageInput>(() => pageDraft(page));
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });

  useEffect(() => {
    setDraft(pageDraft(page));
    setSaveState({ kind: "idle" });
  }, [page]);

  async function save(input: GraphleSitePageInput) {
    if (!onSave) return;
    setSaveState({ kind: "saving" });
    try {
      await onSave(page.id, input);
    } catch (error) {
      setSaveState({ kind: "error", message: messageForError(error) });
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save(draft);
  }

  const publishing = draft.status === "published";

  return (
    <form className="graphle-site-editor" onSubmit={submit}>
      <div className="graphle-site-editor-heading">
        <h3>Edit page</h3>
        <StatusBadge status={draft.status} />
      </div>
      <Field label="Title">
        <Input
          value={draft.title}
          onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
        />
      </Field>
      <Field label="Path">
        <Input
          value={draft.path}
          onChange={(event) => setDraft((current) => ({ ...current, path: event.target.value }))}
        />
      </Field>
      <Field label="Status">
        <StatusSelect
          value={draft.status}
          onChange={(status) => setDraft((current) => ({ ...current, status }))}
        />
      </Field>
      <Field label="Body">
        <Textarea
          rows={12}
          value={draft.body}
          onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))}
        />
      </Field>
      <div className="graphle-site-editor-actions">
        <Button type="submit" disabled={saveState.kind === "saving"}>
          <SaveIcon aria-hidden={true} data-icon="inline-start" />
          Save
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={saveState.kind === "saving"}
          onClick={() =>
            void save({
              ...draft,
              status: publishing ? "draft" : "published",
            })
          }
        >
          {publishing ? (
            <EyeOffIcon aria-hidden={true} data-icon="inline-start" />
          ) : (
            <SendIcon aria-hidden={true} data-icon="inline-start" />
          )}
          {publishing ? "Unpublish" : "Publish"}
        </Button>
      </div>
      <SaveError state={saveState} />
    </form>
  );
}

function PostEditor({
  post,
  onSave,
}: {
  readonly post: GraphleSitePost;
  readonly onSave?: (id: string, input: GraphleSitePostInput) => Promise<void>;
}) {
  const [draft, setDraft] = useState<GraphleSitePostInput>(() => postDraft(post));
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });

  useEffect(() => {
    setDraft(postDraft(post));
    setSaveState({ kind: "idle" });
  }, [post]);

  async function save(input: GraphleSitePostInput) {
    if (!onSave) return;
    setSaveState({ kind: "saving" });
    try {
      await onSave(post.id, input);
    } catch (error) {
      setSaveState({ kind: "error", message: messageForError(error) });
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save(draft);
  }

  const publishing = draft.status === "published";

  return (
    <form className="graphle-site-editor" onSubmit={submit}>
      <div className="graphle-site-editor-heading">
        <h3>Edit post</h3>
        <StatusBadge status={draft.status} />
      </div>
      <Field label="Title">
        <Input
          value={draft.title}
          onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
        />
      </Field>
      <Field label="Slug">
        <Input
          value={draft.slug}
          onChange={(event) => setDraft((current) => ({ ...current, slug: event.target.value }))}
        />
      </Field>
      <Field label="Excerpt">
        <Textarea
          rows={3}
          value={draft.excerpt}
          onChange={(event) => setDraft((current) => ({ ...current, excerpt: event.target.value }))}
        />
      </Field>
      <Field label="Status">
        <StatusSelect
          value={draft.status}
          onChange={(status) => setDraft((current) => ({ ...current, status }))}
        />
      </Field>
      <Field label="Body">
        <Textarea
          rows={12}
          value={draft.body}
          onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))}
        />
      </Field>
      <div className="graphle-site-editor-actions">
        <Button type="submit" disabled={saveState.kind === "saving"}>
          <SaveIcon aria-hidden={true} data-icon="inline-start" />
          Save
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={saveState.kind === "saving"}
          onClick={() =>
            void save({
              ...draft,
              status: publishing ? "draft" : "published",
            })
          }
        >
          {publishing ? (
            <EyeOffIcon aria-hidden={true} data-icon="inline-start" />
          ) : (
            <SendIcon aria-hidden={true} data-icon="inline-start" />
          )}
          {publishing ? "Unpublish" : "Publish"}
        </Button>
      </div>
      <SaveError state={saveState} />
    </form>
  );
}

function CreatePageForm({
  initialPath,
  onCreate,
}: {
  readonly initialPath: string;
  readonly onCreate?: (input: GraphleSitePageInput) => Promise<void>;
}) {
  const initialDraft = useMemo(
    () => ({
      ...defaultPageDraft,
      path: initialPath,
    }),
    [initialPath],
  );
  const [draft, setDraft] = useState<GraphleSitePageInput>(initialDraft);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });

  useEffect(() => {
    setDraft(initialDraft);
    setSaveState({ kind: "idle" });
  }, [initialDraft]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onCreate) return;
    setSaveState({ kind: "saving" });
    try {
      await onCreate(draft);
    } catch (error) {
      setSaveState({ kind: "error", message: messageForError(error) });
    }
  }

  return (
    <form className="graphle-site-create-form" onSubmit={submit}>
      <h4>
        <FilePlus2Icon aria-hidden={true} />
        New page
      </h4>
      <Field label="Title">
        <Input
          value={draft.title}
          onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
        />
      </Field>
      <Field label="Path">
        <Input
          value={draft.path}
          onChange={(event) => setDraft((current) => ({ ...current, path: event.target.value }))}
        />
      </Field>
      <Button type="submit" disabled={saveState.kind === "saving"}>
        <FilePlus2Icon aria-hidden={true} data-icon="inline-start" />
        Create page
      </Button>
      <SaveError state={saveState} />
    </form>
  );
}

function CreatePostForm({
  onCreate,
}: {
  readonly onCreate?: (input: GraphleSitePostInput) => Promise<void>;
}) {
  const [draft, setDraft] = useState<GraphleSitePostInput>(defaultPostDraft);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onCreate) return;
    setSaveState({ kind: "saving" });
    try {
      await onCreate(draft);
    } catch (error) {
      setSaveState({ kind: "error", message: messageForError(error) });
    }
  }

  return (
    <form className="graphle-site-create-form" onSubmit={submit}>
      <h4>
        <NewspaperIcon aria-hidden={true} />
        New post
      </h4>
      <Field label="Title">
        <Input
          value={draft.title}
          onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
        />
      </Field>
      <Field label="Slug">
        <Input
          value={draft.slug}
          onChange={(event) => setDraft((current) => ({ ...current, slug: event.target.value }))}
        />
      </Field>
      <Field label="Excerpt">
        <Textarea
          rows={3}
          value={draft.excerpt}
          onChange={(event) => setDraft((current) => ({ ...current, excerpt: event.target.value }))}
        />
      </Field>
      <Button type="submit" disabled={saveState.kind === "saving"}>
        <NewspaperIcon aria-hidden={true} data-icon="inline-start" />
        Create post
      </Button>
      <SaveError state={saveState} />
    </form>
  );
}

function ContentLists({
  pages,
  posts,
}: {
  readonly pages: readonly GraphleSitePage[];
  readonly posts: readonly GraphleSitePost[];
}) {
  return (
    <div className="graphle-site-content-lists">
      <section>
        <h4>Pages</h4>
        <ul>
          {pages.map((page) => (
            <li key={page.id}>
              <a href={page.path}>{page.title}</a>
              <StatusBadge status={page.status} />
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h4>Posts</h4>
        <ul>
          {posts.map((post) => (
            <li key={post.id}>
              <a href={`/posts/${post.slug}`}>{post.title}</a>
              <StatusBadge status={post.status} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function InlineAuthoring({
  snapshot,
  onCreatePage,
  onUpdatePage,
  onCreatePost,
  onUpdatePost,
}: {
  readonly snapshot: GraphleSiteStatusSnapshot;
  readonly onCreatePage?: (input: GraphleSitePageInput) => Promise<void>;
  readonly onUpdatePage?: (id: string, input: GraphleSitePageInput) => Promise<void>;
  readonly onCreatePost?: (input: GraphleSitePostInput) => Promise<void>;
  readonly onUpdatePost?: (id: string, input: GraphleSitePostInput) => Promise<void>;
}) {
  if (!snapshot.session.authenticated) return null;

  const route = snapshot.route;
  const initialPath =
    route.kind === "not-found" && !route.path.startsWith("/posts/")
      ? route.path
      : defaultPageDraft.path;

  return (
    <aside className="graphle-site-authoring" aria-label="Inline authoring">
      {route.kind === "page" ? <PageEditor page={route.page} onSave={onUpdatePage} /> : null}
      {route.kind === "post" ? <PostEditor post={route.post} onSave={onUpdatePost} /> : null}
      <div className="graphle-site-create-grid">
        <CreatePageForm initialPath={initialPath} onCreate={onCreatePage} />
        <CreatePostForm onCreate={onCreatePost} />
      </div>
      <ContentLists pages={snapshot.pages} posts={snapshot.posts} />
    </aside>
  );
}

function GraphleSitePreview({
  status,
  onCreatePage,
  onUpdatePage,
  onCreatePost,
  onUpdatePost,
}: GraphleSiteFeatureOptions) {
  if (status.state === "loading") {
    return <GraphleShellLoadingState label="Loading site preview" />;
  }

  if (status.state === "error") {
    return <GraphleShellErrorState description={status.message} title="Site preview unavailable" />;
  }

  return (
    <div className="graphle-site-workspace">
      <section className="graphle-site-preview" aria-label="Website preview">
        <RoutePreview snapshot={status.snapshot} />
      </section>
      <InlineAuthoring
        snapshot={status.snapshot}
        onCreatePage={onCreatePage}
        onUpdatePage={onUpdatePage}
        onCreatePost={onCreatePost}
        onUpdatePost={onUpdatePost}
      />
    </div>
  );
}

function activePagePath(status: GraphleSiteStatusState): string {
  return status.state === "ready" ? status.snapshot.route.path : "/";
}

export function createGraphleSiteFeature(options: GraphleSiteFeatureOptions): GraphleShellFeature {
  return {
    id: "site",
    label: "Site",
    order: 10,
    navigation: [
      {
        id: "site.preview.nav",
        label: "Site",
        href: "/",
        order: 10,
      },
    ],
    commands: options.onRefresh
      ? [
          {
            id: "site.refresh-status",
            label: "Refresh",
            icon: RefreshCwIcon,
            order: 10,
            run: options.onRefresh,
          },
        ]
      : [],
    pages: [
      {
        id: "site.preview",
        label: "Site preview",
        path: activePagePath(options.status),
        order: 10,
        render: () => <GraphleSitePreview {...options} />,
      },
    ],
  };
}
