import { ArrowUpRight, X } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { useAuth } from "@/features/auth";
import { IconButton, SkeletonList } from "@/shared/ui";
import { spaceNavigationName } from "../defaultSpace";
import { useSpacesStore } from "../store/useSpacesStore";
import { ChatPanelPicker } from "./ChatPanelPicker";
import { useSpaceConversations } from "./sidebar/useSpaceConversations";
import { homeChatSpace, useOpenSpaceChat } from "./useOpenSpaceChat";

const SpaceChat = lazy(async () => {
  const { SpaceChat } = await import("./SpaceChat");
  return { default: SpaceChat };
});

const chatSkeleton = <SkeletonList label="Chat" leading="avatar" rows={4} className="p-4" />;

/**
 * Your Space's chat in the side panel beside the page, the Chat button's view. One header
 * holds the chat switcher (Everyone, channels and conversations) and the open-in-tab and close
 * buttons; "Open full chat" opens a new tab and leaves this panel as it is.
 */
export function SpaceChatPanel(props: { side: "left" | "right"; onClose: () => void }) {
  const space = useSpacesStore((state) => homeChatSpace(state.spaces));
  const { user } = useAuth();
  const openFullChat = useOpenSpaceChat();
  const [conversationId, setConversationId] = useState("");
  const data = useSpaceConversations(space?.id ?? "");
  return (
    <aside
      className="flex h-full shrink-0 flex-col overflow-hidden"
      // The dock sets the width; it stays fixed while the dock slides, like the agent panel.
      style={{ width: "var(--misty-panel-width, 400px)" }}
      aria-label="Chat"
      data-misty-panel={props.side}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        props.onClose();
      }}
    >
      <header className="flex h-12 shrink-0 items-center gap-1 pl-2 pr-2">
        <ChatPanelPicker
          conversations={data.conversations}
          currentUserId={user?.id}
          selected={conversationId}
          onSelect={setConversationId}
        />
        <div className="flex-1" />
        <IconButton label="Open full chat" onClick={() => openFullChat(conversationId)}>
          <ArrowUpRight />
        </IconButton>
        <IconButton label="Close chat" onClick={props.onClose}>
          <X />
        </IconButton>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">
        {space ? (
          <Suspense fallback={chatSkeleton}>
            <SpaceChat
              spaceId={space.id}
              spaceName={spaceNavigationName(space)}
              conversationId={conversationId}
              panel
              onBack={() => setConversationId("")}
            />
          </Suspense>
        ) : (
          chatSkeleton
        )}
      </div>
    </aside>
  );
}
