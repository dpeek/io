import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  compareSiteItems,
  siteItemSurface,
  siteItemViewSurface,
  type SiteIconPreset,
} from "@dpeek/graphle-module-site";
import { useGraphSyncState } from "@dpeek/graphle-react";
import { buildLiveEntitySurfacePlan, type AnyEntitySurfaceEntityRef } from "@dpeek/graphle-surface";
import {
  buildEntitySurfaceFieldSections,
  EntitySurface,
  EntitySurfaceFieldSections,
} from "@dpeek/graphle-surface/react-dom";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@dpeek/graphle-web-ui/alert-dialog";
import { Button } from "@dpeek/graphle-web-ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@dpeek/graphle-web-ui/dropdown-menu";
import { MarkdownRenderer } from "@dpeek/graphle-web-ui/markdown";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@dpeek/graphle-web-ui/sidebar";
import { TextTooltip, TooltipProvider } from "@dpeek/graphle-web-ui/tooltip";
import type { GraphleShellFeature } from "@dpeek/graphle-web-shell";
import {
  AtSignIcon,
  BookOpenIcon,
  Edit3Icon,
  ExternalLinkIcon,
  FileTextIcon,
  GithubIcon,
  GlobeIcon,
  LinkIcon,
  LinkedinIcon,
  MailIcon,
  MoonIcon,
  MoreHorizontalIcon,
  PlusIcon,
  RssIcon,
  SunIcon,
  Trash2Icon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";

import type { GraphleSiteGraphClient } from "./graph.js";
import {
  findGraphleSiteItemRef,
  listGraphleSiteItemViews,
  resolveGraphleSiteRoute,
  type GraphleSiteItemOrder,
  type GraphleSiteItemRef,
  type GraphleSiteItemView,
} from "./site-items.js";
import type { GraphleSiteRoute, GraphleSiteStatusSnapshot } from "./status.js";
import { useGraphleSiteTheme } from "./theme.js";

export type GraphleSiteStatusState =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly snapshot: GraphleSiteStatusSnapshot }
  | { readonly state: "error"; readonly message: string };

export interface GraphleSiteFeatureOptions {
  readonly path?: string;
  readonly runtime?: GraphleSiteGraphClient | null;
  readonly status: GraphleSiteStatusState;
  readonly onCreateBlankItem?: () => Promise<GraphleSiteItemView>;
  readonly onDeleteItem?: (id: string) => Promise<void>;
  readonly onNavigatePath?: (path: string) => Promise<void> | void;
  readonly onRefresh?: () => void;
  readonly onReorderItems?: (items: readonly GraphleSiteItemOrder[]) => Promise<void>;
}

const iconByPreset = {
  book: BookOpenIcon,
  email: MailIcon,
  github: GithubIcon,
  link: LinkIcon,
  linkedin: LinkedinIcon,
  note: FileTextIcon,
  rss: RssIcon,
  website: GlobeIcon,
  x: XIcon,
} satisfies Record<SiteIconPreset, LucideIcon>;

function messageForError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function iconForItem(item: GraphleSiteItemView): LucideIcon {
  return item.icon ? iconByPreset[item.icon] : AtSignIcon;
}

function canRenderPortaledUi(): boolean {
  return typeof document !== "undefined";
}

function SiteIconTooltip({
  children,
  text,
}: {
  readonly children: ReactNode;
  readonly text: string;
}) {
  if (!canRenderPortaledUi()) return <>{children}</>;
  return <TextTooltip text={text}>{children}</TextTooltip>;
}

function LoadingSurface() {
  return (
    <main
      className="grid min-h-svh place-content-center gap-3 bg-background p-8 text-center text-foreground [&>*]:m-0"
      aria-busy="true"
    >
      <p>Loading</p>
    </main>
  );
}

function ErrorSurface({ message }: { readonly message: string }) {
  return (
    <main
      className="grid min-h-svh place-content-center gap-3 bg-background p-8 text-center text-foreground [&>*]:m-0"
      role="alert"
    >
      <h1>Site unavailable</h1>
      <p>{message}</p>
    </main>
  );
}

function RouteView({
  itemRef,
  route,
}: {
  readonly itemRef?: GraphleSiteItemRef;
  readonly route: GraphleSiteRoute;
}) {
  if (route.kind !== "item") {
    return (
      <article className="flex flex-col gap-4" data-route-kind="not-found">
        <h1>Page not found</h1>
        <p className="text-muted-foreground">{route.message}</p>
      </article>
    );
  }

  if (itemRef) return <GraphBackedItemView entity={itemRef} />;

  return <ItemView item={route.item} />;
}

function GraphBackedItemView({ entity }: { readonly entity: GraphleSiteItemRef }) {
  const surfaceEntity = entity as unknown as AnyEntitySurfaceEntityRef;
  const surfacePlan = useMemo(
    () =>
      buildLiveEntitySurfacePlan(surfaceEntity, {
        mode: "view",
        surface: siteItemViewSurface,
      }),
    [surfaceEntity],
  );
  const sections = useMemo(() => buildEntitySurfaceFieldSections(surfacePlan), [surfacePlan]);

  return (
    <article className="flex flex-col gap-4" data-route-kind="item">
      <EntitySurfaceFieldSections chrome={false} mode="view" sections={sections} />
    </article>
  );
}

function ItemView({ item }: { readonly item: GraphleSiteItemView }) {
  const body = item.body?.trim();

  return (
    <article className="flex flex-col gap-4" data-route-kind="item">
      {body ? (
        <MarkdownRenderer content={body} />
      ) : (
        <>
          <h1>{item.title}</h1>
          {item.url ? (
            <a href={item.url} rel="noreferrer" target="_blank">
              <ExternalLinkIcon aria-hidden={true} />
              <span>{item.url}</span>
            </a>
          ) : null}
          {item.tags.length ? (
            <p className="text-muted-foreground">{item.tags.map((tag) => tag.name).join(", ")}</p>
          ) : null}
        </>
      )}
    </article>
  );
}

function ItemEditor({
  entity,
  runtime,
}: {
  readonly entity: GraphleSiteItemRef;
  readonly runtime: GraphleSiteGraphClient;
}) {
  return (
    <EntitySurface
      entity={entity as unknown as AnyEntitySurfaceEntityRef}
      mode="edit"
      mutationRuntime={runtime}
      sectionChrome={true}
      showModeToggle={false}
      surface={siteItemSurface}
    />
  );
}

function selectedContentItem({
  editItemId,
  items,
  route,
}: {
  readonly editItemId: string | null;
  readonly items: readonly GraphleSiteItemView[];
  readonly route: GraphleSiteRoute;
}): GraphleSiteItemView | undefined {
  if (editItemId) return items.find((item) => item.id === editItemId);
  return route.kind === "item" ? route.item : undefined;
}

export function buildGraphleSiteOrderPayload(
  items: readonly GraphleSiteItemView[],
): readonly GraphleSiteItemOrder[] {
  return items.map((item, index) => ({
    id: item.id,
    sortOrder: index,
  }));
}

function SortableItemRow({
  active,
  authenticated,
  item,
  onDelete,
  onEdit,
  onNavigate,
}: {
  readonly active: boolean;
  readonly authenticated: boolean;
  readonly item: GraphleSiteItemView;
  readonly onDelete: (item: GraphleSiteItemView) => void;
  readonly onEdit: (item: GraphleSiteItemView) => void;
  readonly onNavigate: (item: GraphleSiteItemView, event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({
    id: item.id,
    disabled: !authenticated,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  } satisfies CSSProperties;
  const Icon = iconForItem(item);
  const external = !item.path && Boolean(item.url);
  const href = item.path ?? item.url ?? "#";

  return (
    <SidebarMenuItem
      className="min-w-0 data-[dragging=true]:opacity-70"
      data-dragging={isDragging ? "true" : undefined}
      ref={setNodeRef}
      style={style}
    >
      <SidebarMenuButton
        className="min-w-0"
        isActive={active}
        {...(authenticated ? attributes : {})}
        {...(authenticated ? listeners : {})}
        render={
          <a
            href={href}
            onClick={(event) => onNavigate(item, event)}
            rel={external ? "noreferrer" : undefined}
            target={external ? "_blank" : undefined}
          />
        }
        tooltip={canRenderPortaledUi() ? item.title : undefined}
      >
        <Icon aria-hidden={true} />
        <span>{item.title}</span>
      </SidebarMenuButton>
      {authenticated && canRenderPortaledUi() ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Actions for ${item.title}`}
            render={<SidebarMenuAction showOnHover={true} />}
          >
            <MoreHorizontalIcon aria-hidden={true} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => onEdit(item)}>
                <Edit3Icon aria-hidden={true} />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDelete(item)} variant="destructive">
                <Trash2Icon aria-hidden={true} />
                Delete
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : authenticated ? (
        <SidebarMenuAction aria-label={`Actions for ${item.title}`} showOnHover={true}>
          <MoreHorizontalIcon aria-hidden={true} />
        </SidebarMenuAction>
      ) : null}
    </SidebarMenuItem>
  );
}

function ItemSidebar({
  activeItemId,
  authenticated,
  items,
  onCreate,
  onDelete,
  onEdit,
  onNavigate,
  onReorder,
}: {
  readonly activeItemId?: string;
  readonly authenticated: boolean;
  readonly items: readonly GraphleSiteItemView[];
  readonly onCreate: () => void;
  readonly onDelete: (item: GraphleSiteItemView) => void;
  readonly onEdit: (item: GraphleSiteItemView) => void;
  readonly onNavigate: (item: GraphleSiteItemView, event: MouseEvent<HTMLAnchorElement>) => void;
  readonly onReorder?: (items: readonly GraphleSiteItemOrder[]) => Promise<void>;
}) {
  const sortedItems = useMemo(() => [...items].sort(compareSiteItems), [items]);
  const [orderedIds, setOrderedIds] = useState<readonly string[]>(() =>
    sortedItems.map((item) => item.id),
  );
  const [reorderError, setReorderError] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    setOrderedIds(sortedItems.map((item) => item.id));
  }, [sortedItems]);

  const renderIds = [
    ...orderedIds,
    ...sortedItems.map((item) => item.id).filter((id) => !orderedIds.includes(id)),
  ];
  const sortedByLocalOrder = renderIds
    .map((id) => sortedItems.find((item) => item.id === id))
    .filter((item): item is GraphleSiteItemView => Boolean(item));

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = renderIds.indexOf(String(active.id));
    const newIndex = renderIds.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;

    const nextIds = arrayMove([...renderIds], oldIndex, newIndex);
    setOrderedIds(nextIds);
    setReorderError("");
    const nextItems = nextIds
      .map((id) => sortedItems.find((item) => item.id === id))
      .filter((item): item is GraphleSiteItemView => Boolean(item));
    try {
      await onReorder?.(buildGraphleSiteOrderPayload(nextItems));
    } catch (error) {
      setReorderError(messageForError(error));
      setOrderedIds(sortedItems.map((item) => item.id));
    }
  }

  const menu = (
    <SidebarMenu>
      {sortedByLocalOrder.map((item) => (
        <SortableItemRow
          active={item.id === activeItemId}
          authenticated={authenticated}
          item={item}
          key={item.id}
          onDelete={onDelete}
          onEdit={onEdit}
          onNavigate={onNavigate}
        />
      ))}
    </SidebarMenu>
  );

  return (
    <>
      <SidebarHeader className="items-end">
        {authenticated ? (
          <SiteIconTooltip text="Create item">
            <Button aria-label="Create item" onClick={onCreate} size="icon-sm" type="button">
              <PlusIcon aria-hidden={true} />
            </Button>
          </SiteIconTooltip>
        ) : null}
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            {authenticated ? (
              <DndContext
                collisionDetection={closestCenter}
                onDragEnd={(event) => {
                  void handleDragEnd(event);
                }}
                sensors={sensors}
              >
                <SortableContext items={renderIds} strategy={verticalListSortingStrategy}>
                  {menu}
                </SortableContext>
              </DndContext>
            ) : (
              menu
            )}
            {reorderError ? (
              <p className="px-3 text-xs leading-5 text-destructive">{reorderError}</p>
            ) : null}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </>
  );
}

function ThemeToggle() {
  const theme = useGraphleSiteTheme();
  const Icon = theme.resolved === "dark" ? SunIcon : MoonIcon;

  return (
    <SiteIconTooltip text={theme.resolved === "dark" ? "Use light theme" : "Use dark theme"}>
      <Button
        aria-label={theme.resolved === "dark" ? "Use light theme" : "Use dark theme"}
        onClick={theme.toggle}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <Icon aria-hidden={true} />
      </Button>
    </SiteIconTooltip>
  );
}

function DeleteConfirmDialog({
  item,
  onConfirm,
  onOpenChange,
}: {
  readonly item: GraphleSiteItemView | null;
  readonly onConfirm: () => void;
  readonly onOpenChange: (open: boolean) => void;
}) {
  return (
    <AlertDialog open={Boolean(item)} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete item</AlertDialogTitle>
          <AlertDialogDescription>
            {item ? `Delete "${item.title}" from this site?` : "Delete this item?"}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} variant="destructive">
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ReadySitePreview({
  graphRuntime,
  items,
  onCreateBlankItem,
  onDeleteItem,
  onNavigatePath,
  onReorderItems,
  route,
  snapshot,
}: {
  readonly graphRuntime?: GraphleSiteGraphClient | null;
  readonly items: readonly GraphleSiteItemView[];
  readonly onCreateBlankItem?: () => Promise<GraphleSiteItemView>;
  readonly onDeleteItem?: (id: string) => Promise<void>;
  readonly onNavigatePath?: (path: string) => Promise<void> | void;
  readonly onReorderItems?: (items: readonly GraphleSiteItemOrder[]) => Promise<void>;
  readonly route: GraphleSiteRoute;
  readonly snapshot: GraphleSiteStatusSnapshot;
}) {
  const [editItemId, setEditItemId] = useState<string | null>(null);
  const [deleteItem, setDeleteItem] = useState<GraphleSiteItemView | null>(null);
  const [actionError, setActionError] = useState("");
  const activeItem = selectedContentItem({ editItemId, items, route });
  const activeItemRef =
    graphRuntime && editItemId ? findGraphleSiteItemRef(graphRuntime, editItemId) : undefined;
  const routeItemId = route.kind === "item" ? route.item.id : undefined;
  const routeItemRef =
    graphRuntime && route.kind === "item"
      ? findGraphleSiteItemRef(graphRuntime, route.item.id)
      : undefined;
  const isEditing =
    snapshot.session.authenticated && editItemId !== null && activeItem && activeItemRef;

  function navigateToItem(item: GraphleSiteItemView, event: MouseEvent<HTMLAnchorElement>) {
    if (!item.path) return;
    event.preventDefault();
    setEditItemId(null);
    void onNavigatePath?.(item.path);
  }

  function editItem(item: GraphleSiteItemView) {
    setEditItemId(item.id);
    setActionError("");
    if (item.path && item.path !== route.path) {
      void onNavigatePath?.(item.path);
    }
  }

  async function createBlankItem() {
    setActionError("");
    try {
      const created = await onCreateBlankItem?.();
      if (!created) return;
      setEditItemId(created.id);
      if (created.path) await onNavigatePath?.(created.path);
    } catch (error) {
      setActionError(messageForError(error));
    }
  }

  async function confirmDelete() {
    const item = deleteItem;
    if (!item) return;
    setDeleteItem(null);
    setActionError("");
    try {
      await onDeleteItem?.(item.id);
      if (editItemId === item.id || routeItemId === item.id) {
        setEditItemId(null);
        await onNavigatePath?.("/");
      }
    } catch (error) {
      setActionError(messageForError(error));
    }
  }

  return (
    <TooltipProvider>
      <SidebarProvider style={{ "--sidebar-width": "15rem" } as CSSProperties}>
        <Sidebar collapsible="none" variant="sidebar">
          <ItemSidebar
            activeItemId={editItemId ?? routeItemId}
            authenticated={snapshot.session.authenticated}
            items={items}
            onCreate={() => {
              void createBlankItem();
            }}
            onDelete={setDeleteItem}
            onEdit={editItem}
            onNavigate={navigateToItem}
            onReorder={onReorderItems}
          />
          <SidebarFooter>
            <ThemeToggle />
          </SidebarFooter>
        </Sidebar>
        <SidebarInset>
          <main className="mx-auto block min-h-0 w-full max-w-[52rem] px-5 py-8 md:min-h-svh md:px-[clamp(1.25rem,4vw,3.5rem)] md:py-[clamp(2rem,6vw,5rem)]">
            {actionError ? (
              <p className="mb-4 max-w-[46rem] rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {actionError}
              </p>
            ) : null}
            {isEditing && activeItemRef && graphRuntime ? (
              <ItemEditor entity={activeItemRef} runtime={graphRuntime} />
            ) : (
              <RouteView itemRef={routeItemRef} route={route} />
            )}
          </main>
        </SidebarInset>
        <DeleteConfirmDialog
          item={deleteItem}
          onConfirm={() => {
            void confirmDelete();
          }}
          onOpenChange={(open) => {
            if (!open) setDeleteItem(null);
          }}
        />
      </SidebarProvider>
    </TooltipProvider>
  );
}

function GraphBackedReadySitePreview({
  path,
  runtime,
  snapshot,
  ...props
}: Omit<Parameters<typeof ReadySitePreview>[0], "graphRuntime" | "items" | "route"> & {
  readonly path: string;
  readonly runtime: GraphleSiteGraphClient;
}) {
  const syncState = useGraphSyncState(runtime);
  const selection = useMemo(
    () => ({
      items: listGraphleSiteItemViews(runtime, { includePrivate: true }),
      route: resolveGraphleSiteRoute(runtime, path, { includePrivate: true }),
    }),
    [path, runtime, syncState],
  );

  return (
    <ReadySitePreview
      {...props}
      graphRuntime={runtime}
      items={selection.items}
      route={selection.route}
      snapshot={snapshot}
    />
  );
}

export function GraphleSitePreview({
  path,
  runtime,
  status,
  onCreateBlankItem,
  onDeleteItem,
  onNavigatePath,
  onReorderItems,
}: GraphleSiteFeatureOptions) {
  if (status.state === "loading") return <LoadingSurface />;
  if (status.state === "error") return <ErrorSurface message={status.message} />;

  const routePath = path ?? status.snapshot.route.path;
  if (status.snapshot.session.authenticated && runtime) {
    return (
      <GraphBackedReadySitePreview
        path={routePath}
        runtime={runtime}
        snapshot={status.snapshot}
        onCreateBlankItem={onCreateBlankItem}
        onDeleteItem={onDeleteItem}
        onNavigatePath={onNavigatePath}
        onReorderItems={onReorderItems}
      />
    );
  }

  return (
    <ReadySitePreview
      items={status.snapshot.items}
      route={status.snapshot.route}
      snapshot={status.snapshot}
      onCreateBlankItem={onCreateBlankItem}
      onDeleteItem={onDeleteItem}
      onNavigatePath={onNavigatePath}
      onReorderItems={onReorderItems}
    />
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
    navigation: [],
    commands: [],
    pages: [
      {
        id: "site",
        label: "Site",
        path: activePagePath(options.status),
        order: 10,
        render: () => <GraphleSitePreview {...options} />,
      },
    ],
  };
}
