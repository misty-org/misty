import { useState } from "react";
import { ChevronDown, MessagesSquare, Plus, Trash2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui";
import { Separator } from "@/ui";
import { cn } from "@/ui";
import { useMikaSessionStore } from "@/stores/assistant/useMikaSessionStore";

export function AssistantSessionSwitcher() {
  const [open, setOpen] = useState(false);
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
  const activeTitle =
    conversations.find((conversation) => conversation.id === activeConversationId)?.title ??
    "New chat";
  const ordered = [...conversations].sort((left, right) => right.updatedAt - left.updatedAt);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="h-9 min-w-0 max-w-[220px] justify-start gap-2 px-3 text-left shadow-none"
          type="button"
        >
          <MessagesSquare size={15} className="shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-sm">{activeTitle}</span>
          <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-1.5">
        <Button
          variant="ghost"
          className="mb-1 h-9 w-full justify-start gap-2 px-2 text-sm shadow-none"
          type="button"
          onClick={() => {
            setOpen(false);
            void startNewConversation();
          }}
        >
          <Plus size={14} />
          New chat
        </Button>
        <Separator className="my-1" />
        <div className="misty-transient-scrollbar max-h-72 overflow-y-auto">
          {ordered.map((conversation) => (
            <div
              key={conversation.id}
              className={cn(
                "group flex min-w-0 items-center rounded-md",
                conversation.id === activeConversationId && "bg-accent",
              )}
            >
              <Button
                variant="ghost"
                className="h-9 min-w-0 flex-1 justify-start px-2 text-left text-sm shadow-none hover:bg-accent"
                type="button"
                aria-current={conversation.id === activeConversationId ? "true" : undefined}
                onClick={() => {
                  setOpen(false);
                  void switchConversation(conversation.id);
                }}
              >
                <span className="min-w-0 flex-1 truncate">{conversation.title}</span>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="mr-1 size-7 shrink-0 opacity-0 shadow-none group-hover:opacity-100 focus-visible:opacity-100"
                type="button"
                aria-label={`Delete conversation "${conversation.title}"`}
                onClick={(event) => {
                  event.stopPropagation();
                  void deleteConversationSession(conversation.id);
                }}
              >
                <Trash2 size={13} />
              </Button>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
