// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { Check, FolderGit2, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useCachedResource } from "@/api/cache/cached-resource";
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
} from "@/shared/ui";
import { currentSpaceKey, useSpaceFolders } from "../../engines/enginesApi";
import { DeleteWorktreeDialog } from "./DeleteWorktreeDialog";
import { dirNameOf } from "./prInput";
import { WorktreeCreateDialog } from "./WorktreeCreateDialog";
import { WorktreeProgressRow } from "./WorktreeProgressRow";
import { worktreeApi, type WorktreeInfo, type WorktreeListing } from "./worktreeApi";
import { ensureWorktreeEvents, useWorktreeStore } from "./worktreeStore";

const noFolders: string[] = [];

const errorText = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));

/** The menu's rows before its worktrees are first read: the main checkout (checked), then two
 * worktrees with their remove button. */
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

/**
 * The folder's Git worktrees, as a menu in the panel's head: each worktree (the one the chat
 * works in checked), creations still running, and ways to make or remove one. Picking a
 * worktree linked to the Space switches the chat's folder to it.
 */
export function WorktreesButton({ folder }: { folder: string }) {
  const space = currentSpaceKey();
  const linked = useSpaceFolders((state) => state.folders[space] ?? noFolders);
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
  // Git is asked only once the menu has been opened; from then on the last listing shows at once
  // (this folder's, kept on this computer) and is read again each time the menu opens.
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
    useSpaceFolders.getState().choose(space, path);
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
                const isLinked = linked.includes(worktree.path);
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
                            : "Not linked to this Space"
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
