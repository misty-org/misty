// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { Check, FolderGit2, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useCachedResource } from "@/api/cache/cached_resource";
import {
  Button,
  IconButton,
  MenuTrigger,
  Popover,
  PopoverContent,
  Pressable,
  Separator,
  Skeleton,
  Surface,
  Text,
  Tooltip,
  useNotice,
} from "@misty/ui";
import { useChatFolders, useProjectFolders } from "../../shared-folders/chat_folder";
import { DeleteWorktreeDialog } from "./DeleteWorktreeDialog";
import { dirNameOf } from "./pr_input";
import { WorktreeCreateDialog } from "./WorktreeCreateDialog";
import { WorktreeProgressRow } from "./WorktreeProgressRow";
import { worktreeApi, type WorktreeInfo, type WorktreeListing } from "./worktree_api";
import { ensureWorktreeEvents, useWorktreeStore } from "./worktree_store";

const errorText = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));

const skeletonRows = (
  <div role="status" aria-label="Worktrees" aria-busy="true" className="flex flex-col gap-px">
    {["w-2/5", "w-1/2", "w-1/3"].map((width, index) => (
      <div key={width} className="flex h-8 items-center pr-0.5">
        <div className="flex min-w-0 flex-1 items-center gap-2 pr-1.5 pl-2">
          {index === 0 ? (
            <Skeleton className="size-4 shrink-0 rounded-sm" />
          ) : (
            <span className="size-4 shrink-0" />
          )}
          <Skeleton className={`h-3 rounded-sm ${width}`} />
        </div>
        {index === 0 ? null : <Skeleton className="size-6 shrink-0 rounded-md" />}
      </div>
    ))}
  </div>
);

export function WorktreesButton({
  folder,
  conversationId,
}: {
  folder: string;
  conversationId: string;
}) {
  const projects = useProjectFolders();
  const revision = useWorktreeStore((s) => s.revision);
  const notice = useWorktreeStore((s) => s.notice);
  const noticeTone = useWorktreeStore((s) => s.noticeTone);
  useNotice(Boolean(notice), {
    message: notice,
    tone: noticeTone,
    onDismiss: () => useWorktreeStore.getState().clearNotice(),
  });
  const pending = useWorktreeStore((s) => s.pending);
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  const worktrees = useCachedResource<WorktreeListing>(
    opened ? `agents/worktrees:${folder}` : null,
    () => worktreeApi.list(folder),
    { persist: "device" },
  );
  const listing = worktrees.data ?? null;
  const error = worktrees.error && !listing ? errorText(worktrees.error) : "";
  const reloadWorktrees = worktrees.reload;
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<WorktreeInfo | null>(null);

  useEffect(() => {
    ensureWorktreeEvents();
  }, []);
  useEffect(() => {
    if (open) void reloadWorktrees();
  }, [open, reloadWorktrees, revision]);

  const mine = pending.filter((p) => p.folder === folder || p.folder === listing?.repository);
  const choose = (path: string) => {
    void useChatFolders
      .getState()
      .use(conversationId, path)
      .catch(() => undefined);
    setOpen(false);
  };

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next) setOpened(true);
          setOpen(next);
        }}
      >
        <MenuTrigger
          kind="popover"
          iconOnly
          label="Worktrees"
          icon={FolderGit2}
          data-active={mine.length > 0 || undefined}
        />
        <PopoverContent align="end" size="lg" kind="list">
          {!listing && !error ? skeletonRows : null}
          {error ? (
            <Text wrap size="meta" tone="muted" className="p-2">
              {error}
            </Text>
          ) : null}
          {listing ? (
            <div className="flex flex-col gap-px" role="list">
              {listing.worktrees.map((worktree) => {
                const isLinked = Boolean(
                  projects?.some((project) => project.path === worktree.path),
                );
                const current = worktree.path === folder;
                const name = worktree.isMain
                  ? dirNameOf(worktree.path)
                  : (worktree.branch ?? dirNameOf(worktree.path));
                return (
                  <Surface
                    key={worktree.path}
                    role="listitem"
                    tone="none"
                    wash="control"
                    radius="md"
                    className="flex h-8 min-w-0 items-center gap-1.5 pr-0.5 text-meta"
                  >
                    <Tooltip
                      content={
                        worktree.prunable
                          ? "Its folder is gone"
                          : isLinked
                            ? worktree.path
                            : "Not one of your projects"
                      }
                    >
                      <Pressable
                        className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md pr-1.5 pl-2 disabled:opacity-100"
                        disabled={!isLinked || current || worktree.prunable}
                        onClick={() => choose(worktree.path)}
                      >
                        {current ? (
                          <Check aria-hidden="true" className="shrink-0" />
                        ) : (
                          <span className="size-4 shrink-0" />
                        )}
                        <Text tone="default" className="flex-1">
                          {name}
                        </Text>
                        {worktree.isMain && worktree.branch ? (
                          <Text tone="muted" className="max-w-[45%] flex-none text-micro">
                            {worktree.branch}
                          </Text>
                        ) : null}
                        {worktree.prunable ? (
                          <Text tone="muted" className="max-w-[45%] flex-none text-micro">
                            Missing
                          </Text>
                        ) : null}
                      </Pressable>
                    </Tooltip>
                    {!worktree.isMain ? (
                      <IconButton
                        label={`Remove ${name}`}
                        size="sm"
                        disabled={worktree.locked}
                        hint={worktree.locked ? "Locked by Git" : undefined}
                        onClick={() => setRemoving(worktree)}
                      >
                        <Trash2 />
                      </IconButton>
                    ) : null}
                  </Surface>
                );
              })}
              {mine.map((entry) => (
                <WorktreeProgressRow key={entry.creationId} pending={entry} />
              ))}
            </div>
          ) : null}
          <Separator className="mt-1" />
          <div className="flex pt-1">
            <Button
              type="button"
              variant="quiet"
              icon={Plus}
              disabled={!listing}
              onClick={() => {
                setCreating(true);
                setOpen(false);
              }}
            >
              New worktree
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      {listing && creating ? (
        <WorktreeCreateDialog
          folder={folder}
          conversationId={conversationId}
          listing={listing}
          open={creating}
          onOpenChange={setCreating}
        />
      ) : null}
      {listing && removing ? (
        <DeleteWorktreeDialog
          folder={folder}
          worktree={removing}
          branches={listing.branches}
          open={removing != null}
          onOpenChange={(next) => !next && setRemoving(null)}
        />
      ) : null}
    </>
  );
}
