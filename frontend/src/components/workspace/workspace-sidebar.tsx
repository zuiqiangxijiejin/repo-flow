"use client";

import { Github, MessagesSquare, Settings2, UserRound } from "lucide-react";
import { useParams } from "next/navigation";

import {
  type Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/core/auth/AuthProvider";
import { useI18n } from "@/core/i18n/hooks";
import { useThreadActivity } from "@/core/threads/activity";
import { cn } from "@/lib/utils";

import { PluginNavigation } from "./plugin-navigation";
import { PluginSurfaces } from "./plugin-surfaces";
import { RecentChatList } from "./recent-chat-list";
import { openSettingsDialog } from "./settings";
import { ThreadDeleteDialogProvider } from "./thread-delete-dialog";
import { WorkspaceHeader } from "./workspace-header";
import {
  WorkspaceSidebarFrame,
  useWorkspaceSidebarExpanded,
} from "./workspace-sidebar-frame";

export function WorkspaceSidebar({
  className,
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  // One activity poll per workspace (off unless the Gateway offers it): new
  // and changed server-created threads reach the thread lists without a
  // reload, and a read on another device clears their dots here.
  useThreadActivity();
  return (
    <ThreadDeleteDialogProvider>
      <WorkspaceSidebarFrame
        variant="sidebar"
        collapsible="icon"
        className={cn("repoflow-sidebar", className)}
        {...props}
      >
        <WorkspaceSidebarContents />
      </WorkspaceSidebarFrame>
    </ThreadDeleteDialogProvider>
  );
}

function WorkspaceSidebarContents() {
  const isSidebarOpen = useWorkspaceSidebarExpanded();
  const { isMobile, setOpen, setOpenMobile } = useSidebar();
  const { user } = useAuth();
  const { t } = useI18n();
  const { thread_id } = useParams<{ thread_id?: string }>();
  return (
    <>
      <SidebarHeader className="repoflow-sidebar-header gap-5 px-4 pt-4 pb-2">
        <WorkspaceHeader />
      </SidebarHeader>
      <SidebarContent className="gap-3">
        {!isSidebarOpen && (
          <SidebarMenu className="px-2">
            {[
              { icon: Github, label: t.sidebar.repositories },
              { icon: MessagesSquare, label: t.sidebar.chats },
            ].map(({ icon: Icon, label }) => (
              <SidebarMenuItem key={label}>
                <SidebarMenuButton
                  tooltip={label}
                  aria-label={label}
                  onClick={() =>
                    isMobile ? setOpenMobile(true) : setOpen(true)
                  }
                >
                  <Icon />
                  <span>{label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        )}
        <PluginSurfaces
          slot="workspace-sidebar"
          threadId={thread_id === "new" ? undefined : thread_id}
        />
        <PluginNavigation />
        {isSidebarOpen && <RecentChatList flat />}
      </SidebarContent>
      <SidebarFooter className="repoflow-sidebar-footer p-4">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={t.settings.title}
              onClick={() => {
                if (isMobile) setOpenMobile(false);
                openSettingsDialog("account");
              }}
            >
              <Settings2 />
              <span>{t.settings.title}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        {isSidebarOpen && user?.email && (
          <div className="repoflow-account-label">
            <UserRound className="size-4 shrink-0" aria-hidden />
            <span>{user.email}</span>
          </div>
        )}
      </SidebarFooter>
      {!isMobile && <SidebarRail />}
    </>
  );
}
