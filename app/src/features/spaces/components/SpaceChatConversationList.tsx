import type { SpaceConversation } from "@/api/spaces/dto/interfaces/types";
import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  cn,
} from "@/shared/ui";
import { MessagesSquare, Pencil, Plus, Trash2, Users } from "lucide-react";
import { FaSlack } from "react-icons/fa6";
import { SiDiscord } from "react-icons/si";
import { Link } from "react-router-dom";
import { SpaceSidebarSection } from "./SpaceSidebarSection";

export function SpaceChatConversationList({
  activeSpaceId,
  conversations,
  activeConversationId,
  currentUserId,
  onCreateConversation,
  onEditConversation,
  onDeleteConversation,
  isSpaceOwner = false,
  isMistySpace = false,
}: {
  activeSpaceId: string;
  conversations: SpaceConversation[];
  activeConversationId: string | null;
  currentUserId?: string;
  onCreateConversation?: () => void;
  onEditConversation?: (conversation: SpaceConversation) => void;
  onDeleteConversation?: (conversation: SpaceConversation) => void;
  isSpaceOwner?: boolean;
  isMistySpace?: boolean;
}) {
  const mistyConversations = conversations.filter(
    (conversation) => conversation.origin === "misty" && !conversation.direct_agent_id,
  );
  const discordConversations = conversations.filter(
    (conversation) => conversation.origin === "discord" && !conversation.direct_agent_id,
  );
  const slackConversations = conversations.filter(
    (conversation) => conversation.origin === "slack" && !conversation.direct_agent_id,
  );
  return (
    <div className="grid gap-3">
      <ConversationGroup
        title="Conversations"
        activeSpaceId={activeSpaceId}
        conversations={mistyConversations}
        activeConversationId={activeConversationId}
        currentUserId={currentUserId}
        onCreate={onCreateConversation}
        onEdit={onEditConversation}
        onDelete={onDeleteConversation}
        isSpaceOwner={isSpaceOwner}
        showEveryone={!isMistySpace}
      />
      {discordConversations.length ? (
        <ConversationGroup
          title="Discord"
          activeSpaceId={activeSpaceId}
          conversations={discordConversations}
          activeConversationId={activeConversationId}
          currentUserId={currentUserId}
          isSpaceOwner={isSpaceOwner}
          provider="discord"
        />
      ) : null}
      {slackConversations.length ? (
        <ConversationGroup
          title="Slack"
          activeSpaceId={activeSpaceId}
          conversations={slackConversations}
          activeConversationId={activeConversationId}
          currentUserId={currentUserId}
          isSpaceOwner={isSpaceOwner}
          provider="slack"
        />
      ) : null}
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
  onDelete,
  isSpaceOwner,
  showEveryone,
  provider,
}: {
  title: string;
  activeSpaceId: string;
  conversations: SpaceConversation[];
  activeConversationId: string | null;
  currentUserId?: string;
  onCreate?: () => void;
  onEdit?: (conversation: SpaceConversation) => void;
  onDelete?: (conversation: SpaceConversation) => void;
  isSpaceOwner: boolean;
  showEveryone?: boolean;
  provider?: "discord" | "slack";
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
            className="size-6 shrink-0 shadow-none"
            type="button"
            aria-label={`Create a new ${title.toLowerCase()} conversation`}
            onClick={onCreate}
          >
            <Plus size={13} />
          </Button>
        ) : undefined
      }
    >
      <nav
        className="grid gap-1"
        aria-label={title === "Conversations" ? "Space conversations" : `${title} conversations`}
      >
        {showEveryone ? (
          <Link
            className={conversationLinkClass(!activeConversationId)}
            to={`/spaces/${encodeURIComponent(activeSpaceId)}/chat`}
          >
            <span className="grid size-6 place-items-center text-cream-muted">
              <Users size={17} strokeWidth={1.75} />
            </span>
            <span className="min-w-0 truncate font-medium">Everyone</span>
          </Link>
        ) : null}
        {conversations.map((conversation) => {
          const canRename = Boolean(
            onEdit &&
            conversation.kind !== "direct" &&
            conversation.created_by_user_id === currentUserId,
          );
          const canDelete = Boolean(
            onDelete && (isSpaceOwner || conversation.created_by_user_id === currentUserId),
          );
          const link = (
            <Link
              className={conversationLinkClass(activeConversationId === conversation.id)}
              to={`/spaces/${encodeURIComponent(activeSpaceId)}/chat?conversation=${encodeURIComponent(conversation.id)}`}
            >
              <span className="grid size-6 place-items-center text-cream-muted">
                {provider === "discord" ? (
                  <SiDiscord className="size-4" aria-hidden />
                ) : provider === "slack" ? (
                  <FaSlack className="size-4" aria-hidden />
                ) : (
                  <MessagesSquare size={17} strokeWidth={1.75} />
                )}
              </span>
              <span className="min-w-0 truncate font-medium">
                {provider ? "#" : ""}
                {conversation.external_display_name || conversation.title}
              </span>
              {conversation.integration_status === "disconnected" ? (
                <span
                  className="absolute right-2 size-1.5 rounded-full bg-cream-muted"
                  title="Disconnected"
                />
              ) : null}
            </Link>
          );
          if (!canRename && !canDelete) return <div key={conversation.id}>{link}</div>;
          return (
            <ContextMenu key={conversation.id}>
              <ContextMenuTrigger asChild>{link}</ContextMenuTrigger>
              <ContextMenuContent className="w-44">
                {canRename ? (
                  <ContextMenuItem onSelect={() => onEdit?.(conversation)}>
                    <Pencil />
                    Edit conversation
                  </ContextMenuItem>
                ) : null}
                {canRename && canDelete ? <ContextMenuSeparator /> : null}
                {canDelete ? (
                  <ContextMenuItem
                    className="text-cream-bright focus:bg-charcoal-active focus:text-cream-bright"
                    onSelect={() => onDelete?.(conversation)}
                  >
                    <Trash2 />
                    Delete conversation
                  </ContextMenuItem>
                ) : null}
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
        {conversations.length === 0 ? (
          <p className="px-2 py-1 text-[11px] text-cream-muted">None yet</p>
        ) : null}
      </nav>
    </SpaceSidebarSection>
  );
}

function conversationLinkClass(isActive: boolean) {
  return cn(
    [
      "misty-marker-host relative grid min-h-9 grid-cols-[24px_minmax(0,1fr)] items-center gap-1.5 rounded-md",
      "text-[13px] no-underline outline-none transition-colors",
      "focus-visible:ring-2 focus-visible:ring-charcoal-active",
    ].join(" "),
    isActive
      ? "misty-active-marker-side text-cream-bright font-medium"
      : "text-cream-muted hover:text-cream",
  );
}
