import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { MessageSquare, Pencil, Trash2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Button, Input, cn } from "@/ui";
import { useAgentSessionStore } from "@/stores/assistant/useAgentSessionStore";

/**
 * The saved chats for the currently active agent, shown inline beneath its row.
 * Only the selected agent's scope is live in the session store, so this renders
 * for the expanded (selected) agent alone — the accordion's open panel. New chats
 * are started from the agent header's + button, not from this list.
 */
export function AgentChatList() {
  const {
    conversations,
    activeConversationId,
    switchConversation,
    renameConversation,
    deleteConversationSession,
  } = useAgentSessionStore(
    useShallow((state) => ({
      conversations: state.conversations,
      activeConversationId: state.activeConversationId,
      switchConversation: state.switchConversation,
      renameConversation: state.renameConversation,
      deleteConversationSession: state.deleteConversationSession,
    })),
  );
  // Stable oldest-first order so the list only ever grows downward — selecting or
  // updating a chat never reshuffles the rows.
  const ordered = [...conversations].sort((left, right) => left.createdAt - right.createdAt);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (renamingId !== null) renameInputRef.current?.select();
  }, [renamingId]);

  const startRename = (id: string, currentTitle: string) => {
    setRenamingId(id);
    setRenameValue(currentTitle);
  };

  const commitRename = (id: string) => {
    const next = renameValue.trim();
    setRenamingId(null);
    if (next) void renameConversation(id, next);
  };

  const onRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>, id: string) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitRename(id);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setRenamingId(null);
    }
  };

  return (
    <nav className="grid gap-1" aria-label="Agent chats">
      {ordered.map((conversation) => {
        const active = conversation.id === activeConversationId;
        const renaming = renamingId === conversation.id;
        return (
          <div className={chatRowClass(active)} key={conversation.id}>
            {renaming ? (
              <div className="grid min-h-11 min-w-0 flex-1 grid-cols-[32px_minmax(0,1fr)] items-center gap-2.5 px-2.5">
                <span className="grid size-7 place-items-center rounded-md bg-sidebar-accent text-muted-foreground">
                  <MessageSquare size={14} />
                </span>
                <Input
                  ref={renameInputRef}
                  value={renameValue}
                  className="h-7 min-w-0 px-1.5 py-0 text-sm"
                  onChange={(event) => setRenameValue(event.target.value)}
                  onKeyDown={(event) => onRenameKeyDown(event, conversation.id)}
                  onBlur={() => commitRename(conversation.id)}
                />
              </div>
            ) : (
              <>
                <button
                  type="button"
                  className="grid min-h-11 min-w-0 flex-1 grid-cols-[32px_minmax(0,1fr)] items-center gap-2.5 rounded-md bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:ring-1 focus-visible:ring-sidebar-ring"
                  aria-current={active ? "true" : undefined}
                  onClick={() => void switchConversation(conversation.id)}
                  onDoubleClick={() => startRename(conversation.id, conversation.title)}
                >
                  <span className="grid size-7 place-items-center rounded-md bg-sidebar-accent text-muted-foreground">
                    <MessageSquare size={14} />
                  </span>
                  <span className="min-w-0 truncate text-left font-medium">
                    {conversation.title}
                  </span>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0 text-muted-foreground opacity-0 shadow-none hover:text-foreground group-hover/chat:opacity-100 focus-visible:opacity-100"
                  type="button"
                  aria-label={`Rename chat "${conversation.title}"`}
                  onClick={() => startRename(conversation.id, conversation.title)}
                >
                  <Pencil size={12} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="mr-1 size-7 shrink-0 text-muted-foreground opacity-0 shadow-none hover:bg-destructive/10 hover:text-destructive group-hover/chat:opacity-100 focus-visible:opacity-100"
                  type="button"
                  aria-label={`Delete chat "${conversation.title}"`}
                  onClick={() => void deleteConversationSession(conversation.id)}
                >
                  <Trash2 size={12} />
                </Button>
              </>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function chatRowClass(active: boolean) {
  return cn(
    "group/chat flex min-w-0 items-center rounded-md bg-none transition-colors hover:bg-none",
    active
      ? "bg-sidebar-accent text-sidebar-accent-foreground"
      : "text-sidebar-foreground hover:bg-sidebar-accent/65 hover:text-sidebar-accent-foreground",
  );
}
