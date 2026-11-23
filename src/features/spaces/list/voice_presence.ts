import { create } from "zustand";
import { onRealtimeMessage, onRealtimeOpen, sendRealtimeMessage } from "./realtime_extras";

interface VoicePresenceState {
  bySpace: Record<string, Record<string, string[]>>;
}

export const useVoicePresence = create<VoicePresenceState>(() => ({ bySpace: {} }));

const watched = new Set<string>();

export function watchVoicePresence(spaceId: string): () => void {
  watched.add(spaceId);
  sendRealtimeMessage({ type: "voice.sync", space_id: spaceId });
  return () => watched.delete(spaceId);
}

export function voiceChannelOf(
  state: VoicePresenceState,
  spaceId: string,
  userId: string,
): string | undefined {
  const channels = state.bySpace[spaceId] ?? {};
  return Object.keys(channels).find((channelId) => channels[channelId]?.includes(userId));
}

onRealtimeMessage("voice", (message) => {
  const spaceId = typeof message.space_id === "string" ? message.space_id : "";
  if (!spaceId || !Array.isArray(message.channels)) return;
  const channels: Record<string, string[]> = {};
  for (const entry of message.channels as unknown[]) {
    const channel = entry as { channel_id?: unknown; people?: unknown };
    if (typeof channel.channel_id !== "string" || !Array.isArray(channel.people)) continue;
    channels[channel.channel_id] = channel.people
      .map((person) => (person as { user_id?: unknown }).user_id)
      .filter((id): id is string => typeof id === "string");
  }
  useVoicePresence.setState((state) => ({ bySpace: { ...state.bySpace, [spaceId]: channels } }));
});

onRealtimeOpen(() => {
  for (const spaceId of watched) sendRealtimeMessage({ type: "voice.sync", space_id: spaceId });
});
