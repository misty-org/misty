import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Pin, PinOff } from "lucide-react";
import {
  Button,
  ChannelMessage,
  ChannelMessageText,
  IconButton,
  Popover,
  PopoverActions,
  PopoverBody,
  PopoverContent,
  PopoverHeader,
  PopoverText,
  PopoverTrigger,
  SkeletonList,
} from "@misty/ui";
import type { SpaceMessage } from "../../api/dto/entities";
import { useSpaceCan } from "../../roles/useSpaceRoles";
import { ChatAvatar } from "./ChatAvatar";
import { spansToText } from "./messageText";
import { pinnedChatKey, useCanPin, usePinnedStore } from "./pinnedStore";

const stampFormat = new Intl.DateTimeFormat(undefined, {
  month: "numeric",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/**
 * Pinned, in a chat's bar: a panel of the chat's pinned messages, the most recently pinned first,
 * each with Jump (which opens it in the chat) and, where the person may pin, Unpin. It reads the
 * pins again whenever a message in this Space is pinned or unpinned.
 */
export function PinnedMessagesButton({
  spaceId,
  conversationId = "",
}: {
  spaceId: string;
  conversationId?: string;
}) {
  const [open, setOpen] = useState(false);
  const list = usePinnedStore((state) => state.byChat[pinnedChatKey(spaceId, conversationId)]);
  const canManageMessages = useSpaceCan(spaceId, "messages.manage");
  const canPin = useCanPin(spaceId, canManageMessages);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    usePinnedStore.getState().ensure(spaceId, conversationId);
    const onEvent = (event: Event) => {
      const detail = (
        event as CustomEvent<{ spaceId?: string; conversationId?: string; event?: { type?: string } }>
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

  // Opening the panel reads the pins again behind what it shows.
  useEffect(() => {
    if (open) void usePinnedStore.getState().load(spaceId, conversationId);
  }, [open, spaceId, conversationId]);

  const jump = (message: SpaceMessage) => {
    const params = new URLSearchParams(location.search);
    params.set("message", message.id);
    navigate(`${location.pathname}?${params.toString()}`);
    setOpen(false);
  };
  const unpin = (message: SpaceMessage) =>
    void usePinnedStore.getState().setPinned(spaceId, conversationId, message, false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton label="Pinned" aria-pressed={open}>
          <Pin />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent size="lg" align="end">
        <PopoverHeader
          title="Pinned messages"
          detail={list?.status === "done" && list.messages.length ? list.messages.length : undefined}
        />
        {!list || list.status === "loading" ? (
          <PopoverBody>
            <SkeletonList label="Pinned messages" rows={3} lines={2} leading="avatar-lg" />
          </PopoverBody>
        ) : list.status === "failed" ? (
          <>
            <PopoverText>Pinned messages couldn’t load.</PopoverText>
            <PopoverActions>
              <Button
                size="sm"
                onClick={() => void usePinnedStore.getState().load(spaceId, conversationId)}
              >
                Try again
              </Button>
            </PopoverActions>
          </>
        ) : !list.messages.length ? (
          <PopoverText>Nothing pinned yet</PopoverText>
        ) : (
          <PopoverBody aria-label="Pinned messages">
            <div className="misty-scrollbar-flush -mx-3 max-h-96 overflow-y-auto pt-4 pb-1">
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
            </div>
          </PopoverBody>
        )}
      </PopoverContent>
    </Popover>
  );
}
