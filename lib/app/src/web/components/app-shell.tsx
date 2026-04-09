"use client";

import { SidebarInset, SidebarProvider } from "@io/web/sidebar";
import type { ReactNode } from "react";

import { AppSidebar } from "./app-sidebar.js";
import { TooltipProvider } from "@io/web/tooltip";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider>
      <SidebarProvider defaultOpen={true}>
        <AppSidebar />
        <SidebarInset className="p-8 h-svh">{children}</SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
