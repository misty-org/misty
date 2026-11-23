import { isE2EESupported } from "livekit-client";
import { notify } from "@misty/ui";
import {
  onRealtimeMessage,
  onRealtimeOpen,
  sendRealtimeMessage,
  useVoicePresence,
} from "@/features/spaces";
import { deviceCallKey, newCallKey, openCallKey, sealCallKey } from "./call_keys";
import { useCallStore, voiceRoom, type ActiveCall } from "./call_store";
import { useDirectAccount } from "../direct_account";

const JOIN_WAIT_MS = 5_000;
const KEY_WAIT_MS = 10_000;

export interface VoiceChannel {
  spaceId: string;
  channelId: string;
  name: string;
}

const isVoice = (call: ActiveCall | null) =>
  call?.place.kind === "voice" ? call.place : undefined;

let pendingKey: { spaceId: string; channelId: string; resolve(sealed: string): void } | null = null;
let pendingFull: { spaceId: string; channelId: string; reject(): void } | null = null;

function joined(spaceId: string, channelId: string, userId: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const listed = () => useVoicePresence.getState().bySpace[spaceId]?.[channelId] ?? [];
    const finish = (error?: Error) => {
      window.clearTimeout(timer);
      stop();
      pendingFull = null;
      if (error) reject(error);
      else resolve(listed());
    };
    const stop = useVoicePresence.subscribe(() => {
      if (listed().includes(userId)) finish();
    });
    pendingFull = { spaceId, channelId, reject: () => finish(new Error("This channel is full.")) };
    const timer = window.setTimeout(
      () =>
        finish(new Error("Couldn’t join the voice channel. Check your connection and try again.")),
      JOIN_WAIT_MS,
    );
    if (listed().includes(userId)) finish();
  });
}

function channelKey(spaceId: string, channelId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pendingKey = null;
      reject(new Error("Nobody in the channel answered with its key. Try again."));
    }, KEY_WAIT_MS);
    pendingKey = {
      spaceId,
      channelId,
      resolve(sealed) {
        window.clearTimeout(timer);
        pendingKey = null;
        resolve(sealed);
      },
    };
  });
}

export async function joinVoiceChannel(
  channel: VoiceChannel,
  userId: string,
  start: { video?: boolean; muted?: boolean } = {},
): Promise<void> {
  const store = useCallStore.getState();
  const current = isVoice(store.active);
  if (current?.spaceId === channel.spaceId && current.channelId === channel.channelId) return;
  if (store.active && !current) {
    notify({ message: "Leave the call you’re in first." });
    return;
  }
  if (!isE2EESupported()) {
    notify({
      message: "Calls need end-to-end encryption, which this computer can’t do.",
      tone: "error",
    });
    return;
  }
  if (current) store.leave();
  try {
    const own = await deviceCallKey();
    sendRealtimeMessage({
      type: "voice",
      space_id: channel.spaceId,
      channel_id: channel.channelId,
      key_id: own.keyId,
    });
    const people = await joined(channel.spaceId, channel.channelId, userId);
    let key: Uint8Array<ArrayBuffer>;
    if (people.some((id) => id !== userId)) {
      const waiting = channelKey(channel.spaceId, channel.channelId);
      sendRealtimeMessage({
        type: "voice.key_request",
        space_id: channel.spaceId,
        channel_id: channel.channelId,
        key_id: own.keyId,
        public_key: own.publicKey,
      });
      key = await openCallKey(await waiting);
    } else {
      key = newCallKey();
    }
    useCallStore.getState().join(
      {
        kind: "voice",
        spaceId: channel.spaceId,
        channelId: channel.channelId,
        name: channel.name,
      },
      voiceRoom(channel.spaceId, channel.channelId),
      key,
      start.video ?? false,
      start.muted ?? false,
    );
  } catch (reason) {
    sendRealtimeMessage({ type: "voice", space_id: channel.spaceId, channel_id: "" });
    notify({
      message: reason instanceof Error ? reason.message : "Couldn’t join the voice channel.",
      tone: "error",
    });
  }
}

onRealtimeMessage("voice.key_request", (message) => {
  const place = isVoice(useCallStore.getState().active);
  const active = useCallStore.getState().active;
  if (
    !place ||
    !active ||
    message.space_id !== place.spaceId ||
    message.channel_id !== place.channelId
  )
    return;
  const publicKey = typeof message.public_key === "string" ? message.public_key : "";
  const keyId = typeof message.key_id === "string" ? message.key_id : "";
  const from = typeof message.from === "string" ? message.from : "";
  if (!publicKey || !keyId || !from) return;
  void sealCallKey(active.key, publicKey)
    .then((sealed) =>
      sendRealtimeMessage({
        type: "voice.key",
        space_id: place.spaceId,
        channel_id: place.channelId,
        to_user_id: from,
        to_key_id: keyId,
        sealed,
      }),
    )
    .catch(() => undefined);
});

onRealtimeMessage("voice.key", (message) => {
  if (
    !pendingKey ||
    message.space_id !== pendingKey.spaceId ||
    message.channel_id !== pendingKey.channelId
  )
    return;
  if (typeof message.sealed === "string") pendingKey.resolve(message.sealed);
});

onRealtimeMessage("voice.full", (message) => {
  if (
    pendingFull &&
    message.space_id === pendingFull.spaceId &&
    message.channel_id === pendingFull.channelId
  )
    pendingFull.reject();
});

useCallStore.subscribe((state, previous) => {
  const left = isVoice(previous.active);
  if (!left || isVoice(state.active) === left) return;
  sendRealtimeMessage({ type: "voice", space_id: left.spaceId, channel_id: "" });
});

onRealtimeOpen(() => {
  const place = isVoice(useCallStore.getState().active);
  if (!place) return;
  void deviceCallKey()
    .then((own) =>
      sendRealtimeMessage({
        type: "voice",
        space_id: place.spaceId,
        channel_id: place.channelId,
        key_id: own.keyId,
      }),
    )
    .catch(() => undefined);
});

export function useActiveVoiceChannel(): VoiceChannel | undefined {
  const place = useCallStore((state) => isVoice(state.active));
  return place
    ? { spaceId: place.spaceId, channelId: place.channelId, name: place.name }
    : undefined;
}

export const useCallSpeaking = () => useCallStore((state) => state.speaking);

export const callsForApps = {
  current() {
    const state = useCallStore.getState();
    const place = isVoice(state.active);
    return place
      ? { spaceId: place.spaceId, channelId: place.channelId, micOn: Boolean(state.mic?.on) }
      : null;
  },
  subscribe(listener: () => void) {
    return useCallStore.subscribe(listener);
  },
  async join(channel: { spaceId: string; channelId: string; name: string }) {
    const userId = useDirectAccount.getState().userId;
    if (!userId) throw new Error("Sign in to join a voice channel.");
    await joinVoiceChannel(channel, userId);
  },
  leave() {
    if (isVoice(useCallStore.getState().active)) useCallStore.getState().leave();
  },
  setMuted(muted: boolean) {
    useCallStore.getState().mic?.set(!muted);
  },
};
