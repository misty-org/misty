import { useState } from "react";
import { ChevronRight, MessagesSquare, Pencil, Plus, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/ui";
import { cn } from "@/ui";
import type { SpaceConversation } from "@/models/interfaces/features/spaces/types";
import type { ConversationDialogKind } from "./CreateEditConversationDialog";

export function SpaceChatConversationList({
  activeSpaceId,
  conversations,
  activeConversationId,
  currentUserId,
  onCreateConversation,
  onEditConversation,
}: {
  activeSpaceId: string;
  conversations: SpaceConversation[];
  activeConversationId: string | null;
  currentUserId?: string;
  onCreateConversation: (kind: ConversationDialogKind) => void;
  onEditConversation: (conversation: SpaceConversation) => void;
}) {
  const direct = conversations.filter((conversation) => conversation.members.length <= 2);
  const group = conversations.filter((conversation) => conversation.members.length > 2);

  return (
    <div className="grid gap-2">
      <nav className="grid gap-1" aria-label="Space conversations">
        <Link
          className={conversationLinkClass(!activeConversationId)}
          to={`/spaces/${encodeURIComponent(activeSpaceId)}/chat`}
        >
          <span className="grid size-7 place-items-center rounded-md bg-sidebar-accent text-muted-foreground">
            <Users size={14} />
          </span>
          <span className="min-w-0 truncate font-medium">Everyone</span>
        </Link>
      </nav>
      <ConversationGroup
        title="Direct"
        activeSpaceId={activeSpaceId}
        conversations={direct}
        activeConversationId={activeConversationId}
        currentUserId={currentUserId}
        onCreate={() => onCreateConversation("direct")}
        onEdit={onEditConversation}
      />
      <ConversationGroup
        title="Group"
        activeSpaceId={activeSpaceId}
        conversations={group}
        activeConversationId={activeConversationId}
        currentUserId={currentUserId}
        onCreate={() => onCreateConversation("group")}
        onEdit={onEditConversation}
      />
    </div>
  );
}

function ConversationGroup({
  title,
  activeSpaceId,
  conversations,
  activeConversationId,
  currentUserId,
  onCreate,
  onEdit,
}: {
  title: string;
  activeSpaceId: string;
  conversations: SpaceConversation[];
  activeConversationId: string | null;
  currentUserId?: string;
  onCreate: () => void;
  onEdit: (conversation: SpaceConversation) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <section className="grid gap-1">
      <div className="group/header flex min-h-7 items-center gap-1 px-2">
        <button
          type="button"
          className={[
            "flex min-w-0 flex-1 items-center gap-1.5 rounded-md text-left text-xs",
            "font-semibold text-muted-foreground hover:text-sidebar-accent-foreground",
          ].join(" ")}
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
        >
          <ChevronRight
            size={13}
            className={cn("shrink-0 transition-transform", expanded && "rotate-90")}
          />
          <span className="min-w-0 flex-1 truncate">
            {title}
            {conversations.length > 0 ? (
              <span className="text-muted-foreground/80"> - {conversations.length}</span>
            ) : null}
          </span>
        </button>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 shrink-0 opacity-0 shadow-none group-hover/header:opacity-100 focus-visible:opacity-100"
          type="button"
          aria-label={`Create a new ${title.toLowerCase()} conversation`}
          onClick={onCreate}
        >
          <Plus size={13} />
        </Button>
      </div>

      {expanded ? (
        <nav className="grid gap-1" aria-label={`${title} conversations`}>
          {conversations.map((conversation) => (
            <div className="group/row relative" key={conversation.id}>
              <Link
                className={conversationLinkClass(activeConversationId === conversation.id)}
                to={`/spaces/${encodeURIComponent(activeSpaceId)}/chat?conversation=${encodeURIComponent(conversation.id)}`}
              >
                <span className="grid size-7 place-items-center rounded-md bg-sidebar-accent text-muted-foreground">
                  <MessagesSquare size={14} />
                </span>
                <span className="min-w-0 pr-6">
                  <span className="block truncate font-medium">{conversation.title}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {conversation.members
                      .map((member) => (member.user_id === currentUserId ? "You" : member.name))
                      .join(", ")}
                  </span>
                </span>
              </Link>
              {conversation.created_by_user_id === currentUserId ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-1.5 top-1/2 size-6 -translate-y-1/2 opacity-0 shadow-none group-hover/row:opacity-100 focus-visible:opacity-100"
                  type="button"
                  aria-label={`Edit ${conversation.title}`}
                  onClick={(event) => {
                    event.preventDefault();
                    onEdit(conversation);
                  }}
                >
                  <Pencil size={12} />
                </Button>
              ) : null}
            </div>
          ))}
          {conversations.length === 0 ? (
            <p className="px-2 py-1 text-[11px] text-muted-foreground">None yet</p>
          ) : null}
        </nav>
      ) : null}
    </section>
  );
}

function conversationLinkClass(isActive: boolean) {
  return cn(
    [
      "grid min-h-11 grid-cols-[32px_minmax(0,1fr)] items-center gap-2.5 rounded-md",
      "px-2.5 text-sm no-underline outline-none transition-colors",
      "focus-visible:ring-1 focus-visible:ring-sidebar-ring",
    ].join(" "),
    isActive
      ? "bg-sidebar-accent text-sidebar-accent-foreground"
      : "text-sidebar-foreground hover:bg-sidebar-accent/65 hover:text-sidebar-accent-foreground",
  );
}
