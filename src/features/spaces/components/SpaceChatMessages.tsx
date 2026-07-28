export type {
  SpaceChatMessagesProps,
  SpaceChatStarter,
} from "@/models/interfaces/features/spaces/components/SpaceChatMessages";
export { DeleteMessageDialog } from "../chatMessages/DeleteMessageDialog";
export { messageReplyPreviewText } from "../chatMessages/messageHelpers";

import { useMemo } from "react";
import type { SpaceChatMessagesProps } from "@/models/interfaces/features/spaces/components/SpaceChatMessages";
import {
  buildChatDisplayRows,
  useMemberAvatarUrls,
} from "@/features/spaces/components/SpaceChatDisplay";
import { SpaceChatStarters } from "./SpaceChatStarters";
import { SpaceDirectMessageIntro } from "./SpaceDirectMessageIntro";
import { ChatMessageRow } from "../chatMessages/ChatMessageRow";
import { ChatMessagesSkeleton } from "../chatMessages/ChatMessagesSkeleton";

export function SpaceChatMessages(props: SpaceChatMessagesProps) {
  const displayRows = useMemo(() => buildChatDisplayRows(props.messages), [props.messages]);
  const memberAvatarUrls = useMemberAvatarUrls(props.spaceId, props.messages);

  const avatarFor = (message: {
    origin?: { author_avatar_url?: string };
    sender_user_id: string;
  }) => message.origin?.author_avatar_url || memberAvatarUrls.get(message.sender_user_id) || "";

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-[clamp(20px,5vw,72px)] py-6">
      <div className="mx-auto max-w-5xl">
        {props.error ? (
          <div
            className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            {props.error}
          </div>
        ) : null}

        {props.loading ? (
          <ChatMessagesSkeleton />
        ) : props.messages.length === 0 ? (
          props.directRecipient ? (
            <SpaceDirectMessageIntro spaceId={props.spaceId} recipient={props.directRecipient} />
          ) : (
            <SpaceChatStarters
              spaceName={props.spaceName}
              onStarter={props.canWrite ? props.onStarter : undefined}
            />
          )
        ) : (
          displayRows.map(({ message, compact, dateLabel }) => {
            const repliedToMessage = message.reply_to_message_id
              ? props.messages.find((item) => item.id === message.reply_to_message_id)
              : undefined;
            return (
              <ChatMessageRow
                key={message.id}
                message={message}
                compact={compact}
                dateLabel={dateLabel}
                avatarUrl={avatarFor(message)}
                repliedToMessage={repliedToMessage}
                repliedToAvatarUrl={repliedToMessage ? avatarFor(repliedToMessage) : ""}
                props={props}
              />
            );
          })
        )}

        <div ref={props.endRef} />
      </div>
    </div>
  );
}
