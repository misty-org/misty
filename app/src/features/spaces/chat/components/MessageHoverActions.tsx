import type { SpaceMessage } from "@/api/spaces/dto/interfaces/types";
import { Button } from "@/shared/ui";
import { LoaderCircle, Pencil, Reply, Send, Trash2 } from "lucide-react";
import { quickReactionEmojis } from "./messageHelpers";

export interface MessageHoverActionsProps {
  message: SpaceMessage;
  currentUserId?: string;
  isOwner: boolean;
  onReply: (messageId: string) => void;
  onToggleReaction: (message: SpaceMessage, emoji: string, reacted: boolean) => void;
  onBeginEditing: (message: SpaceMessage) => void;
  onDelete: (message: SpaceMessage) => void;
  onPublish?: () => void;
  publishing?: boolean;
  publishProvider?: "Discord" | "Slack";
}

/** The toolbar that appears on hover or focus: quick reactions, reply, edit, delete. */
export function MessageHoverActions(props: MessageHoverActionsProps) {
  const { message, currentUserId } = props;
  const canEdit = message.sender_kind === "person" && message.sender_user_id === currentUserId;
  const canDelete = message.sender_user_id === currentUserId || props.isOwner;

  return (
    <div className="absolute right-3 top-1 z-10 flex max-w-[min(360px,calc(100%-72px))] items-center gap-0.5 rounded-md border border-charcoal-border/70 bg-charcoal-bg p-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
      {quickReactionEmojis.map((emoji) => {
        const reacted =
          message.reactions?.find((item) => item.emoji === emoji)?.reacted_by_me === true;
        return (
          <Button
            variant="ghost"
            size="icon"
            className={`flex size-7 items-center justify-center rounded text-sm leading-none transition-colors ${
              reacted ? "bg-charcoal-active" : "hover:bg-charcoal-card"
            }`}
            type="button"
            key={emoji}
            onClick={() => props.onToggleReaction(message, emoji, reacted)}
            aria-pressed={reacted}
            aria-label={`${reacted ? "Remove" : "Add"} ${emoji} reaction`}
            title={`${reacted ? "Remove" : "Add"} ${emoji}`}
          >
            {emoji}
          </Button>
        );
      })}
      <span className="mx-0.5 h-5 w-px bg-charcoal-border" aria-hidden="true" />

      <ActionButton icon={<Reply />} label="Reply" onClick={() => props.onReply(message.id)} />
      {props.onPublish ? (
        <ActionButton
          icon={props.publishing ? <LoaderCircle className="animate-spin" /> : <Send />}
          label={
            props.publishing
              ? `Sending to ${props.publishProvider ?? "Discord"}`
              : `Send to ${props.publishProvider ?? "Discord"}`
          }
          disabled={props.publishing}
          onClick={props.onPublish}
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
          className="text-cream-muted hover:bg-charcoal-active hover:text-cream-bright"
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
