"use client";

import { type LucideIcon } from "lucide-react";

import { SidebarGroup, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@io/web/sidebar";
import { Link } from "@tanstack/react-router";

type NavItem = {
  title: string;
  url: string;
  icon?: LucideIcon;
};

export function AppSidebarNavMain({ items }: { items: readonly NavItem[] }) {
  return (
    <SidebarGroup>
      <SidebarMenu>
        {items.map((item, index) => (
          <SidebarMenuItem key={index}>
            <Link to={item.url}>
              {({ isActive }) => (
                <SidebarMenuButton isActive={isActive} tooltip={item.title}>
                  {item.icon && <item.icon />}
                  <span>{item.title}</span>
                </SidebarMenuButton>
              )}
            </Link>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
