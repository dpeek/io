"use client";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@io/web/sidebar";
import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { AppShellAuthStatus } from "./auth-shell.js";

const navigationItems = [
  { to: "/", label: "Home", exact: true },
  { to: "/workflow", label: "Workflow", exact: false },
  { to: "/views", label: "Views", exact: false },
  { to: "/graph", label: "Graph", exact: false },
  { to: "/sync", label: "Sync", exact: false },
] as const;

function isItemActive(pathname: string, item: (typeof navigationItems)[number]): boolean {
  if (item.exact) {
    return pathname === item.to;
  }

  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  return (
    <SidebarProvider className="h-svh overflow-hidden">
      <Sidebar collapsible="icon">
        <SidebarHeader className="gap-1 p-4">
          <Link className="text-sm font-semibold tracking-tight" to="/">
            IO
          </Link>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {navigationItems.map((item) => (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      render={<Link to={item.to} />}
                      isActive={isItemActive(pathname, item)}
                      tooltip={item.label}
                    >
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarRail />
      </Sidebar>
      <SidebarInset className="h-svh min-h-svh overflow-hidden">
        <header className="border-border/70 flex h-12 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <span className="text-sm font-medium">IO</span>
          <AppShellAuthStatus />
        </header>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
