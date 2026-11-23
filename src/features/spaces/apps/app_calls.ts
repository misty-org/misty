import type { ComponentType } from "react";
import { createPort } from "@/shared/lib/seams";
import { spacesApi } from "../api/api";
import { useVoicePresence, watchVoicePresence } from "../list/voice_presence";
import { HostError } from "./protocol";

export interface WindowCall {
  spaceId: string;
  channelId: string;
  micOn: boolean;
}

export const appCallsHost = createPort<{
  current(): WindowCall | null;
  subscribe(listener: () => void): () => void;
  join(channel: { spaceId: string; channelId: string; name: string }): Promise<void>;
  leave(): void;
  setMuted(muted: boolean): void;
}>("App calls");

export const voiceChannelPage =
  createPort<ComponentType<{ spaceId: string; channelId: string; workspaceTabId?: string }>>(
    "Voice channel page",
  );

const voiceChannelsOf = async (spaceId: string) =>
  (await spacesApi.conversations(spaceId)).conversations.filter(
    (conversation) => conversation.voice,
  );

export function createAppCalls(spaceId: string) {
  const host = () => {
    const found = appCallsHost.maybe();
    if (!found) throw new HostError("unsupported", "Calls aren't available in this window.");
    return found;
  };
  const currentFor = () => {
    const call = host().current();
    const here = call?.spaceId === spaceId ? call : null;
    return { channel_id: here?.channelId ?? null, mic_on: Boolean(here?.micOn) };
  };
  return {
    calls: {
      "calls.join": async (params: Record<string, unknown>) => {
        const channelId = typeof params.channel_id === "string" ? params.channel_id : "";
        const channel = (await voiceChannelsOf(spaceId)).find((item) => item.id === channelId);
        if (!channel) throw new HostError("not_found", "There is no such voice channel.");
        await host().join({ spaceId, channelId, name: channel.title });
      },
      "calls.leave": async () => {
        if (host().current()?.spaceId === spaceId) host().leave();
      },
      "calls.mute": async (params: Record<string, unknown>) => {
        if (host().current()?.spaceId === spaceId) host().setMuted(params.muted === true);
      },
    },
    watchChannels(emit: (data: unknown) => void): () => void {
      let names = new Map<string, string>();
      let closed = false;
      const send = () => {
        const people = useVoicePresence.getState().bySpace[spaceId] ?? {};
        emit(
          [...names].map(([channelId, name]) => ({
            channel_id: channelId,
            name,
            people: people[channelId] ?? [],
          })),
        );
      };
      void voiceChannelsOf(spaceId)
        .then((channels) => {
          if (closed) return;
          names = new Map(channels.map((channel) => [channel.id, channel.title]));
          send();
        })
        .catch(() => {
          if (!closed) send();
        });
      const stopWatching = watchVoicePresence(spaceId);
      const stopPresence = useVoicePresence.subscribe((state, previous) => {
        if (state.bySpace[spaceId] !== previous.bySpace[spaceId]) send();
      });
      return () => {
        closed = true;
        stopWatching();
        stopPresence();
      };
    },
    watchCurrent(emit: (data: unknown) => void): () => void {
      let last = "";
      const send = () => {
        const state = currentFor();
        const key = JSON.stringify(state);
        if (key === last) return;
        last = key;
        emit(state);
      };
      send();
      return host().subscribe(send);
    },
  };
}
