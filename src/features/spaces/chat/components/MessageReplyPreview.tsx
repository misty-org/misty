import type { SpaceMessage } from "../../api/dto/entities";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  OverflowFadeText,
  Pressable,
  Surface,
  Text,
} from "@/shared/ui";
import { ImageIcon } from "lucide-react";
import {
  hasAnyAttachment,
  initials,
  isAgentAuthoredMessage,
  messageReplyPreviewText,
} from "./messageText";

/**
 * The quoted line above a reply, with the elbow connector to its parent.
 *
 * The original may have been deleted, so an absent message renders an explicit
 * unavailable state rather than an empty row. While the chat hasn't read back that far it may
 * only be `earlier`, and opening it reads back to it.
 */
export function MessageReplyPreview({
  avatarUrl,
  message,
  earlier = false,
  onOpen,
}: {
  avatarUrl: string;
  message?: SpaceMessage;
  earlier?: boolean;
  onOpen: () => void;
}) {
  const agentAuthored = Boolean(message && isAgentAuthoredMessage(message));
  return (
    <Text
      bare
      as="div"
      tone="muted"
      className="col-span-2 col-start-1 row-start-1 grid h-7 grid-cols-[44px_minmax(0,1fr)] gap-x-4"
    >
      <div aria-hidden="true" className="relative">
        {/* The elbow: only its left and top edges are drawn. */}
        <Surface
          as="span"
          tone="none"
          edge="strong"
          className="absolute left-5 top-3 h-5 w-9 rounded-tl-md border-0 border-l-2 border-t-2"
        />
      </div>
      <Pressable
        wash="text"
        className="flex min-w-0 items-center gap-1.5 self-start overflow-hidden text-ui leading-5"
        onClick={onOpen}
        aria-label={
          message
            ? `Jump to ${message.sender_name}'s message`
            : earlier
              ? "Jump to the earlier message"
              : "Original message unavailable"
        }
      >
        {message ? (
          <>
            <Avatar className="size-4 shrink-0">
              {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
              <AvatarFallback className="text-3xs font-semibold">
                {agentAuthored ? "AI" : initials(message.sender_name)}
              </AvatarFallback>
            </Avatar>
            <Text tone="bright" weight="semibold" className="max-w-[40%]">
              @{message.sender_name}
            </Text>
            <OverflowFadeText className="min-w-0">
              {messageReplyPreviewText(message)}
            </OverflowFadeText>
            {hasAnyAttachment(message) ? <ImageIcon className="shrink-0" /> : null}
          </>
        ) : (
          <OverflowFadeText className="italic">
            {earlier ? "Earlier message" : "Original message unavailable"}
          </OverflowFadeText>
        )}
      </Pressable>
    </Text>
  );
}
