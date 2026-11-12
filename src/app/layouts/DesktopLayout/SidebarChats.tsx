import { ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  AgentAvatar,
  fileChats,
  forkChat,
  isChatUnread,
  setChatsArchived,
  setChatsPinned,
  setChatsUnread,
  useChatSectionsStore,
  useMistyStore,
  type ChatSection,
  type ChatStatus,
} from "@/features/agents";
import type { AgentProfile } from "@/shared/schemas";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  Button,
  ContextMenu,
  ContextMenuAction,
  ContextMenuContent,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  ErrorNotification,
  Pressable,
} from "@/shared/ui";
import { ChatRow, pressMenuKey, RenameRow, SectionNameDialog } from "./SidebarChatRows";
import type { OpenPlace } from "./spaceNavigation";

export interface SidebarChat {
  id: string;
  title: string;
  updatedAt: string;
  agentId?: string;
  folderId?: string;
  pinnedAt?: string;
  archivedAt?: string;
  markedUnread?: boolean;
  lastReadAt?: string;
}

/** The unfiled chats' value in the Move to section menu. */
const unfiled = "";

interface Group {
  id: string;
  name: string;
  chats: SidebarChat[];
  section?: ChatSection;
  collapsible?: boolean;
}

/**
 * The sidebar's chats: pinned ones first, then each section the person made, then the rest, and
 * archived ones folded away at the end. A click opens a chat; Command- or Control-click picks
 * several and Shift-click a run of them, which only highlights them. Right-click a chat for
 * everything else (open it elsewhere, pin, mark unread, rename, fork, file, archive or delete),
 * each with a one-letter key; on a picked chat it acts on all of them.
 */
export function SidebarChats(props: {
  chats: SidebarChat[];
  agentOf(agentId?: string): AgentProfile | undefined;
  statuses: Record<string, ChatStatus>;
  openChat: string | null;
  onOpen(agent: AgentProfile, chatId: string): void;
  onOpenIn(agent: AgentProfile, chatId: string, place: OpenPlace): void;
  /** The open chat was deleted, so the page needs somewhere else to be. */
  onOpenGone(): void;
}) {
  const { chats, openChat } = props;
  const sections = useChatSectionsStore((state) => state.folders);
  const [selected, setSelected] = useState<string[]>([]);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string[] | null>(null);
  const [naming, setNaming] = useState<{ ids: string[] } | { section: ChatSection } | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const anchor = useRef<string | null>(null);
  // A menu item that hands focus to a field or dialog keeps the menu from taking it back.
  const keepFocus = useRef(false);

  const groups = useMemo(() => {
    const live = chats.filter((chat) => !chat.archivedAt);
    const filed = new Set(sections.map((section) => section.id));
    const list: Group[] = [];
    const pinned = live.filter((chat) => chat.pinnedAt);
    if (pinned.length) list.push({ id: "pinned", name: "Pinned", chats: pinned });
    for (const section of sections) {
      const held = live.filter((chat) => !chat.pinnedAt && chat.folderId === section.id);
      if (held.length) list.push({ id: section.id, name: section.name, chats: held, section });
    }
    const rest = live.filter(
      (chat) => !chat.pinnedAt && !(chat.folderId && filed.has(chat.folderId)),
    );
    if (rest.length || !list.length) list.push({ id: "chats", name: "Chats", chats: rest });
    const archived = chats.filter((chat) => chat.archivedAt);
    if (archived.length)
      list.push({ id: "archived", name: "Archived", chats: archived, collapsible: true });
    return list;
  }, [chats, sections]);
  // Every row on screen in order, for a Shift-click run.
  const shown = useMemo(
    () =>
      groups.flatMap((group) =>
        group.collapsible && !archivedOpen ? [] : group.chats.map((chat) => chat.id),
      ),
    [groups, archivedOpen],
  );
  const picked = selected.filter((id) => shown.includes(id));

  // Opening a chat reads it, and so does leaving it, for what arrived while it was open. One
  // marked unread while open stays unread.
  const lastOpen = useRef<string | null>(null);
  useEffect(() => {
    const left = lastOpen.current;
    lastOpen.current = openChat;
    const read = useMistyStore
      .getState()
      .conversations.filter(
        (chat) =>
          (chat.id === openChat || (chat.id === left && !chat.markedUnread)) &&
          (!chat.lastReadAt || isChatUnread(chat)),
      )
      .map((chat) => chat.id);
    if (read.length) setChatsUnread(read, false);
  }, [openChat]);

  const pick = (id: string, event: MouseEvent) => {
    if (event.shiftKey) {
      const from = shown.indexOf(anchor.current ?? openChat ?? id);
      const to = shown.indexOf(id);
      if (from >= 0 && to >= 0) {
        setSelected(shown.slice(Math.min(from, to), Math.max(from, to) + 1));
        return;
      }
    }
    anchor.current = id;
    // Starting a pick from the open chat adds to what is on screen, as in Finder.
    const start = picked.length ? picked : openChat && openChat !== id ? [openChat] : [];
    setSelected(start.includes(id) ? start.filter((known) => known !== id) : [...start, id]);
  };

  const rename = (id: string, title?: string) => {
    setRenaming(null);
    if (title === undefined) return;
    void useMistyStore
      .getState()
      .renameConversation(id, title)
      .catch((failure: unknown) =>
        setError(failure instanceof Error ? failure.message : "That chat couldn't be renamed."),
      );
  };

  const remove = async (ids: string[]) => {
    if (busy) return;
    setBusy(true);
    setError("");
    const store = useMistyStore.getState();
    const gone: string[] = [];
    try {
      for (const id of ids) {
        await store.deleteConversation(id);
        gone.push(id);
      }
      setDeleting(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That chat couldn't be deleted.");
      setDeleting(null);
    } finally {
      setBusy(false);
      setSelected((known) => known.filter((id) => !gone.includes(id)));
      if (openChat && gone.includes(openChat)) props.onOpenGone();
    }
  };

  const nameSection = async (name: string) => {
    if (!naming || !name.trim()) return;
    const store = useChatSectionsStore.getState();
    try {
      if ("section" in naming) await store.rename(naming.section.id, name);
      else {
        const section = await store.create("", name);
        fileChats(naming.ids, section.id);
      }
      setNaming(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That section couldn't be saved.");
      setNaming(null);
    }
  };

  const menuFor = (chat: SidebarChat, archived: boolean) => {
    // Right-clicking a picked chat acts on everything picked; any other acts on that one.
    const ids = picked.includes(chat.id) && picked.length > 1 ? picked : [chat.id];
    const many = ids.length > 1;
    const targets = chats.filter((item) => ids.includes(item.id));
    const allPinned = targets.every((item) => item.pinnedAt);
    const allUnread = targets.every((item) => isChatUnread(item));
    const places = new Set(targets.map((item) => item.folderId ?? unfiled));
    const place = places.size === 1 ? [...places][0]! : undefined;
    const agent = props.agentOf(chat.agentId);
    const working = targets.some((item) => props.statuses[item.id] === "working");
    const openIn = (where: OpenPlace) => agent && props.onOpenIn(agent, chat.id, where);
    const count = many ? ` ${ids.length} chats` : "";
    return (
      <ContextMenuContent
        className="min-w-52"
        onKeyDown={pressMenuKey}
        onCloseAutoFocus={(event) => {
          if (keepFocus.current) event.preventDefault();
          keepFocus.current = false;
        }}
      >
        <ContextMenuSub>
          <ContextMenuSubTrigger disabled={many || !agent}>Open in</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuAction label="New tab" onSelect={() => openIn("tab")} />
            <ContextMenuAction label="Split right" onSelect={() => openIn("right")} />
            <ContextMenuAction label="Split down" onSelect={() => openIn("down")} />
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        {archived ? null : (
          <ContextMenuAction
            label={allPinned ? `Unpin${count}` : `Pin${count}`}
            shortcut="P"
            data-menu-key="p"
            onSelect={() => setChatsPinned(ids, !allPinned)}
          />
        )}
        <ContextMenuAction
          label={allUnread ? "Mark as read" : "Mark as unread"}
          shortcut="U"
          data-menu-key="u"
          onSelect={() => setChatsUnread(ids, !allUnread)}
        />
        <ContextMenuAction
          label="Rename"
          shortcut="R"
          data-menu-key="r"
          disabled={many}
          onSelect={() => {
            keepFocus.current = true;
            setSelected([]);
            setRenaming(chat.id);
          }}
        />
        <ContextMenuAction
          label="Fork"
          shortcut="F"
          data-menu-key="f"
          disabled={many || working || !agent}
          onSelect={() => {
            const fork = forkChat(chat.id);
            if (fork && agent) props.onOpen(agent, fork);
          }}
        />
        <ContextMenuSeparator />
        {archived ? null : (
          <ContextMenuSub>
            <ContextMenuSubTrigger>Move to section</ContextMenuSubTrigger>
            <ContextMenuSubContent className="min-w-44">
              <ContextMenuRadioGroup
                value={place ?? "mixed"}
                onValueChange={(next) => fileChats(ids, next)}
              >
                <ContextMenuRadioItem value={unfiled}>Chats</ContextMenuRadioItem>
                {sections.map((section) => (
                  <ContextMenuRadioItem key={section.id} value={section.id}>
                    <span className="min-w-0 flex-1 truncate">{section.name}</span>
                  </ContextMenuRadioItem>
                ))}
              </ContextMenuRadioGroup>
              <ContextMenuSeparator />
              <ContextMenuAction
                label="New section…"
                onSelect={() => {
                  keepFocus.current = true;
                  setNaming({ ids });
                }}
              />
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}
        {archived ? null : <ContextMenuSeparator />}
        <ContextMenuAction
          label={archived ? `Unarchive${count}` : `Archive${count}`}
          shortcut="A"
          data-menu-key="a"
          onSelect={() => {
            setChatsArchived(ids, !archived);
            setSelected([]);
          }}
        />
        <ContextMenuAction
          label={`Delete${count}`}
          shortcut="D"
          data-menu-key="d"
          destructive
          onSelect={() => {
            keepFocus.current = true;
            setDeleting(ids);
          }}
        />
      </ContextMenuContent>
    );
  };

  const head = (group: Group) => {
    const name = group.collapsible ? (
      <Pressable
        type="button"
        className="misty-space-nav-group-name"
        aria-expanded={archivedOpen}
        onClick={() => setArchivedOpen((open) => !open)}
      >
        {group.name}
        <span className="misty-space-nav-group-count">{group.chats.length}</span>
        <ChevronRight
          className="misty-space-nav-group-chevron size-3"
          data-open={archivedOpen || undefined}
          aria-hidden="true"
        />
      </Pressable>
    ) : (
      <span className="misty-space-nav-group-name">{group.name}</span>
    );
    const { section } = group;
    if (!section) return <div className="misty-space-nav-group">{name}</div>;
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="misty-space-nav-group">{name}</div>
        </ContextMenuTrigger>
        <ContextMenuContent
          onKeyDown={pressMenuKey}
          onCloseAutoFocus={(event) => {
            if (keepFocus.current) event.preventDefault();
            keepFocus.current = false;
          }}
        >
          <ContextMenuAction
            label="Rename section"
            shortcut="R"
            data-menu-key="r"
            onSelect={() => {
              keepFocus.current = true;
              setNaming({ section });
            }}
          />
          <ContextMenuAction
            label="Delete section"
            shortcut="D"
            data-menu-key="d"
            destructive
            onSelect={() =>
              void useChatSectionsStore
                .getState()
                .remove(section.id)
                .catch(() => setError("That section couldn't be deleted."))
            }
          />
        </ContextMenuContent>
      </ContextMenu>
    );
  };

  const deletingChats = chats.filter((chat) => deleting?.includes(chat.id));
  return (
    <div
      className="contents"
      onKeyDown={(event) => {
        if (event.key === "Escape" && picked.length) setSelected([]);
      }}
    >
      {error ? <ErrorNotification message={error} onDismiss={() => setError("")} /> : null}
      {groups.map((group) => (
        <section key={group.id} aria-label={group.name}>
          {head(group)}
          {group.collapsible && !archivedOpen
            ? null
            : group.chats.map((chat) => {
                const agent = props.agentOf(chat.agentId);
                const mark = <AgentAvatar agent={agent} compact />;
                if (renaming === chat.id)
                  return (
                    <RenameRow
                      key={chat.id}
                      chat={chat}
                      mark={mark}
                      onDone={(title) => rename(chat.id, title)}
                    />
                  );
                return (
                  <ContextMenu key={chat.id}>
                    <ContextMenuTrigger asChild>
                      <div>
                        <ChatRow
                          chat={chat}
                          mark={mark}
                          status={props.statuses[chat.id]}
                          current={openChat === chat.id}
                          selected={picked.includes(chat.id)}
                          unread={openChat !== chat.id && isChatUnread(chat)}
                          onPress={(event) => {
                            if (event.metaKey || event.ctrlKey || event.shiftKey)
                              pick(chat.id, event);
                            else {
                              setSelected([]);
                              anchor.current = chat.id;
                              if (agent) props.onOpen(agent, chat.id);
                            }
                          }}
                        />
                      </div>
                    </ContextMenuTrigger>
                    {menuFor(chat, Boolean(chat.archivedAt))}
                  </ContextMenu>
                );
              })}
        </section>
      ))}
      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogTitle>
            {deletingChats.length > 1 ? `Delete ${deletingChats.length} chats?` : "Delete chat?"}
          </AlertDialogTitle>
          <AlertDialogDescription className="break-words">
            {deletingChats.length > 1
              ? "These chats and their messages will be deleted from this computer. This can't be undone."
              : `“${deletingChats[0]?.title || "New conversation"}” and its messages will be deleted from this computer. This can't be undone.`}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => void remove(deletingChats.map((chat) => chat.id))}
            >
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <SectionNameDialog
        open={naming !== null}
        renaming={naming && "section" in naming ? naming.section : undefined}
        onClose={() => setNaming(null)}
        onSave={(name) => void nameSection(name)}
      />
    </div>
  );
}
