import { MessageSquare, Plus, Trash2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";

import { Button } from "@/ui";
import { cn } from "@/ui";
import { useMikaSessionStore } from "@/stores/assistant/useMikaSessionStore";

/**
 * Session rail for the Assistant. Sessions are the Assistant's organising unit the way
 * channels are the Space chat's, so they get a persistent list rather than a dropdown.
 */
export function AssistantSessionSidebar({
  embedded = false,
  title = "Sessions",
}: {
  embedded?: boolean;
  title?: string;
}) {
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
        "flex min-h-0 flex-col",
        embedded ? "h-full" : "border-r border-border bg-sidebar/40 p-2",
      )}
      aria-label="Agent sessions"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 px-2 pb-3">
        <h2 className="m-0 text-sm font-semibold text-muted-foreground">{title}</h2>
        <Button
          className="size-8 shadow-none"
          variant="ghost"
          size="icon"
          type="button"
          onClick={() => void startNewConversation()}
        >
          <Plus size={14} />
          <span className="sr-only">New chat</span>
        </Button>
      </div>

      <nav className="misty-transient-scrollbar grid min-h-0 flex-1 content-start gap-1 overflow-y-auto">
        {ordered.map((conversation) => {
          const active = conversation.id === activeConversationId;
          return (
            <div
              key={conversation.id}
              className={cn(
                "group flex min-w-0 items-center rounded-md",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/65 hover:text-sidebar-accent-foreground",
              )}
            >
              <Button
                className="h-10 min-w-0 flex-1 justify-start gap-2.5 px-2.5 text-left text-sm font-medium shadow-none hover:bg-transparent"
                variant="ghost"
                type="button"
                aria-current={active ? "true" : undefined}
                onClick={() => void switchConversation(conversation.id)}
              >
                <span className="grid size-5 shrink-0 place-items-center text-muted-foreground">
                  <MessageSquare size={14} />
                </span>
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
