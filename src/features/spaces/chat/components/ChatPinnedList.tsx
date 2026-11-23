import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { PinOff, X } from "lucide-react";
import {
  Button,
  ChannelMessage,
  ChannelMessageText,
  EmptyState,
  ErrorState,
  FramedBar,
  IconButton,
  SkeletonList,
  Text,
} from "@misty/ui";
import type { SpaceMessage } from "../../api/dto/entities";
import { useSpaceCan } from "../../roles/use_space_roles";
import { useChatSidePanel } from "../chat_side_panel_store";
import { ChatAvatar } from "./ChatAvatar";
import { spansToText } from "./message_text";
import { pinnedChatKey, useCanPin, usePinnedStore } from "./pinned_store";

const stampFormat = new Intl.DateTimeFormat(undefined, {
  month: "numeric",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function usePinnedMessagesSync(spaceId: string, conversationId: string) {
  useEffect(() => {
    usePinnedStore.getState().ensure(spaceId, conversationId);
    const onEvent = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          spaceId?: string;
          conversationId?: string;
          event?: { type?: string };
        }>
      ).detail;
      const type = detail?.event?.type;
      if (detail?.spaceId !== spaceId) return;
      if (type !== "message.pinned" && type !== "message.unpinned") return;
      if ((detail.conversationId ?? "") !== conversationId) return;
      void usePinnedStore.getState().load(spaceId, conversationId);
    };
    window.addEventListener("misty:space-message-event", onEvent);
    return () => window.removeEventListener("misty:space-message-event", onEvent);
  }, [spaceId, conversationId]);
}

export function ChatPinnedHeader(props: { spaceId: string; conversationId: string }) {
  const list = usePinnedStore(
    (state) => state.byChat[pinnedChatKey(props.spaceId, props.conversationId)],
  );
  const count = list?.status === "done" ? list.messages.length : 0;
  return (
    <FramedBar
      start={
        <>
          <Text as="h2" size="control" weight="semibold" tone="bright" className="min-w-0">
            Pinned messages
          </Text>
          {count ? (
            <Text bare size="meta" tone="muted" className="shrink-0 tabular-nums">
              {count}
            </Text>
          ) : null}
        </>
      }
    >
      <IconButton
        label="Close pinned messages"
        onClick={() => useChatSidePanel.getState().closePinned()}
      >
        <X />
      </IconButton>
    </FramedBar>
  );
}

export function ChatPinnedList({
  spaceId,
  conversationId,
}: {
  spaceId: string;
  conversationId: string;
}) {
  const list = usePinnedStore((state) => state.byChat[pinnedChatKey(spaceId, conversationId)]);
  const canManageMessages = useSpaceCan(spaceId, "messages.manage");
  const canPin = useCanPin(spaceId, canManageMessages);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    void usePinnedStore.getState().load(spaceId, conversationId);
  }, [spaceId, conversationId]);

  const jump = (message: SpaceMessage) => {
    const params = new URLSearchParams(location.search);
    params.set("message", message.id);
    navigate(`${location.pathname}?${params.toString()}`);
  };
  const unpin = (message: SpaceMessage) =>
    void usePinnedStore.getState().setPinned(spaceId, conversationId, message, false);

  if (!list || list.status === "loading")
    return (
      <SkeletonList
        label="Pinned messages"
        rows={3}
        lines={2}
        leading="avatar-lg"
        className="px-2 pt-2"
      />
    );
  if (list.status === "failed")
    return (
      <ErrorState
        inline
        title="Pinned messages couldn’t load"
        action={{
          label: "Try again",
          variant: "secondary",
          onClick: () => void usePinnedStore.getState().load(spaceId, conversationId),
        }}
      />
    );
  if (!list.messages.length) return <EmptyState inline title="Nothing pinned yet" />;
  return (
    <section
      aria-label="Pinned messages"
      className="misty-scrollbar-flush min-h-0 flex-1 overflow-y-auto pt-4 pb-4"
    >
      {list.messages.map((message) => (
        <ChannelMessage
          key={message.id}
          name={message.sender_name}
          avatar={
            <ChatAvatar
              id={message.sender_user_id || message.sender_name}
              name={message.sender_name}
              size="lg"
            />
          }
          time={stampFormat.format(new Date(message.created_at))}
          dateTime={message.created_at}
          tools={
            <>
              <Button size="sm" variant="quiet" onClick={() => jump(message)}>
                Jump
              </Button>
              {canPin ? (
                <IconButton label="Unpin message" onClick={() => unpin(message)}>
                  <PinOff />
                </IconButton>
              ) : null}
            </>
          }
        >
          <ChannelMessageText>{spansToText(message.content)}</ChannelMessageText>
        </ChannelMessage>
      ))}
    </section>
  );
}
