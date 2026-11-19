"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState } from "react";

import { useAuth } from "@/core/auth/AuthProvider";
import type { PluginSurface, SurfaceSlot } from "@/core/extensions/contracts";
import {
  useFrontendExtensions,
  useFrontendServices,
} from "@/core/extensions/hooks";
import {
  activeFrontendExtensions,
  type LoadedContribution,
} from "@/core/extensions/registry";
import {
  bindFrontendServices,
  openConversation,
  requestExtensionRoute,
} from "@/core/extensions/services";
import { mountSurface } from "@/core/extensions/surfaces";
import { useI18n } from "@/core/i18n/hooks";

import { ThreadContext } from "./messages/context";

export type ThreadPanelSelection = {
  threadId: string;
  namespace: string;
  surfaceId: string;
  title: string;
};

export const ThreadPanelControls = createContext<{
  open: (selection: ThreadPanelSelection) => void;
  close: (namespace: string) => void;
} | null>(null);

function Surface({
  entry,
  surface,
  threadId,
  prepareMessage,
}: {
  entry: LoadedContribution;
  surface: PluginSurface;
  threadId?: string;
  prepareMessage?: (text: string) => boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { locale, t } = useI18n();
  const { user } = useAuth();
  const services = useFrontendServices();
  const execution = useContext(ThreadContext);
  const running = execution?.thread.isLoading ?? false;
  const activity = useRef({
    running,
    listeners: new Set<(running: boolean) => void>(),
  });
  activity.current.running = running;
  useEffect(() => {
    for (const listener of activity.current.listeners) listener(running);
  }, [running]);
  const currentServices = useRef(services);
  currentServices.current = services;
  const panel = useContext(ThreadPanelControls);
  const controls = useRef({ panel, prepareMessage });
  controls.current = { panel, prepareMessage };
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    const abort = new AbortController();
    const cleanup = mountSurface(
      ref.current,
      surface,
      {
        namespace: entry.namespace,
        locale,
        settings: entry.settings,
        threadId,
        isThreadRunning: () => activity.current.running,
        subscribeThreadActivity: (listener) => {
          activity.current.listeners.add(listener);
          return () => {
            activity.current.listeners.delete(listener);
          };
        },
        requestBackend: (path, options) =>
          requestExtensionRoute(
            path,
            options,
            abort.signal,
            entry.viewer_id ?? "",
          ),
        openConversation: (id, signal) =>
          openConversation(id, (path) => router.push(path), signal),
        openThreadPanel: threadId
          ? (surfaceId) => {
              const target = entry.extension?.surfaces?.find(
                (candidate) =>
                  candidate.slot === "thread-panel" &&
                  candidate.id === surfaceId,
              );
              if (target) {
                controls.current.panel?.open({
                  namespace: entry.namespace,
                  surfaceId,
                  threadId,
                  title: target.title,
                });
              }
            }
          : undefined,
        closeThreadPanel:
          surface.slot === "thread-panel"
            ? () => controls.current.panel?.close(entry.namespace)
            : undefined,
        prepareMessage:
          surface.slot === "thread-composer"
            ? (text) => controls.current.prepareMessage?.(text) ?? false
            : undefined,
        callBackend: bindFrontendServices(
          currentServices.current,
          entry,
          abort.signal,
        ).callBackend,
      },
      () => setFailed(true),
    );
    return () => {
      abort.abort();
      cleanup();
    };
  }, [entry, surface, locale, threadId, user?.id, router]);
  return (
    <section
      aria-label={surface.title}
      data-surface-id={surface.id}
      className={surface.slot === "thread-panel" ? "size-full" : undefined}
    >
      {failed && <p role="alert">{t.extensions.viewFailed}</p>}
      <div
        ref={ref}
        className={surface.slot === "thread-panel" ? "size-full" : undefined}
      />
    </section>
  );
}

export function PluginSurfaces({
  slot,
  namespace,
  surfaceId,
  threadId,
  prepareMessage,
}: {
  slot: SurfaceSlot;
  namespace?: string;
  surfaceId?: string;
  threadId?: string;
  prepareMessage?: (text: string) => boolean;
}) {
  const query = useFrontendExtensions();
  const { user } = useAuth();
  return activeFrontendExtensions(query.data ?? [])
    .filter(
      ({ contribution }) => !namespace || contribution.namespace === namespace,
    )
    .flatMap(({ contribution: entry, extension }) =>
      (extension.surfaces ?? [])
        .filter(
          (surface) =>
            surface.slot === slot && (!surfaceId || surface.id === surfaceId),
        )
        .map((surface) => (
          <Surface
            key={`${user?.id}:${threadId}:${entry.namespace}:${surface.id}`}
            entry={entry}
            surface={surface}
            threadId={threadId}
            prepareMessage={prepareMessage}
          />
        )),
    );
}
