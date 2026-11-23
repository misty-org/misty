import { ArrowUpRight, X } from "lucide-react";
import { useAuth } from "@/features/account";
import { createDeviceSettingMap } from "@/shared/lib/device_setting_map";
import { FramedBar, FramedPage, IconButton, Surface, lazyTool, ToolSuspense } from "@misty/ui";
import { spaceNavigationName } from "../routes/default_space";
import { useSpacesStore } from "../list/use_spaces_store";
import { ChatPanelPicker } from "./ChatPanelPicker";
import { ChatMessagesLoading } from "./components/ChatMessagesLoading";
import { useSpaceConversations } from "./sidebar/use_space_conversations";
import { homeChatSpace, useOpenSpaceChat } from "./use_open_space_chat";

const SpaceChat = lazyTool(async () => {
  const { SpaceChat } = await import("./SpaceChat");
  return { default: SpaceChat };
});

const panelConversations = createDeviceSettingMap<string>({
  scope: "spaces.chat.panel",
  normalize: (stored) => (typeof stored === "string" ? stored : undefined),
});

const chatSkeleton = <ChatMessagesLoading framed />;

export function SpaceChatPanel(props: { side: "left" | "right"; onClose: () => void }) {
  const space = useSpacesStore((state) => homeChatSpace(state.spaces));
  const { user } = useAuth();
  const openFullChat = useOpenSpaceChat();
  const data = useSpaceConversations(space?.id ?? "");
  const saved = panelConversations.useEntry(space?.id) ?? "";
  const conversationId =
    saved && !data.loading && !data.error && !data.conversations.some((item) => item.id === saved)
      ? ""
      : saved;
  const setConversationId = (id: string) => {
    if (space) panelConversations.set(space.id, id || undefined);
  };
  const bar = (
    <FramedBar
      start={
        <ChatPanelPicker
          conversations={data.conversations}
          currentUserId={user?.id}
          selected={conversationId}
          onSelect={setConversationId}
        />
      }
    >
      <IconButton label="Open full chat" onClick={() => openFullChat(conversationId)}>
        <ArrowUpRight />
      </IconButton>
      <IconButton label="Close chat" onClick={props.onClose}>
        <X />
      </IconButton>
    </FramedBar>
  );
  return (
    <Surface
      as="aside"
      tone="page"
      edge="hairline"
      radius="xl"
      className="flex h-full shrink-0 flex-col overflow-hidden"
      style={{ width: "var(--misty-panel-width, calc(var(--spacing) * 100))" }}
      aria-label="Chat"
      data-misty-panel={props.side}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        props.onClose();
      }}
    >
      {space ? (
        <ToolSuspense tool="chat" frame={(state) => <FramedPage header={bar}>{state}</FramedPage>}>
          <SpaceChat
            spaceId={space.id}
            spaceName={spaceNavigationName(space)}
            conversationId={conversationId}
            panel
            header={bar}
            onBack={() => setConversationId("")}
          />
        </ToolSuspense>
      ) : (
        <FramedPage header={bar}>{chatSkeleton}</FramedPage>
      )}
    </Surface>
  );
}
