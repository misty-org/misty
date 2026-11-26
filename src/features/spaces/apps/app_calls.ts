import type { ComponentType } from "react";
import { createPort } from "@/shared/lib/seams";
import { spacesApi } from "../api/api";
import { useVoicePresence, watchVoicePresence } from "../list/voice_presence";
import { HostError } from "./protocol";

export interface WindowCall {
  spaceId: string;
  channelId: string;
  micOn: boolean;
  live?: boolean;
  deafened?: boolean;
}

type AppCallsHost = {
  current(): WindowCall | null;
  subscribe(listener: () => void): () => void;
  join(
    channel: { spaceId: string; channelId: string; name: string },
    options?: { muted?: boolean },
  ): Promise<void>;
  leave(): void;
  setMuted(muted: boolean): void;
};

export const appCallsHost = createPort<AppCallsHost>("App calls");

const JOIN_WAIT_MS = 20_000;

let joining: Promise<unknown> = Promise.resolve();

function inCall(host: AppCallsHost, spaceId: string, channelId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let stop = () => undefined as void;
    const finish = (error?: HostError) => {
      window.clearTimeout(timer);
      stop();
      if (error) reject(error);
      else resolve();
    };
    const check = () => {
      const call = host.current();
      if (!call || call.spaceId !== spaceId || call.channelId !== channelId) {
        finish(new HostError("internal", "Couldn’t join the voice channel."));
        return;
      }
      if (call.live !== false) finish();
    };
    const timer = window.setTimeout(
      () =>
        finish(new HostError("internal", "Couldn’t join the voice channel in time. Try again.")),
      JOIN_WAIT_MS,
    );
    stop = host.subscribe(check);
    check();
  });
}

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
        const calls = host();
        const run = joining
          .catch(() => undefined)
          .then(async () => {
            const call = calls.current();
            if (call?.spaceId === spaceId && call.channelId === channelId && call.live !== false)
              return;
            await calls.join({ spaceId, channelId, name: channel.title }, { muted: true });
            await inCall(calls, spaceId, channelId);
          });
        joining = run;
        await run;
      },
      "calls.leave": async () => {
        if (host().current()?.spaceId === spaceId) host().leave();
      },
      "calls.mute": async (params: Record<string, unknown>) => {
        const call = host().current();
        if (call?.spaceId !== spaceId) return;
        host().setMuted(params.muted === true);
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
