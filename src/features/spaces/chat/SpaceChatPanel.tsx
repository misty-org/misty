import { ArrowUpRight, X } from "lucide-react";
import { lazy, Suspense } from "react";
import { useAuth } from "@/features/account";
import { createDeviceSettingMap } from "@/shared/lib/deviceSettingMap";
import { IconButton, Surface } from "@/shared/ui";
import { spaceNavigationName } from "../routes/defaultSpace";
import { useSpacesStore } from "../list/useSpacesStore";
import { ChatPanelPicker } from "./ChatPanelPicker";
import { ChatMessagesSkeleton } from "./components/ChatMessagesSkeleton";
import { useSpaceConversations } from "./sidebar/useSpaceConversations";
import { homeChatSpace, useOpenSpaceChat } from "./useOpenSpaceChat";

const SpaceChat = lazy(async () => {
  const { SpaceChat } = await import("./SpaceChat");
  return { default: SpaceChat };
});

/** The conversation the panel last showed in each Space, kept in `misty.db` for this device. */
const panelConversations = createDeviceSettingMap<string>({
  scope: "spaces.chat.panel",
  normalize: (stored) => (typeof stored === "string" ? stored : undefined),
});

// The chat's code or its Space is still on its way: its messages' own shape stands in.
const chatSkeleton = <ChatMessagesSkeleton framed />;

/**
 * Your Space's chat in the side panel beside the page, the Chat button's view. One header
 * holds the chat switcher (Everyone, channels and conversations) and the open-in-tab and close
 * buttons; "Open full chat" opens a new tab and leaves this panel as it is.
 */
export function SpaceChatPanel(props: { side: "left" | "right"; onClose: () => void }) {
  const space = useSpacesStore((state) => homeChatSpace(state.spaces));
  const { user } = useAuth();
  const openFullChat = useOpenSpaceChat();
  const data = useSpaceConversations(space?.id ?? "");
  const saved = panelConversations.useEntry(space?.id) ?? "";
  // A conversation that is gone since opens the Space-wide channel instead.
  const conversationId =
    saved && !data.loading && !data.error && !data.conversations.some((item) => item.id === saved)
      ? ""
      : saved;
  const setConversationId = (id: string) => {
    if (space) panelConversations.set(space.id, id || undefined);
  };
  return (
    <Surface
      as="aside"
      tone="page"
      edge="hairline"
      radius="xl"
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
    </Surface>
  );
}
