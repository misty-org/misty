import { MessagesSquare, Pencil, Plus, Users } from "lucide-react";
import { SiDiscord } from "react-icons/si";
import { Link } from "react-router-dom";
import { Button } from "@/ui";
import { cn } from "@/ui";
import type { SpaceConversation } from "@/models/interfaces/features/spaces/types";
import { SpaceSidebarSection } from "./SpaceSidebarSection";

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
  onCreateConversation?: () => void;
  onEditConversation?: (conversation: SpaceConversation) => void;
}) {
  const mistyConversations = conversations.filter(
    (conversation) => conversation.origin !== "discord",
  );
  const discord = conversations.filter((conversation) => conversation.origin === "discord");

  return (
    <div className="grid gap-3">
      <nav className="grid gap-1" aria-label="Space conversations">
        <Link
          className={conversationLinkClass(!activeConversationId)}
          to={`/spaces/${encodeURIComponent(activeSpaceId)}/chat`}
        >
          <span className="grid size-7 place-items-center rounded-md bg-sidebar-accent text-muted-foreground ring-1 ring-sidebar-border/50">
            <Users size={15} strokeWidth={1.75} />
          </span>
          <span className="min-w-0 truncate font-medium">Everyone</span>
        </Link>
      </nav>
      <ConversationGroup
        title="Conversations"
        activeSpaceId={activeSpaceId}
        conversations={mistyConversations}
        activeConversationId={activeConversationId}
        currentUserId={currentUserId}
        onCreate={onCreateConversation}
        onEdit={onEditConversation}
      />
      {discord.length ? (
        <DiscordConversationGroup
          activeSpaceId={activeSpaceId}
          conversations={discord}
          activeConversationId={activeConversationId}
        />
      ) : null}
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
  return (
    <SpaceSidebarSection
      title="Discord"
      count={conversations.length}
      icon={<SiDiscord className="size-3.5" aria-hidden />}
    >
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
    </SpaceSidebarSection>
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
  onCreate?: () => void;
  onEdit?: (conversation: SpaceConversation) => void;
}) {
  return (
    <SpaceSidebarSection
      title={title}
      count={conversations.length}
      action={
        onCreate ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-6 shrink-0 opacity-0 shadow-none group-hover/sidebar-header:opacity-100 focus-visible:opacity-100"
            type="button"
            aria-label={`Create a new ${title.toLowerCase()} conversation`}
            onClick={onCreate}
          >
            <Plus size={13} />
          </Button>
        ) : undefined
      }
    >
      <nav className="grid gap-1" aria-label={`${title} conversations`}>
        {conversations.map((conversation) => (
          <div className="group/row relative" key={conversation.id}>
            <Link
              className={conversationLinkClass(activeConversationId === conversation.id)}
              to={`/spaces/${encodeURIComponent(activeSpaceId)}/chat?conversation=${encodeURIComponent(conversation.id)}`}
            >
              <span className="grid size-7 place-items-center rounded-md bg-sidebar-accent text-muted-foreground">
                <MessagesSquare size={15} strokeWidth={1.75} />
              </span>
              <span className="min-w-0 pr-6">
                <span className="block truncate font-medium">{conversation.title}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {conversation.participants
                    .map((participant) =>
                      participant.user_id === currentUserId ? "You" : participant.name,
                    )
                    .join(", ")}
                </span>
              </span>
            </Link>
            {onEdit && conversation.created_by_user_id === currentUserId ? (
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
    </SpaceSidebarSection>
  );
}

function conversationLinkClass(isActive: boolean) {
  return cn(
    [
      "misty-hover-marker-side misty-spaces-interactive relative grid min-h-9 grid-cols-[28px_minmax(0,1fr)] items-center gap-2 rounded-md",
      "bg-none px-2.5 text-[13px] no-underline outline-none hover:bg-none",
      "focus-visible:ring-2 focus-visible:ring-sidebar-ring",
    ].join(" "),
    isActive
      ? "misty-active-marker-side text-sidebar-accent-foreground"
      : "text-sidebar-foreground hover:text-sidebar-accent-foreground",
  );
}
