import { MessagesSquare, Pencil, Plus, Trash2, Users } from "lucide-react";
import { SiDiscord } from "react-icons/si";
import { Link } from "react-router-dom";
import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  cn,
} from "@/ui";
import type { SpaceConversation } from "@/models/interfaces/features/spaces/types";
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
    (conversation) => conversation.origin !== "discord",
  );
  const discord = conversations.filter((conversation) => conversation.origin === "discord");

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
            <span className="grid size-6 place-items-center text-sage-fg">
              <SiDiscord className="size-4" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block truncate font-medium">
                {conversation.external_display_name || conversation.title}
              </span>
              {conversation.integration_status === "disconnected" ? (
                <span className="block truncate text-[11px] text-cream-muted">Disconnected</span>
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
  onDelete,
  isSpaceOwner,
  showEveryone,
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
                <MessagesSquare size={17} strokeWidth={1.75} />
              </span>
              <span className="min-w-0 truncate font-medium">{conversation.title}</span>
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
