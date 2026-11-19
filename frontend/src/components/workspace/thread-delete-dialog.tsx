"use client";

import { useParams, usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { resetThreadChatAfterDelete } from "@/components/workspace/chats/use-thread-chat";
import { useI18n } from "@/core/i18n/hooks";
import { useDeleteThread } from "@/core/threads/hooks";
import type { AgentThread } from "@/core/threads/types";
import { pathOfThread, titleOfThread } from "@/core/threads/utils";

type DeleteOptions = {
  recentThreadId?: string | undefined;
  afterDelete?: (threadIds: string[]) => void;
};
type DeleteRequest = DeleteOptions &
  ({ thread: AgentThread } | { threads: AgentThread[] });
type DeleteTarget = DeleteOptions & { threads: AgentThread[]; bulk: boolean };
const ThreadDeleteContext = createContext<
  ((target: DeleteRequest) => void) | null
>(null);

export function useThreadDeleteDialog() {
  const requestDelete = useContext(ThreadDeleteContext);
  if (!requestDelete) throw new Error("ThreadDeleteDialogProvider is required");
  return requestDelete;
}

export function ThreadDeleteDialogProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const { thread_id: threadIdFromPath, agent_name: agentNameFromPath } =
    useParams<{ thread_id: string; agent_name?: string }>();
  const { mutateAsync: deleteThread } = useDeleteThread();
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  // A partial deletion can remove the row on a list refresh. Keep its snapshot
  // and the retry dialog in this stable host, outside the virtualized lists.
  const [target, setTarget] = useState<DeleteTarget | null>(null);
  const deleteInFlight = useRef(false);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Wait for React to re-enable the button before restoring focus.
    if (target && deleteFailed && !isDeleting) deleteCancelRef.current?.focus();
  }, [target, deleteFailed, isDeleting]);

  const handleDelete = useCallback(async () => {
    if (!target || deleteInFlight.current) return;
    deleteInFlight.current = true;
    setIsDeleting(true);
    setDeleteFailed(false);
    const nextThreadPath = pathOfThread("new", {
      agent_name: agentNameFromPath,
    });
    const failures: AgentThread[] = [];
    const deleted: string[] = [];
    let lastError: unknown;
    try {
      for (const thread of target.threads) {
        const currentPathname =
          typeof window === "undefined" ? pathname : window.location.pathname;
        const isCurrentThread =
          thread.thread_id === threadIdFromPath ||
          pathOfThread(thread) === currentPathname ||
          (currentPathname === nextThreadPath &&
            target.recentThreadId === thread.thread_id);
        try {
          await deleteThread({
            threadId: thread.thread_id,
            onDeleted: isCurrentThread
              ? () => {
                  resetThreadChatAfterDelete({
                    deletedThreadId: thread.thread_id,
                    nextPath: nextThreadPath,
                    force: true,
                  });
                  void router.replace(nextThreadPath);
                }
              : undefined,
          });
          deleted.push(thread.thread_id);
        } catch (error) {
          failures.push(thread);
          lastError = error;
          console.error("Failed to delete chat:", error);
        }
      }
      target.afterDelete?.(deleted);
      if (failures.length) {
        setTarget({ ...target, threads: failures });
        setDeleteFailed(true);
        toast.error(
          target.bulk
            ? t.chats.bulkDeleteFailed(failures.length)
            : lastError instanceof Error && lastError.message
              ? lastError.message
              : t.chats.deleteFailed,
        );
      } else {
        setTarget(null);
      }
    } finally {
      deleteInFlight.current = false;
      setIsDeleting(false);
    }
  }, [
    agentNameFromPath,
    deleteThread,
    pathname,
    router,
    target,
    threadIdFromPath,
    t.chats.deleteFailed,
    t.chats.bulkDeleteFailed,
  ]);

  const requestDelete = useCallback((next: DeleteRequest) => {
    if (deleteInFlight.current) return;
    setDeleteFailed(false);
    if ("thread" in next) {
      setTarget({ ...next, threads: [next.thread], bulk: false });
    } else if (next.threads.length) {
      setTarget({ ...next, bulk: true });
    }
  }, []);
  return (
    <ThreadDeleteContext.Provider value={requestDelete}>
      {children}
      <Dialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open && !deleteInFlight.current) setTarget(null);
        }}
      >
        <DialogContent
          showCloseButton={!isDeleting}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            deleteCancelRef.current?.focus();
          }}
          onEscapeKeyDown={(event) => {
            if (deleteInFlight.current) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (deleteInFlight.current) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t.chats.deleteChat}</DialogTitle>
            <DialogDescription className="break-words">
              {target?.bulk
                ? t.chats.bulkDeleteConfirm(target.threads.length)
                : target?.threads[0] &&
                  t.chats.deleteConfirm(
                    titleOfThread(target.threads[0], t.pages.untitled),
                  )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              ref={deleteCancelRef}
              variant="outline"
              onClick={() => setTarget(null)}
              disabled={isDeleting}
            >
              {t.common.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleDelete()}
              disabled={isDeleting}
            >
              {isDeleting ? t.common.loading : t.common.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ThreadDeleteContext.Provider>
  );
}
