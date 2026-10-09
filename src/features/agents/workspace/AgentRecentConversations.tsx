import { memo, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { FolderPlus, Trash2, X } from "lucide-react";
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
import { AgentConversationActions } from "../components/AgentConversationActions";
import { AgentFolderGroup } from "../folders/AgentFolderGroup";
import { useAgentFoldersStore, type AgentConversationFolder } from "../folders/agentFoldersStore";
import { FolderNameDialog } from "../folders/FolderNameDialog";
import { RecentStatusBadge, type RecentStatus } from "./RecentStatusBadge";

export type { RecentStatus };

type Recent = { id: string; title?: string; folderId?: string };
/** One folder and the conversations filed in it, newest first. */
export type RecentFolder = { folder: AgentConversationFolder; conversations: Recent[] };

/**
 * The sidebar's conversations: the agent's folders first, then unfiled Recents.
 * Cmd/Ctrl-click toggles a row and Shift-click selects a range across both, as in
 * Finder; a plain click just opens it.
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
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const anchor = useRef<string | undefined>(undefined);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [params, setParams] = useSearchParams();
  const [creatingFolder, setCreatingFolder] = useState(false);
  // Every listed row in screen order, so a Shift-click range can span folders and Recents.
  const visible = useMemo(
    () => [...folders.flatMap((group) => group.conversations), ...recent],
    [folders, recent],
  );

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
    <div
      key={c.id}
      className="agent-studio-recent-row"
      data-selected={selected.includes(c.id) || undefined}
    >
      <Button
        data-agent-navigation-control
        variant="ghost"
        justify="start"
        disabled={disabled}
        title={c.title || "Untitled conversation"}
        aria-current={activeId === c.id ? "page" : undefined}
        aria-pressed={count ? selected.includes(c.id) : undefined}
        onClick={(event) => click(event, c.id)}
      >
        <RecentStatusBadge status={statuses?.[c.id]} />
        <span className="agent-studio-recent-title">{c.title || "Untitled conversation"}</span>
      </Button>
      <AgentConversationActions conversation={{ ...c, agentId }} disabled={disabled} />
    </div>
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
      {folders.map(({ folder, conversations }) => (
        <AgentFolderGroup
          key={folder.id}
          folder={folder}
          count={conversations.length}
          disabled={disabled}
        >
          {conversations.map(row)}
        </AgentFolderGroup>
      ))}
      <div className="agent-studio-recents-heading">
        <h2>Recents</h2>
        <IconButton label="New folder" disabled={disabled} onClick={() => setCreatingFolder(true)}>
          <FolderPlus size={15} />
        </IconButton>
      </div>
      {recent.map(row)}
      <FolderNameDialog
        open={creatingFolder}
        title="New folder"
        description="Group this agent's conversations. Move a conversation in from its menu."
        submitLabel="Create"
        onOpenChange={setCreatingFolder}
        onSubmit={async (name) => {
          await useAgentFoldersStore.getState().create(agentId, name);
        }}
      />
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
