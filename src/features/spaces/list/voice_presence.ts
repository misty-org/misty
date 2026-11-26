import { create } from "zustand";
import { onRealtimeMessage, onRealtimeOpen, sendRealtimeMessage } from "./realtime_extras";

interface VoicePresenceState {
  bySpace: Record<string, Record<string, string[]>>;
}

export const useVoicePresence = create<VoicePresenceState>(() => ({ bySpace: {} }));

const watched = new Map<string, number>();
let watchEpoch = 0;

export function watchVoicePresence(spaceId: string): () => void {
  const epoch = watchEpoch;
  watched.set(spaceId, (watched.get(spaceId) ?? 0) + 1);
  sendRealtimeMessage({ type: "voice.sync", space_id: spaceId });
  let stopped = false;
  return () => {
    if (stopped || epoch !== watchEpoch) return;
    stopped = true;
    const count = (watched.get(spaceId) ?? 0) - 1;
    if (count > 0) watched.set(spaceId, count);
    else watched.delete(spaceId);
  };
}

export function clearVoicePresence(): void {
  useVoicePresence.setState({ bySpace: {} });
}

export function resetVoicePresence(): void {
  watchEpoch += 1;
  watched.clear();
  clearVoicePresence();
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
  for (const spaceId of watched.keys())
    sendRealtimeMessage({ type: "voice.sync", space_id: spaceId });
});
