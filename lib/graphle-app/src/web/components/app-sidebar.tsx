import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@dpeek/graphle-web-ui/sidebar";
import {
  GitGraphIcon,
  HomeIcon,
  RefreshCwIcon,
  SearchIcon,
  TableIcon,
  WorkflowIcon,
} from "lucide-react";
import { AppSidebarNavMain } from "./app-sidebar-nav-main";
import { AppSidebarNavUser } from "./app-sidebar-nav-user";

const data = {
  navItems: [
    {
      title: "Home",
      url: "/",
      icon: HomeIcon,
    },
    {
      title: "Query",
      url: "/query",
      icon: SearchIcon,
    },
    {
      title: "Workflow",
      url: "/workflow",
      icon: WorkflowIcon,
    },
    {
      title: "Graph",
      url: "/graph",
      icon: GitGraphIcon,
    },
    {
      title: "Sync",
      url: "/sync",
      icon: RefreshCwIcon,
    },
    {
      title: "Scalars",
      url: "/scalars",
      icon: TableIcon,
    },
  ],
} as const;

export function AppSidebar() {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader />
      <SidebarContent>
        <AppSidebarNavMain items={data.navItems} />
      </SidebarContent>
      <SidebarFooter>
        <AppSidebarNavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
