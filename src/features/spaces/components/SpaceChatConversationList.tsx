import { useState } from "react";
import { ChevronRight, MessagesSquare, Pencil, Plus, Users } from "lucide-react";
import { SiDiscord } from "react-icons/si";
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
  const mistyConversations = conversations.filter(
    (conversation) => conversation.origin !== "discord",
  );
  const direct = mistyConversations.filter((conversation) => conversation.members.length <= 2);
  const group = mistyConversations.filter((conversation) => conversation.members.length > 2);
  const discord = conversations.filter((conversation) => conversation.origin === "discord");

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
      {discord.length ? (
        <DiscordConversationGroup
          activeSpaceId={activeSpaceId}
          conversations={discord}
          activeConversationId={activeConversationId}
        />
      ) : null}
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

function DiscordConversationGroup({
  activeSpaceId,
  conversations,
  activeConversationId,
}: {
  activeSpaceId: string;
  conversations: SpaceConversation[];
  activeConversationId: string | null;
}) {
  const [expanded, setExpanded] = useState(true);
  return (
    <section className="grid gap-1">
      <div className="flex min-h-7 items-center px-2">
        <Button
          type="button"
          variant="ghost"
          className="h-auto min-w-0 flex-1 justify-start gap-1.5 px-0 py-0 text-left text-xs font-semibold text-muted-foreground shadow-none hover:bg-transparent hover:text-sidebar-accent-foreground"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
        >
          <SiDiscord className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate">
            Discord <span className="text-muted-foreground/80">- {conversations.length}</span>
          </span>
          <ChevronRight
            size={13}
            className={cn("shrink-0 transition-transform", expanded && "rotate-90")}
          />
        </Button>
      </div>
      {expanded ? (
        <nav className="grid gap-1" aria-label="Discord conversations">
          {conversations.map((conversation) => (
            <Link
              key={conversation.id}
              className={conversationLinkClass(activeConversationId === conversation.id)}
              to={`/spaces/${encodeURIComponent(activeSpaceId)}/chat?conversation=${encodeURIComponent(conversation.id)}`}
            >
              <span className="grid size-7 place-items-center rounded-md bg-sidebar-accent text-[#5865F2]">
                <SiDiscord className="size-3.5" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block truncate font-medium">
                  {conversation.external_display_name || conversation.title}
                </span>
                {conversation.integration_status === "disconnected" ? (
                  <span className="block truncate text-[11px] text-muted-foreground">
                    Disconnected
                  </span>
                ) : null}
              </span>
            </Link>
          ))}
        </nav>
      ) : null}
    </section>
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
        <Button
          type="button"
          variant="ghost"
          className={[
            "h-auto min-w-0 flex-1 justify-start gap-1.5 px-0 py-0 text-left text-xs shadow-none hover:bg-transparent",
            "font-semibold text-muted-foreground hover:text-sidebar-accent-foreground",
          ].join(" ")}
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
        >
          <span className="min-w-0 flex-1 truncate">
            {title}
            {conversations.length > 0 ? (
              <span className="text-muted-foreground/80"> - {conversations.length}</span>
            ) : null}
          </span>
          <ChevronRight
            size={13}
            className={cn("ml-auto shrink-0 transition-transform", expanded && "rotate-90")}
          />
        </Button>
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
      "bg-none px-2.5 text-sm no-underline outline-none transition-colors hover:bg-none",
      "focus-visible:ring-1 focus-visible:ring-sidebar-ring",
    ].join(" "),
    isActive
      ? "bg-sidebar-accent text-sidebar-accent-foreground"
      : "text-sidebar-foreground hover:bg-sidebar-accent/65 hover:text-sidebar-accent-foreground",
  );
}
