import type { SpaceMessage } from "../../api/dto/entities";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  IconButton,
  MenuItem,
  Surface,
} from "@/shared/ui";
import { Copy, MoreHorizontal, Pencil, Reply, SmilePlus, Trash2 } from "lucide-react";
import { useState } from "react";
import { ChatEmojiPicker } from "./ChatEmojiPicker";
import { quickReactionEmojis } from "./messageText";

interface MessageHoverActionsProps {
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
    <Surface
      tone="page"
      edge="hairline"
      radius="md"
      className={[
        // Stay inside the row so revealing actions cannot steal hover from its neighbor.
        "absolute right-2 top-0 z-10 flex flex-nowrap items-center gap-0.5 p-0.5 shadow-sm",
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
          <MenuItem
            icon={Copy}
            label="Copy text"
            onSelect={() => {
              void navigator.clipboard
                .writeText(
                  message.content.map((s) => (s.type === "text" ? s.text : s.label)).join(""),
                )
                .catch(() =>
                  props.onError?.("Could not copy this message. Try selecting its text."),
                );
            }}
          />
          {canEdit && (
            <MenuItem
              icon={Pencil}
              label="Edit"
              onSelect={() => requestAnimationFrame(() => props.onBeginEditing(message))}
            />
          )}
          {canDelete && (
            <MenuItem icon={Trash2} label="Delete" onSelect={() => props.onDelete(message)} />
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </Surface>
  );
}
