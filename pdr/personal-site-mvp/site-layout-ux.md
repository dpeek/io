Status: Implemented
Last Updated: 2026-04-16

# Personal Site Layout And Authoring UX

## Must Read

- `../../AGENTS.md`
- `./spec.md`
- `./site-item-prd.md`
- `./phase-4-site-web.md`
- `../entity-surface.md`
- `../../lib/graphle-site-web/doc/site-web.md`
- `../../lib/graphle-site-web/src/site-app.tsx`
- `../../lib/graphle-site-web/src/site-feature.tsx`
- `../../lib/graphle-site-web/src/status.ts`
- `../../lib/graphle-local/src/server.ts`
- `../../lib/graphle-local/src/site-authority.ts`
- `../../lib/graphle-module-site/doc/site-schema.md`
- `../../lib/graphle-module-site/src/index.ts`
- `../../lib/graphle-react/doc/predicate-and-entity-hooks.md`
- `../../lib/graphle-react/doc/entity-draft-controller.md`
- `../../lib/graphle-react/doc/resolvers-and-filters.md`
- `../../lib/graphle-surface/doc/record-surfaces.md`
- `../../lib/graphle-app/doc/entity-surface.md`
- `../../lib/graphle-app/src/web/components/entity-surface.tsx`
- `../../lib/graphle-app/src/web/components/field-editor-row.tsx`
- `../../lib/graphle-web-ui/src/sidebar.tsx`
- `../../lib/graphle-web-ui/src/dropdown-menu.tsx`
- `../../lib/graphle-web-ui/src/button.tsx`
- `../../lib/graphle-web-ui/src/tooltip.tsx`
- `../../lib/graphle-web-ui/src/global.css`
- [shadcn sidebar docs](https://ui.shadcn.com/docs/components/radix/sidebar)
- [dnd-kit sortable docs](https://docs.dndkit.com/presets/sortable)

## Goal

Replace the current Phase 4 three-column authoring preview with a minimalist
personal-site UI:

- one left item sidebar with icon and item title only
- centered route content rendered from the current `site:item`
- authenticated edit mode that swaps predicate displays for predicate editors
  in the same layout
- one `+` button that creates a private routed item and navigates to it
- URL-only item primary clicks open the URL in a new tab
- URL-only item editing happens through an authenticated action menu, not a
  public permalink
- authenticated drag-and-drop ordering for sidebar items
- one icon-only dark mode toggle

The public website should read as the graph content, not as Graphle admin
chrome. No inline labels, badges, status pills, helper text, or extra product
copy should be visible unless that text is graph content or a temporarily
opened command menu.

## Approach

### URL and routing model

Keep `site:item.path` as the canonical public route.

Do not use `/<inferred-slug>?id=<guid>` or any other query-string id as a
public permalink. Title-derived slugs are useful only as create-time defaults.
The persisted `path` predicate remains the public URL contract, and exact path
matching remains the route resolver.

Use item ids for authenticated authoring state only:

- path-backed items navigate to `item.path` and can be edited in place
- URL-only items keep no internal public route
- URL-only item primary clicks open `item.url` in a new tab
- URL-only item edit is a sidebar action that selects the item as the current
  authoring subject without creating a page route

If reloadable URL-only editing becomes necessary, use an authenticated-only
client state such as `?edit=<id>` later. That query state must not be emitted as
a canonical public URL, linked from public markup, or handled as a public route
by the server.

### Minimal site frame

Move `@dpeek/graphle-site-web` from the current generic shell presentation to a
site-owned frame for this product path.

Use shadcn sidebar primitives from `@dpeek/graphle-web-ui/sidebar`:

- `SidebarProvider`
- `Sidebar`
- `SidebarContent`
- `SidebarMenu`
- `SidebarMenuItem`
- `SidebarMenuButton`
- `SidebarInset`

The default layout should be:

```text
sidebar | centered item content
```

The sidebar contains only:

- item icon
- item title
- authenticated-only `+`
- authenticated-only item actions menu where needed
- authenticated-only drag handle while reordering
- dark mode toggle

The centered content should be unframed, with a readable max width. Do not put
the page in a card. Render markdown with `MarkdownRenderer`.

The current Graphle shell status badges, command bar, "Site preview", "New
item", "Edit item", visibility badges, pin badges, and secondary item metadata
should not appear in this product surface.

### Predicate display and editor reuse

Do not continue growing the ad hoc `ItemEditor` form in
`lib/graphle-site-web/src/site-feature.tsx`.

The repo already has the relevant predicate surface pieces:

- `@dpeek/graphle-react` owns `usePredicateField(...)`, predicate metadata
  readers, resolver contracts, and `createEntityDraftController(...)`
- `@dpeek/graphle-app` currently has app-owned `EntitySurface`,
  `CreateEntitySurface`, row planning, and `PredicateRow`
- `@dpeek/graphle-surface` owns readonly record-surface binding, not
  interactive edit behavior

The MVP site must still not import `@dpeek/graphle-app`. Reuse the existing
predicate display/editor work by extracting or adapting the smallest
browser-safe pieces into the new product path:

- host-neutral predicate and draft mechanics stay in `@dpeek/graphle-react`
- shadcn/browser field widgets that are not app-specific should live in
  `@dpeek/graphle-web-ui` or a new browser-safe helper under the site/web-ui
  boundary
- site-specific row policy, layout, and action behavior stay in
  `@dpeek/graphle-site-web`

The site item surface should render a planned list of item predicates. In view
mode, each row uses the predicate display path. In edit mode, the same row uses
the predicate editor path. The row order, spacing, and content hierarchy should
stay stable across modes.

Visible labels should be hidden by default. Inputs still need accessible names
through `aria-label`, `sr-only` text, or the predicate metadata wired to the
control. Do not expose field labels as extra visible page copy unless the
predicate value itself is the content being rendered.

### Item actions

Use primary click for the graph target:

- item with `path`: navigate in-app to the route
- item with only `url`: open the URL in a new tab

For authenticated users, show an icon-only item action trigger on hover/focus
or when the item is active. Use `DropdownMenu` from `@dpeek/graphle-web-ui`.
The smallest useful menu is:

- Edit
- Delete

Optional later action:

- Open

The dropdown can contain command labels because an opened menu is an action
surface, not inline graph metadata. The collapsed sidebar row must still show
only icon and item title.

Delete should require confirmation. Use the existing shadcn alert/dialog
primitive or an equivalent accessible confirmation. Add the narrow local API
and authority helper needed for deleting one item. Deleting the current routed
item should navigate to `/` after success.

### Create flow

Replace presets with a single authenticated `+` button.

The button should:

1. call the existing `POST /api/site/items` surface with a blank-create intent
2. let the local site authority allocate a unique private routed item
3. return the created item
4. navigate to the created item path
5. enter edit mode immediately

The default item should be boring:

- `title`: `Untitled`
- `visibility`: `private`
- `path`: unique title-derived path such as `/untitled`, `/untitled-2`, etc.
- all optional fields empty

The unique path allocation belongs in site/local helpers, not in the button.
That keeps collision handling out of the browser and makes create behavior
consistent after reloads.

If the user clears `path` while editing and saves a URL-only item, the app
should keep the item selected for editing through client state and navigate the
browser back to `/` after the save if the current path no longer resolves.

### Ordering

Use `@dnd-kit/core` and `@dnd-kit/sortable` for React drag-and-drop ordering.
The sortable preset is the right fit for an accessible sortable sidebar list,
and it avoids the archived `react-beautiful-dnd` path.

Ordering should persist through the existing `site:item.sortOrder` predicate.

Refine ordering rules for this product surface:

1. items with explicit `sortOrder` sort by ascending `sortOrder`
2. items without `sortOrder` fall back to the current deterministic rules
3. fallback ordering can still use created date, updated date, and title as
   defined in the `site:item` helpers
4. once the admin drags the sidebar, normalize the whole visible item list to
   consecutive `sortOrder` values so future order is fully deterministic

Dragging should be disabled while the sidebar is filtered or searched. Reorder
only the full flat list to avoid persisting an order that came from a partial
view.

Add one authenticated batch reorder API rather than firing many independent
item patches:

```text
PATCH /api/site/items/order
```

Request shape:

```json
{
  "items": [
    { "id": "item-id", "sortOrder": 10 }
  ]
}
```

The local authority should validate that every id exists and then apply the
sort-order updates in one graph transaction.

### Dark mode

Use the existing light/dark CSS variables in
`@dpeek/graphle-web-ui/src/global.css`.

Add a small theme helper in `@dpeek/graphle-site-web`:

- read `localStorage.graphle.theme`
- support `light`, `dark`, and `system`
- apply `dark` or `light` to `document.documentElement`
- update when system preference changes

The visible control should be one icon-only button with a tooltip and accessible
label. No visible "Dark mode" text.

## Rules

- Run `turbo build` before edits and `turbo check` after edits.
- Keep public URLs path-backed. Do not introduce query-string id permalinks.
- Do not import `@dpeek/graphle-app` from the MVP site path.
- Reuse `@dpeek/graphle-react` predicate and draft primitives instead of
  inventing a second field model.
- Extract reusable field widget capability only into browser-safe packages that
  belong to the MVP path.
- Keep `@dpeek/graphle-surface` readonly. Do not push edit-session behavior
  into `resolveRecordSurfaceBinding(...)`.
- Keep the public surface minimalist: no inline labels, badges, status pills,
  helper copy, or Graphle shell chrome.
- Keep command labels inside menus/dialogs accessible and concise.
- Links open in a new tab. Pages navigate to routes.
- Drag reorder must persist through graph writes, not local-only state.
- Deleting and reordering require authenticated local admin session.

## Open Questions

None. This PDR resolves the current questions as:

- canonical public pages use `path`
- URL-only editing uses authenticated item actions, not public routes
- ordering uses `@dnd-kit/sortable` over persisted `sortOrder`

## Implementation Notes

Implemented in the MVP path on 2026-04-16:

- `@dpeek/graphle-site-web` now renders a site-owned sidebar/content frame
  instead of the generic Graphle shell chrome.
- The sidebar rows show item icons and titles, use route navigation for
  path-backed items, open URL-only items in a new tab, and expose
  authenticated action menus for edit/delete.
- The `+` action calls the blank-create intent; the local authority allocates
  unique private paths such as `/untitled` and `/untitled-2`.
- Authenticated edit mode uses the authored `site:item` editor surface backed
  by site predicate refs and shared entity-surface primitives.
- Drag ordering uses `@dnd-kit/sortable` and persists normalized consecutive
  `sortOrder` values through graph transactions.
- Deletion is exposed through `DELETE /api/site/items/:id` and confirmed in the
  browser before the request.
- The theme helper persists `localStorage.graphle.theme`, supports
  `light | dark | system`, and applies existing `light`/`dark` token classes to
  `document.documentElement`.

## Success Criteria

- The browser app renders a minimalist layout with one left sidebar and centered
  route content.
- Sidebar item rows show only icon and item title by default.
- Internal item rows navigate to the item route in the same tab.
- URL-only item rows open the URL in a new tab.
- Authenticated users can edit path-backed items in place without changing the
  route layout.
- Authenticated users can edit URL-only items through the sidebar action menu
  without creating a public route.
- Authenticated users can delete an item through the sidebar action menu after
  confirmation.
- The `+` button creates a private routed item, navigates to it, and starts edit
  mode.
- View mode and edit mode use the same predicate row plan and swap display
  widgets for editor widgets in place.
- The site path uses predicate/draft/resolver primitives from
  `@dpeek/graphle-react` and does not import `@dpeek/graphle-app`.
- Drag-and-drop reorder persists through `site:item.sortOrder`.
- Dark mode toggles by applying the existing global `.dark`/`.light` token
  classes and persists locally.
- Existing public route fallback behavior still works for no-JS rendering.
- Docs describe the new site layout, link edit behavior, ordering behavior, and
  theme behavior.
- `turbo check` passes.

## Tasks

- Replace the site feature's three-column layout with a site-owned frame:
  - use `@dpeek/graphle-web-ui/sidebar` primitives for the left item nav
  - render route content centered in `SidebarInset`
  - remove generic shell chrome from the personal-site product surface
  - preserve `GraphleSiteShell` exports for tests or future host composition
    only if still useful
- Build the minimalist item sidebar:
  - map item icon presets to icon components
  - show only icon and title in each row
  - route path-backed rows through client navigation
  - open URL-only rows with `target="_blank" rel="noreferrer"`
  - expose authenticated-only icon actions with `DropdownMenu`
- Add item action behavior:
  - Edit selects the item and enters edit mode
  - Delete confirms, calls a new authenticated delete API, refreshes item data,
    and navigates away if the deleted item was active
  - URL-only edit never creates a public route
- Replace preset creation with one `+` button:
  - extend the create API/local helper to support a blank-create intent
  - allocate unique private paths server-side
  - navigate to the returned path after creation
  - enter edit mode immediately
- Replace the ad hoc site item form with a predicate-backed item surface:
  - define authored site item surfaces for editor fields and route display
    fields
  - reuse `@dpeek/graphle-react` predicate metadata, draft controller, and
    resolver contracts
  - extract any needed browser field widgets from the app path into the
    site/web-ui boundary instead of importing `@dpeek/graphle-app`
  - render displays in view mode and editors in edit mode using the same row
    layout
  - hide visible field labels by default while preserving accessible names
- Add client route state:
  - intercept internal sidebar navigation with `history.pushState`
  - reload `/api/site/route?path=<path>` for internal routes
  - listen for `popstate`
  - preserve selected URL-only edit state separately from public route state
- Add drag-and-drop ordering:
  - add `@dnd-kit/core`, `@dnd-kit/sortable`, and `@dnd-kit/utilities`
  - render authenticated drag handles in the sidebar
  - disable drag while filtered/searching
  - normalize reordered items to consecutive `sortOrder` values
  - add `PATCH /api/site/items/order`
  - update `compareSiteItems` and docs to reflect explicit manual order
- Add dark mode:
  - create a small theme hook/provider in `@dpeek/graphle-site-web`
  - persist local theme preference
  - apply `light` or `dark` classes to `document.documentElement`
  - render one icon-only toggle in the sidebar
- Update tests:
  - update server-render shell tests to stop expecting old labels and badges
  - cover internal route rows versus external link rows
  - cover URL-only edit selection through item actions
  - cover create-and-navigate behavior
  - cover reorder payload generation and local API validation
  - cover dark mode class application where practical
- Update docs:
  - `lib/graphle-site-web/doc/site-web.md`
  - `lib/graphle-module-site/doc/site-schema.md` if ordering rules change
  - `pdr/personal-site-mvp/phase-4-site-web.md` learnings or follow-up notes

## Non-Goals

- Public query-string id permalinks.
- A separate admin route namespace.
- Nested navigation, folders, collections, or multiple sidebars.
- Creation presets for page, post, link, bookmark, or social link.
- Link preview scraping.
- Tag landing pages.
- Remote deploy UI changes.
- Importing or booting `@dpeek/graphle-app` in the MVP site path.
