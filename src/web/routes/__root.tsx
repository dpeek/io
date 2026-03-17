import { Outlet, createRootRoute } from "@tanstack/react-router";

import { AppShell } from "../components/app-shell";
import { PlaceholderPage } from "../components/placeholder-page";

function RootComponent() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

function NotFoundComponent() {
  return (
    <PlaceholderPage
      eyebrow="Not found"
      title="This page does not exist"
      description="TanStack Router is mounted correctly, but there is no file route for this path yet."
    />
  );
}

export const Route = createRootRoute({
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});
