// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { Check, FolderGit2, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  Button,
  IconButton,
  MenuTrigger,
  Popover,
  PopoverContent,
  Pressable,
  Skeleton,
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
import "./worktree.css";

const noFolders: string[] = [];

const errorText = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));

/** The rows a menu shows while its worktrees are read: shaped like them. */
const skeletonRows = (
  <div className="grid gap-2 px-2 py-1.5" aria-hidden="true">
    <Skeleton className="h-4 w-2/3" />
    <Skeleton className="h-4 w-1/2" />
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
  const [listing, setListing] = useState<WorktreeListing | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<WorktreeInfo | null>(null);

  const load = useCallback(() => {
    setError("");
    return worktreeApi
      .list(folder)
      .then(setListing)
      .catch((reason) => {
        setListing(null);
        setError(errorText(reason));
      });
  }, [folder]);

  useEffect(() => {
    ensureWorktreeEvents();
  }, []);
  useEffect(() => {
    setListing(null);
  }, [folder]);
  useEffect(() => {
    if (open) void load();
  }, [open, load, revision]);

  const mine = pending.filter((p) => p.folder === folder || p.folder === listing?.repository);
  const choose = (path: string) => {
    useSpaceFolders.getState().choose(space, path);
    setOpen(false);
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <MenuTrigger
          kind="popover"
          iconOnly
          label="Worktrees"
          icon={FolderGit2}
          data-active={mine.length > 0 || undefined}
        />
        <PopoverContent align="end" className="worktree-menu">
          {!listing && !error ? skeletonRows : null}
          {error ? <p className="worktree-empty">{error}</p> : null}
          {listing ? (
            <div className="worktree-list" role="list">
              {listing.worktrees.map((worktree) => {
                const isLinked = linked.includes(worktree.path);
                const current = worktree.path === folder;
                const name = worktree.isMain
                  ? dirNameOf(worktree.path)
                  : (worktree.branch ?? dirNameOf(worktree.path));
                return (
                  <div
                    key={worktree.path}
                    role="listitem"
                    className="worktree-row worktree-row--item"
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
                        className="worktree-row-main"
                        disabled={!isLinked || current || worktree.prunable}
                        onClick={() => choose(worktree.path)}
                      >
                        {current ? (
                          <Check size={15} aria-hidden="true" className="shrink-0" />
                        ) : (
                          <span className="size-4 shrink-0" />
                        )}
                        <span className="worktree-row-name">{name}</span>
                        {worktree.isMain && worktree.branch ? (
                          <span className="worktree-branch-tag">{worktree.branch}</span>
                        ) : null}
                        {worktree.prunable ? (
                          <span className="worktree-branch-tag">Missing</span>
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
                  </div>
                );
              })}
              {mine.map((entry) => (
                <WorktreeProgressRow key={entry.creationId} pending={entry} />
              ))}
            </div>
          ) : null}
          <div className="worktree-menu-foot">
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
