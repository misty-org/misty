import type { SpaceMessage } from "@/api/spaces/dto/interfaces/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
} from "@/shared/ui";
import { Copy, MoreHorizontal, Pencil, Reply, SmilePlus, Trash2 } from "lucide-react";
import { useState } from "react";
import { ChatEmojiPicker } from "./ChatEmojiPicker";
import { quickReactionEmojis } from "./messageHelpers";

export interface MessageHoverActionsProps {
  message: SpaceMessage;
  currentUserId?: string;
  isOwner: boolean;
  canWrite?: boolean;
  onError?: (message: string) => void;
  onReply: (messageId: string) => void;
  onToggleReaction: (message: SpaceMessage, emoji: string, reacted: boolean) => void;
  onBeginEditing: (message: SpaceMessage) => void;
  onDelete: (message: SpaceMessage) => void;
}

/** A single floating row, revealed by hover or focus (including tapping a message). */
export function MessageHoverActions({ canWrite = true, ...props }: MessageHoverActionsProps) {
  const { message, currentUserId } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const canEdit =
    canWrite && message.sender_kind === "person" && message.sender_user_id === currentUserId;
  const canDelete = canWrite && (message.sender_user_id === currentUserId || props.isOwner);
  const react = (emoji: string) =>
    props.onToggleReaction(
      message,
      emoji,
      message.reactions?.some((r) => r.emoji === emoji && r.reacted_by_me) ?? false,
    );
  const visibility = menuOpen
    ? "opacity-100"
    : [
        "pointer-events-none opacity-0",
        "group-hover/chat-message:pointer-events-auto group-hover/chat-message:opacity-100",
        "group-focus-within/chat-message:pointer-events-auto group-focus-within/chat-message:opacity-100",
      ].join(" ");
  return (
    <div
      className={[
        // Stay inside the row so revealing actions cannot steal hover from its neighbor.
        "absolute right-2 top-0 z-10 flex flex-nowrap items-center gap-0.5 rounded-md",
        "border border-charcoal-border bg-charcoal-bg p-0.5 shadow-sm",
        visibility,
      ].join(" ")}
    >
      {canWrite && (
        <>
          {quickReactionEmojis.slice(0, 2).map((emoji) => (
            <IconButton
              key={emoji}
              label={`Toggle ${emoji} reaction`}
              aria-pressed={
                message.reactions?.some((r) => r.emoji === emoji && r.reacted_by_me) ?? false
              }
              onClick={() => react(emoji)}
            >
              {emoji}
            </IconButton>
          ))}
          <ChatEmojiPicker onSelect={react}>
            <IconButton label="Add reaction">
              <SmilePlus />
            </IconButton>
          </ChatEmojiPicker>
          <IconButton label="Reply" onClick={() => props.onReply(message.id)}>
            <Reply />
          </IconButton>
        </>
      )}
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <IconButton label="More message actions">
            <MoreHorizontal />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() => {
              void navigator.clipboard
                .writeText(
                  message.content.map((s) => (s.type === "text" ? s.text : s.label)).join(""),
                )
                .catch(() =>
                  props.onError?.("Could not copy this message. Try selecting its text."),
                );
            }}
          >
            <Copy />
            Copy text
          </DropdownMenuItem>
          {canEdit && (
            <DropdownMenuItem
              onSelect={() => requestAnimationFrame(() => props.onBeginEditing(message))}
            >
              <Pencil />
              Edit
            </DropdownMenuItem>
          )}
          {canDelete && (
            <DropdownMenuItem onSelect={() => props.onDelete(message)}>
              <Trash2 />
              Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
