import { useEffect } from "react";
import { Volume2 } from "lucide-react";
import { EmptyState, Surface, ViewHeader } from "@misty/ui";
import { useWorkspaceViewTitle } from "@/features/app-windows";
import { useSpaceConversations, useVoicePresence, watchVoicePresence } from "@/features/spaces";
import { useDirectUserId } from "../directAccount";
import { useCallStore } from "./callStore";
import { CallStageView } from "./CallView";
import { joinVoiceChannel } from "./voiceChannels";

/**
 * A Space voice channel's page, as Discord's: once in its call, the call fills the page (everyone's
 * tile, then the controls); before that, who is there and Join. Calls aren't text chats, so the page
 * holds no chat: the Space's channels are a click away while the call goes on.
 */
export function VoiceChannelPage({
  spaceId,
  channelId,
  workspaceTabId,
}: {
  spaceId: string;
  channelId: string;
  workspaceTabId?: string;
}) {
  const userId = useDirectUserId();
  const { conversations } = useSpaceConversations(spaceId);
  const name = conversations.find((item) => item.id === channelId)?.title ?? "Voice channel";
  const here = useCallStore(
    (state) =>
      state.active?.place.kind === "voice" &&
      state.active.place.spaceId === spaceId &&
      state.active.place.channelId === channelId,
  );
  const people = useVoicePresence((state) => state.bySpace[spaceId]?.[channelId]?.length ?? 0);
  useEffect(() => watchVoicePresence(spaceId), [spaceId]);
  useWorkspaceViewTitle(workspaceTabId, name);

  return (
    <Surface tone="page" className="flex h-full min-h-0 flex-col">
      <ViewHeader lead={Volume2} title={name} />
      {here ? (
        <CallStageView />
      ) : (
        <EmptyState
          title={name}
          line={
            people === 0
              ? "Nobody is here yet."
              : people === 1
                ? "One person is here."
                : `${people} people are here.`
          }
          action={
            userId
              ? {
                  label: "Join",
                  onClick: () => void joinVoiceChannel({ spaceId, channelId, name }, userId),
                }
              : undefined
          }
        />
      )}
    </Surface>
  );
}
