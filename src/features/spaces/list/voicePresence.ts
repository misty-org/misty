import { create } from "zustand";
import { onRealtimeMessage, onRealtimeOpen, sendRealtimeMessage } from "./realtimeExtras";

/**
 * Who is in each of a Space's voice channels, as the server tells the Space's members over the socket
 * (`realtime_voice.go`): each person once, and only channels this person may join. Nothing is kept: it
 * is what the server knows from the connections open now.
 */
interface VoicePresenceState {
  /** Space id → voice channel id → the user ids in it. */
  bySpace: Record<string, Record<string, string[]>>;
}

export const useVoicePresence = create<VoicePresenceState>(() => ({ bySpace: {} }));

const watched = new Set<string>();

/** Asks for who is in a Space's voice channels now, and keeps asking each time the socket reopens. */
export function watchVoicePresence(spaceId: string): () => void {
  watched.add(spaceId);
  sendRealtimeMessage({ type: "voice.sync", space_id: spaceId });
  return () => watched.delete(spaceId);
}

/** The voice channel a member is in within a Space, if any. */
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
