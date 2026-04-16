import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@dpeek/graphle-web-ui/sidebar";
import { LogOutIcon } from "lucide-react";
import { useResetSharedGraphRuntimeOnSessionChange, useWebAuthSession } from "./auth-shell";
import { authClient, notifyWebPrincipalBootstrapChanged } from "../lib/auth-client";

export function AppSidebarNavUser() {
  const auth = useWebAuthSession();

  useResetSharedGraphRuntimeOnSessionChange(auth.sessionId);

  async function onSignOut() {
    const result = await authClient.signOut();
    if (result.error) {
      throw new Error(result.error.message);
    }
    notifyWebPrincipalBootstrapChanged();
  }

  if (auth.status !== "ready") return null;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton onClick={onSignOut} tooltip="Sign Out">
          <LogOutIcon />
          <span>Sign Out</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
