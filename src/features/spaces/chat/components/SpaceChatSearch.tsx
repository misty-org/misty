import { useNavigate } from "react-router-dom";
import type { SpaceConversation } from "../../api/dto/entities";
import { spaceChatConversationPath, spaceChatPath } from "../chat_route";
import { conversationName } from "../sidebar/conversation_groups";
import { ChatSearchResults } from "./ChatSearchResults";

export function SpaceChatSearch(props: {
  spaceId: string;
  query: string;
  conversations: SpaceConversation[];
  currentUserId?: string;
  memberColors?: Map<string, string>;
  dm: boolean;
}) {
  const navigate = useNavigate();
  return (
    <ChatSearchResults
      spaceId={props.spaceId}
      query={props.query}
      whereSaid={(message) => {
        const said = props.conversations.find((item) => item.id === message.conversation_id);
        return said
          ? { name: conversationName(said, props.currentUserId), direct: said.kind === "dm" }
          : { name: "everyone", direct: false };
      }}
      colorOf={(message) => props.memberColors?.get(message.sender_user_id)}
      onOpen={(message) => {
        if (props.dm) return navigate(`?message=${encodeURIComponent(message.id)}`);
        const path = message.conversation_id
          ? spaceChatConversationPath(props.spaceId, message.conversation_id)
          : spaceChatPath(props.spaceId);
        navigate(
          `${path}${path.includes("?") ? "&" : "?"}message=${encodeURIComponent(message.id)}`,
        );
      }}
    />
  );
}
