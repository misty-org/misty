import { MessageSquare, Plus, Trash2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";

import { Button } from "@/ui";
import { cn } from "@/ui";
import { useMikaSessionStore } from "@/stores/assistant/useMikaSessionStore";

/**
 * Session rail for the Assistant. Sessions are the Assistant's organising unit the way
 * channels are the Space chat's, so they get a persistent list rather than a dropdown.
 */
export function AssistantSessionSidebar({ embedded = false }: { embedded?: boolean }) {
  const {
    conversations,
    activeConversationId,
    startNewConversation,
    switchConversation,
    deleteConversationSession,
  } = useMikaSessionStore(
    useShallow((state) => ({
      conversations: state.conversations,
      activeConversationId: state.activeConversationId,
      startNewConversation: state.startNewConversation,
      switchConversation: state.switchConversation,
      deleteConversationSession: state.deleteConversationSession,
    })),
  );
  const ordered = [...conversations].sort((left, right) => right.updatedAt - left.updatedAt);

  const Sidebar = embedded ? "section" : "aside";

  return (
    <Sidebar
      className={cn(
        "flex min-h-0 flex-col gap-1",
        embedded ? "h-full" : "border-r border-border bg-sidebar/40 p-2",
      )}
      aria-label="Mika sessions"
    >
      <Button
        className="h-9 w-full justify-start gap-2 shadow-none"
        variant="outline"
        type="button"
        onClick={() => void startNewConversation()}
      >
        <Plus size={15} />
        New chat
      </Button>

      <h2 className="px-2 pb-1 pt-3 text-[11px] font-medium text-muted-foreground">Sessions</h2>

      <nav className="misty-transient-scrollbar grid min-h-0 flex-1 content-start gap-0.5 overflow-y-auto">
        {ordered.map((conversation) => {
          const active = conversation.id === activeConversationId;
          return (
            <div
              key={conversation.id}
              className={cn(
                "group flex min-w-0 items-center rounded-md",
                active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
              )}
            >
              <Button
                className="h-8 min-w-0 flex-1 justify-start gap-2 px-2 text-left font-normal shadow-none hover:bg-transparent"
                variant="ghost"
                type="button"
                aria-current={active ? "true" : undefined}
                onClick={() => void switchConversation(conversation.id)}
              >
                <MessageSquare size={14} className="shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate text-sm">{conversation.title}</span>
              </Button>
              <Button
                className={[
                  "mr-1 size-6 shrink-0 text-muted-foreground opacity-0 shadow-none",
                  "hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100",
                ].join(" ")}
                variant="ghost"
                size="icon"
                type="button"
                aria-label={`Delete session "${conversation.title}"`}
                onClick={() => void deleteConversationSession(conversation.id)}
              >
                <Trash2 size={13} />
              </Button>
            </div>
          );
        })}
      </nav>
    </Sidebar>
  );
}
