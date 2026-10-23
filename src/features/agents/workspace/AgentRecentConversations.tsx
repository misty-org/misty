import { memo, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { globalMistyError } from "@/features/misty/globalMistyActions";
import { IconButton } from "@/shared/ui";
import { AgentFolderGroup } from "../folders/AgentFolderGroup";
import { useAgentFoldersStore, type AgentConversationFolder } from "../folders/agentFoldersStore";
import { useConversationDrop, type ConversationDrop } from "../folders/useConversationDrop";
import { AgentLessons, useAgentLessons } from "../lessons/AgentLessons";
import { AgentRecentRow } from "./AgentRecentRow";
import type { RecentStatus } from "./RecentStatusBadge";

export type { RecentStatus };

type Recent = { id: string; title?: string; folderId?: string };
/** One folder and the conversations filed in it, newest first. */
export type RecentFolder = { folder: AgentConversationFolder; conversations: Recent[] };

/**
 * The sidebar's conversations: the agent's projects (stored as folders) first, then
 * unfiled Conversations.
 * Cmd/Ctrl-click toggles a row and Shift-click selects a range across both, as in
 * Finder; a plain click just opens it. Dragging rows onto a project or Conversations files them.
 */
/** Memoized: the open conversation's streaming updates must not re-render every row. */
export const AgentRecentConversations = memo(function AgentRecentConversations({
  agentId,
  folders: allFolders = [],
  recent: allRecent,
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
  // Lessons (Teach mode) have their own section and leave Projects and Conversations.
  const lessons = useAgentLessons(agentId);
  const lessonIds = useMemo(() => new Set(lessons.map((lesson) => lesson.id)), [lessons]);
  const folders = useMemo(
    () =>
      lessonIds.size
        ? allFolders.map((group) => ({
            ...group,
            conversations: group.conversations.filter((c) => !lessonIds.has(c.id)),
          }))
        : allFolders,
    [allFolders, lessonIds],
  );
  const recent = useMemo(
    () => (lessonIds.size ? allRecent.filter((c) => !lessonIds.has(c.id)) : allRecent),
    [allRecent, lessonIds],
  );
  const [selected, setSelected] = useState<string[]>([]);
  const anchor = useRef<string | undefined>(undefined);
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
      { id: "", name: "Conversations" },
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
      selectedCount={selected.includes(c.id) ? count : 0}
      onDeleteSelected={() => void deleteSelected()}
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
      <AgentLessons
        lessons={lessons}
        activeId={activeId}
        disabled={disabled}
        onConversation={onConversation}
      />
      <div
        ref={recentsRef}
        className="agent-studio-recents-group"
        role="group"
        aria-label="Conversations"
      >
        <div className="agent-studio-recents-heading">
          <h2>Conversations</h2>
        </div>
        {recent.map(row)}
      </div>
      <span className="sr-only" role="status">
        {announcement}
      </span>
      {error && (
        <p role="alert" className="px-2 py-1 text-xs text-cream-muted">
          {error}
        </p>
      )}
    </section>
  );
});
