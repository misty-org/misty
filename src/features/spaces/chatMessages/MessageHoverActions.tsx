import { Pencil, Reply, Trash2 } from "lucide-react";
import { SiDiscord } from "react-icons/si";
import { Button } from "@/ui";
import type { SpaceMessage } from "@/models/interfaces/features/spaces/types";
import { quickReactionEmojis } from "./messageHelpers";

export interface MessageHoverActionsProps {
  message: SpaceMessage;
  currentUserId?: string;
  isOwner: boolean;
  publishing: boolean;
  canPublishToDiscord: boolean;
  onReply: (messageId: string) => void;
  onToggleReaction: (message: SpaceMessage, emoji: string, reacted: boolean) => void;
  onPublishToDiscord?: (message: SpaceMessage) => void;
  onBeginEditing: (message: SpaceMessage) => void;
  onDelete: (message: SpaceMessage) => void;
}

/** The toolbar that appears on hover or focus: quick reactions, reply, edit, delete. */
export function MessageHoverActions(props: MessageHoverActionsProps) {
  const { message, currentUserId } = props;
  const canEdit = message.sender_kind === "person" && message.sender_user_id === currentUserId;
  const canDelete = message.sender_user_id === currentUserId || props.isOwner;
  const discordLabel =
    message.origin?.publish_state === "published" ? "Send to Discord again" : "Send to Discord";

  return (
    <div className="absolute right-3 top-1 z-10 flex max-w-[min(360px,calc(100%-72px))] items-center gap-0.5 rounded-md border border-border/70 bg-background/95 p-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
      {quickReactionEmojis.map((emoji) => {
        const reacted =
          message.reactions?.find((item) => item.emoji === emoji)?.reacted_by_me === true;
        return (
          <button
            className={`flex size-7 items-center justify-center rounded text-sm leading-none transition-colors ${
              reacted ? "bg-primary/10" : "hover:bg-muted"
            }`}
            type="button"
            key={emoji}
            onClick={() => props.onToggleReaction(message, emoji, reacted)}
            aria-pressed={reacted}
            aria-label={`${reacted ? "Remove" : "Add"} ${emoji} reaction`}
            title={`${reacted ? "Remove" : "Add"} ${emoji}`}
          >
            {emoji}
          </button>
        );
      })}
      <span className="mx-0.5 h-5 w-px bg-border/80" aria-hidden="true" />

      <ActionButton icon={<Reply />} label="Reply" onClick={() => props.onReply(message.id)} />
      {props.canPublishToDiscord ? (
        <ActionButton
          icon={<SiDiscord />}
          label={discordLabel}
          disabled={props.publishing}
          onClick={() => props.onPublishToDiscord?.(message)}
        />
      ) : null}
      {canEdit ? (
        <ActionButton
          icon={<Pencil />}
          label="Edit"
          onClick={() => props.onBeginEditing(message)}
        />
      ) : null}
      {canDelete ? (
        <ActionButton
          icon={<Trash2 />}
          label="Delete message"
          title="Delete"
          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          onClick={() => props.onDelete(message)}
        />
      ) : null}
    </div>
  );
}

function ActionButton({
  icon,
  label,
  title,
  className,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  title?: string;
  className?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={`size-7 ${className ?? ""}`}
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      title={title ?? label}
    >
      {icon}
    </Button>
  );
}
