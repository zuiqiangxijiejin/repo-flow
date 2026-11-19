"use client";

import {
  BotIcon,
  PaletteIcon,
  UserCogIcon,
  UsersRoundIcon,
  UserIcon,
  PlugIcon,
  PuzzleIcon,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/core/auth/AuthProvider";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

import { PluginSurfaces } from "../plugin-surfaces";

function SettingsPageLoading() {
  return (
    <p role="status" className="text-muted-foreground py-8 text-center text-sm">
      Loading…
    </p>
  );
}

const AccountSettingsPage = dynamic(
  () =>
    import("./account-settings-page").then(
      (module) => module.AccountSettingsPage,
    ),
  { loading: SettingsPageLoading },
);
const AppearanceSettingsPage = dynamic(
  () =>
    import("./appearance-settings-page").then(
      (module) => module.AppearanceSettingsPage,
    ),
  { loading: SettingsPageLoading },
);
const SubagentSettingsPage = dynamic(
  () =>
    import("./subagent-settings-page").then(
      (module) => module.SubagentSettingsPage,
    ),
  { loading: SettingsPageLoading },
);
const ModelSettingsPage = dynamic(
  () =>
    import("./model-settings-page").then((module) => module.ModelSettingsPage),
  { loading: SettingsPageLoading },
);
const UserSettingsPage = dynamic(
  () =>
    import("./user-settings-page").then((module) => module.UserSettingsPage),
  { loading: SettingsPageLoading },
);
const CapabilityCenter = dynamic(
  () =>
    import("../capabilities/capability-center").then(
      (module) => module.CapabilityCenter,
    ),
  { loading: SettingsPageLoading },
);

export type SettingsSection =
  | "models"
  | "users"
  | "account"
  | "connections"
  | "capabilities"
  | "appearance"
  | "channels"
  | "memory"
  | "subagents"
  | "notification"
  | "about";

type SettingsDialogProps = React.ComponentProps<typeof Dialog> & {
  defaultSection?: SettingsSection;
};

export function SettingsDialog(props: SettingsDialogProps) {
  const { defaultSection = "appearance", ...dialogProps } = props;
  const { t } = useI18n();
  const { user } = useAuth();
  const isAdmin = user?.system_role === "admin";
  const [activeSection, setActiveSection] =
    useState<SettingsSection>(defaultSection);

  useEffect(() => {
    // When opening the dialog, ensure the active section follows the caller's intent.
    // This allows triggers like "About" to open the dialog directly on that page.
    if (dialogProps.open) {
      setActiveSection(defaultSection);
    }
  }, [defaultSection, dialogProps.open]);

  const sections = useMemo(() => {
    const items: {
      id: SettingsSection;
      label: string;
      icon: typeof BotIcon;
    }[] = [
      { id: "models", label: t.settings.sections.models, icon: BotIcon },
      {
        id: "account",
        label: t.settings.sections.account,
        icon: UserIcon,
      },
      {
        id: "connections",
        label: t.settings.sections.connections,
        icon: PlugIcon,
      },
      {
        id: "appearance",
        label: t.settings.sections.appearance,
        icon: PaletteIcon,
      },
      {
        id: "capabilities",
        label: t.settings.sections.capabilities,
        icon: PuzzleIcon,
      },
      {
        id: "subagents",
        label: t.settings.sections.subagents,
        icon: UsersRoundIcon,
      },
    ];
    // User management is meaningless (and confusing) for non-admins, so the
    // entry point itself is hidden; the page still guards independently in
    // case a stale dialog store ever activates the section.
    if (isAdmin) {
      items.splice(1, 0, {
        id: "users",
        label: t.settings.sections.users,
        icon: UserCogIcon,
      });
    }
    return items;
  }, [
    isAdmin,
    t.settings.sections.models,
    t.settings.sections.users,
    t.settings.sections.account,
    t.settings.sections.connections,
    t.settings.sections.appearance,
    t.settings.sections.capabilities,
    t.settings.sections.subagents,
  ]);
  // A `?settings=<section>` deep link (or a stale dialog store) can activate
  // a section this user's nav does not offer — e.g. user management for a
  // non-admin — so fall back to the first available section instead of
  // rendering a panel with no highlighted entry. The base list above is
  // non-empty, so the fallback itself always resolves.
  const activeId = sections.some((section) => section.id === activeSection)
    ? activeSection
    : sections[0]!.id;
  return (
    <Dialog
      {...dialogProps}
      onOpenChange={(open) => props.onOpenChange?.(open)}
    >
      <DialogContent
        className="repoflow-settings flex h-[75vh] max-h-[calc(100vh-2rem)] flex-col sm:max-w-5xl md:max-w-6xl"
        aria-describedby={undefined}
      >
        <DialogHeader className="gap-1">
          <DialogTitle>{t.settings.title}</DialogTitle>
          <p className="text-muted-foreground text-sm">
            {t.settings.description}
          </p>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
          <nav className="bg-sidebar min-h-0 overflow-y-auto rounded-lg border p-2">
            <ul className="space-y-1 pr-1">
              {sections.map(({ id, label, icon: Icon }) => {
                const active = activeId === id;
                return (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => setActiveSection(id)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                        active
                          ? "repoflow-action shadow-sm"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <Icon className="size-4" />
                      <span>{label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
          <ScrollArea className="h-full min-h-0 rounded-lg border">
            <div className="space-y-8 p-6">
              {activeId === "models" && <ModelSettingsPage />}
              {activeId === "users" && <UserSettingsPage />}
              {activeId === "account" && <AccountSettingsPage />}
              {activeId === "connections" && <PluginSurfaces slot="settings" />}
              {activeId === "capabilities" && <CapabilityCenter embedded />}
              {activeId === "appearance" && <AppearanceSettingsPage />}
              {activeId === "subagents" && <SubagentSettingsPage />}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
