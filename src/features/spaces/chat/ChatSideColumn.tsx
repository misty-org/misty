import type { ReactNode } from "react";
import type { FramedPageColumn } from "@misty/ui";
import type { Space, SpaceMember } from "../api/dto/entities";
import type { SpaceConversation } from "../api/dto/conversation_types";
import { ChatMemberList } from "./components/ChatMemberList";
import { ChatPinnedHeader, ChatPinnedList } from "./components/ChatPinnedList";
import { ChatThreadsHeader, ChatThreadsList } from "./components/ChatThreadsList";

export function chatSideColumn(props: {
  spaceId: string;
  conversationId: string;
  space?: Space;
  conversation?: SpaceConversation;
  currentUserId?: string;
  restricted: boolean;
  membersShown: boolean;
  dm?: { group: boolean; members?: ReactNode };
  search: { open: boolean; header: ReactNode; content: ReactNode };
  thread: FramedPageColumn | null;
  pinnedOpen: boolean;
}): FramedPageColumn | null {
  if (props.search.open)
    return {
      id: "search",
      label: "Resize the search results",
      width: 400,
      narrow: "cover",
      header: props.search.header,
      content: props.search.content,
    };
  if (props.thread) return props.thread;
  if (props.pinnedOpen)
    return {
      id: "pinned",
      label: "Resize the pinned messages",
      width: 360,
      narrow: "cover",
      header: <ChatPinnedHeader spaceId={props.spaceId} conversationId={props.conversationId} />,
      content: <ChatPinnedList spaceId={props.spaceId} conversationId={props.conversationId} />,
    };
  if (!props.membersShown) return null;
  const { conversation } = props;
  const members = props.dm ? (
    (props.dm.members ?? null)
  ) : props.space ? (
    <ChatMemberList
      space={props.space}
      spaceId={props.spaceId}
      ownerUserId={props.space.owner_user_id}
      currentUserId={props.currentUserId}
      visibleTo={
        conversation && props.restricted
          ? (member: SpaceMember) =>
              conversation.participants.some((person) => person.user_id === member.user_id)
          : undefined
      }
    />
  ) : null;
  if (!members) return null;
  const profile = Boolean(props.dm && !props.dm.group);
  return {
    id: profile ? "profile" : "members",
    label: profile ? "Resize the profile" : "Resize the member list",
    width: profile ? 300 : 240,
    content: members,
  };
}

export function threadsColumn(spaceId: string, conversationId: string): FramedPageColumn {
  return {
    id: "threads",
    label: "Resize the threads",
    width: 360,
    narrow: "cover",
    header: <ChatThreadsHeader />,
    content: <ChatThreadsList spaceId={spaceId} conversationId={conversationId} />,
  };
}
