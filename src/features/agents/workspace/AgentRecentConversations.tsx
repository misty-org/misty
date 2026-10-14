import { memo, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, Trash2, X } from "lucide-react";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { globalMistyError } from "@/features/global-search/globalMistyActions";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  Button,
  IconButton,
} from "@/shared/ui";
import { AgentFolderGroup } from "../folders/AgentFolderGroup";
import { useAgentFoldersStore, type AgentConversationFolder } from "../folders/agentFoldersStore";
import { useConversationDrop, type ConversationDrop } from "../folders/useConversationDrop";
import { AgentRecentRow } from "./AgentRecentRow";
import type { RecentStatus } from "./RecentStatusBadge";

export type { RecentStatus };

type Recent = { id: string; title?: string; folderId?: string };
/** One folder and the conversations filed in it, newest first. */
export type RecentFolder = { folder: AgentConversationFolder; conversations: Recent[] };

/**
 * The sidebar's conversations: the agent's projects (stored as folders) first, then
 * unfiled Recents.
 * Cmd/Ctrl-click toggles a row and Shift-click selects a range across both, as in
 * Finder; a plain click just opens it. Dragging rows onto a project or Recents files them.
 */
/** Memoized: the open conversation's streaming updates must not re-render every row. */
export const AgentRecentConversations = memo(function AgentRecentConversations({
  agentId,
  folders = [],
  recent,
  statuses,
  activeId,
  disabled,
  onConversation,
  onNewProject,
}: {
  agentId: string;
  folders?: RecentFolder[];
  /** Unfiled conversations. */
  recent: Recent[];
  /** Latest run per conversation id. */
  statuses?: Record<string, RecentStatus>;
  activeId?: string;
  disabled: boolean;
  onConversation(id: string): void;
  /** Opens the New project dialog, which the frame owns so Get started can open it too. */
  onNewProject(): void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const anchor = useRef<string | undefined>(undefined);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [params, setParams] = useSearchParams();
  const [announcement, setAnnouncement] = useState("");
  const recentsRef = useRef<HTMLDivElement>(null);
  // Every listed row in screen order, so a Shift-click range can span folders and Recents.
  const visible = useMemo(
    () => [...folders.flatMap((group) => group.conversations), ...recent],
    [folders, recent],
  );
  // Where each listed conversation is filed now; "" is Recents.
  const placeOf = useMemo(
    () =>
      new Map([
        ...folders.flatMap(({ folder, conversations }) =>
          conversations.map((c) => [c.id, folder.id] as const),
        ),
        ...recent.map((c) => [c.id, ""] as const),
      ]),
    [folders, recent],
  );
  const drop: ConversationDrop = {
    scope: `agent-conversations:${agentId}`,
    folderOf: (id) => placeOf.get(id),
    file: (ids, folderId) => {
      const moving = ids.filter((id) => placeOf.has(id) && placeOf.get(id) !== folderId);
      if (!moving.length) return;
      setSelected([]);
      void (async () => {
        const store = useAgentFoldersStore.getState();
        for (const id of moving) await store.file(id, folderId);
      })().catch((failure) => useMistyStore.setState({ error: globalMistyError(failure) }));
    },
  };
  useConversationDrop(recentsRef, drop, "");
  // Alt+Shift+Up/Down steps a conversation through the projects, then Recents.
  const places = useMemo(
    () => [
      ...folders.map(({ folder }) => ({ id: folder.id, name: folder.name })),
      { id: "", name: "Recents" },
    ],
    [folders],
  );
  const step = (id: string, direction: -1 | 1) => {
    const target = places[places.findIndex((place) => place.id === placeOf.get(id)) + direction];
    if (!target) return;
    drop.file([id], target.id);
    setAnnouncement(`Moved to ${target.name}.`);
  };

  // Drop selections whose conversations went away.
  useEffect(() => {
    setSelected((ids) => {
      const next = ids.filter((id) => visible.some((c) => c.id === id));
      return next.length === ids.length ? ids : next;
    });
  }, [visible]);

  const click = (event: MouseEvent, id: string) => {
    if (event.shiftKey && anchor.current) {
      const ids = visible.map((c) => c.id);
      const [from, to] = [ids.indexOf(anchor.current), ids.indexOf(id)].sort((a, b) => a - b);
      if (from >= 0) {
        setSelected(ids.slice(from, to + 1));
        return;
      }
    }
    anchor.current = id;
    if (event.metaKey || event.ctrlKey) {
      // Start from the open conversation, so Cmd-click adds to what's on screen.
      setSelected((ids) => {
        const base = ids.length || !activeId || activeId === id ? ids : [activeId];
        return base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
      });
      return;
    }
    setSelected([]);
    onConversation(id);
  };

  const deleteSelected = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    const store = useMistyStore.getState();
    const removed: string[] = [];
    try {
      for (const id of selected) {
        await store.deleteConversation(id);
        removed.push(id);
      }
      setConfirming(false);
      setSelected([]);
    } catch (failure) {
      setSelected((ids) => ids.filter((id) => !removed.includes(id)));
      setError(globalMistyError(failure));
    } finally {
      const open = params.get("conversation");
      if (open && removed.includes(open))
        setParams(
          (current) => {
            const next = new URLSearchParams(current);
            next.delete("conversation");
            return next;
          },
          { replace: true },
        );
      setBusy(false);
    }
  };

  const count = selected.length;
  const row = (c: Recent) => (
    <AgentRecentRow
      key={c.id}
      conversation={c}
      scope={drop.scope}
      dragIds={
        selected.includes(c.id)
          ? visible.filter((v) => selected.includes(v.id)).map((v) => v.id)
          : [c.id]
      }
      status={statuses?.[c.id]}
      active={activeId === c.id}
      selected={selected.includes(c.id)}
      selecting={count > 0}
      disabled={disabled}
      onClick={(event) => click(event, c.id)}
      onMove={(direction) => step(c.id, direction)}
    />
  );
  return (
    <section
      className="agent-studio-recents"
      aria-label="Recent conversations"
      onKeyDown={(event) => {
        if (event.key === "Escape" && count) {
          event.stopPropagation();
          setSelected([]);
        }
      }}
    >
      {count ? (
        <div className="agent-studio-recents-selection" role="toolbar" aria-label="Selection">
          <span>{count} selected</span>
          <IconButton
            label={`Delete ${count} conversation${count === 1 ? "" : "s"}`}
            disabled={disabled}
            onClick={() => {
              setError("");
              setConfirming(true);
            }}
          >
            <Trash2 size={15} />
          </IconButton>
          <IconButton label="Clear selection" onClick={() => setSelected([])}>
            <X size={15} />
          </IconButton>
        </div>
      ) : null}
      <div className="agent-studio-recents-heading">
        <h2>Projects</h2>
        <IconButton label="New project" disabled={disabled} onClick={onNewProject}>
          <Plus size={14} />
        </IconButton>
      </div>
      {folders.map(({ folder, conversations }) => (
        <AgentFolderGroup
          key={folder.id}
          folder={folder}
          count={conversations.length}
          disabled={disabled}
          drop={drop}
        >
          {conversations.map(row)}
        </AgentFolderGroup>
      ))}
      <div
        ref={recentsRef}
        className="agent-studio-recents-group"
        role="group"
        aria-label="Recents"
      >
        <div className="agent-studio-recents-heading">
          <h2>Recents</h2>
        </div>
        {recent.map(row)}
      </div>
      <span className="sr-only" role="status">
        {announcement}
      </span>
      <AlertDialog open={confirming} onOpenChange={(open) => !busy && setConfirming(open)}>
        <AlertDialogContent>
          <AlertDialogTitle>
            Delete {count} conversation{count === 1 ? "" : "s"}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            They and their messages will be permanently deleted, along with any unsent drafts. This
            cannot be undone.
          </AlertDialogDescription>
          {error && (
            <p role="alert" className="text-sm text-cream-muted">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button disabled={disabled || busy} onClick={() => void deleteSelected()}>
              {busy ? "Deleting…" : "Delete"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
});
