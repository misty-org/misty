import { callEncryptionSupported } from "./call_support";
import { notify } from "@misty/ui";
import {
  onRealtimeMessage,
  onRealtimeOpen,
  sendRealtimeMessage,
  useVoicePresence,
} from "@/features/spaces";
import { deviceCallKey, newCallKey, openCallKey, sealCallKey } from "./call_keys";
import { useCallStore, voiceRoom, type ActiveCall } from "./call_store";
import { checkCallRoom } from "./call_room";
import { useCallSession } from "./call_session_store";
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

interface PendingJoin {
  spaceId: string;
  channelId: string;
  full?(): void;
  key?(sealed: string): void;
}

const pendingJoins = new Set<PendingJoin>();
let joinAttempt = 0;

const pendingFor = (spaceId: unknown, channelId: unknown) =>
  [...pendingJoins].filter(
    (pending) => pending.spaceId === spaceId && pending.channelId === channelId,
  );

function joined(pending: PendingJoin, userId: string): Promise<string[]> {
  const { spaceId, channelId } = pending;
  return new Promise((resolve, reject) => {
    const listed = () => useVoicePresence.getState().bySpace[spaceId]?.[channelId] ?? [];
    const finish = (error?: Error) => {
      window.clearTimeout(timer);
      stop();
      pending.full = undefined;
      if (error) reject(error);
      else resolve(listed());
    };
    const stop = useVoicePresence.subscribe(() => {
      if (listed().includes(userId)) finish();
    });
    pending.full = () => finish(new Error("This channel is full."));
    const timer = window.setTimeout(
      () =>
        finish(new Error("Couldn’t join the voice channel. Check your connection and try again.")),
      JOIN_WAIT_MS,
    );
    if (listed().includes(userId)) finish();
  });
}

function channelKey(pending: PendingJoin): Promise<string | undefined> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      pending.key = undefined;
      resolve(undefined);
    }, KEY_WAIT_MS);
    pending.key = (sealed) => {
      window.clearTimeout(timer);
      pending.key = undefined;
      resolve(sealed);
    };
  });
}

class JoinSuperseded extends Error {}

async function enterVoiceChannel(
  channel: VoiceChannel,
  userId: string,
  start: { video?: boolean; muted?: boolean },
): Promise<void> {
  const store = useCallStore.getState();
  const current = isVoice(store.active);
  if (current?.spaceId === channel.spaceId && current.channelId === channel.channelId) return;
  if (store.active && !current) throw new Error("Leave the call you’re in first.");
  if (!callEncryptionSupported())
    throw new Error("Calls need end-to-end encryption, which this computer can’t do.");
  if (current) store.leave();
  const attempt = ++joinAttempt;
  const pending: PendingJoin = { spaceId: channel.spaceId, channelId: channel.channelId };
  pendingJoins.add(pending);
  const room = voiceRoom(channel.spaceId, channel.channelId);
  const stillMine = () => {
    if (attempt !== joinAttempt) throw new JoinSuperseded();
  };
  try {
    const own = await deviceCallKey();
    stillMine();
    sendRealtimeMessage({
      type: "voice",
      space_id: channel.spaceId,
      channel_id: channel.channelId,
      key_id: own.keyId,
    });
    const listed = await joined(pending, userId);
    stillMine();
    const check = await checkCallRoom(room);
    stillMine();
    if (check.full) throw new Error("This channel is full.");
    const present =
      useVoicePresence.getState().bySpace[channel.spaceId]?.[channel.channelId] ?? listed;
    const others = (check.people ?? listed).filter(
      (id) => id !== userId && (!check.people || present.includes(id)),
    );
    let key: Uint8Array<ArrayBuffer> | undefined;
    if (others.length) {
      const waiting = channelKey(pending);
      sendRealtimeMessage({
        type: "voice.key_request",
        space_id: channel.spaceId,
        channel_id: channel.channelId,
        key_id: own.keyId,
        public_key: own.publicKey,
      });
      const sealed = await waiting;
      stillMine();
      if (sealed)
        key = await openCallKey(sealed).catch(() => {
          throw new Error("The call’s key couldn’t be opened.");
        });
      else if (!check.people)
        throw new Error("Nobody in the channel answered with its key. Try again.");
      stillMine();
    }
    const place = {
      kind: "voice" as const,
      spaceId: channel.spaceId,
      channelId: channel.channelId,
      name: channel.name,
    };
    useCallStore
      .getState()
      .join(place, room, key ?? newCallKey(), start.video ?? false, start.muted ?? false);
    if (useCallStore.getState().active?.room !== room)
      throw new Error("Leave the call you’re in first.");
  } catch (reason) {
    if (reason instanceof JoinSuperseded) return;
    if (attempt === joinAttempt && !isVoice(useCallStore.getState().active))
      sendRealtimeMessage({ type: "voice", space_id: channel.spaceId, channel_id: "" });
    throw reason instanceof Error ? reason : new Error("Couldn’t join the voice channel.");
  } finally {
    pendingJoins.delete(pending);
  }
}

export async function joinVoiceChannel(
  channel: VoiceChannel,
  userId: string,
  start: { video?: boolean; muted?: boolean } = {},
): Promise<void> {
  try {
    await enterVoiceChannel(channel, userId, start);
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "Couldn’t join the voice channel.";
    notify(
      message === "Leave the call you’re in first." ? { message } : { message, tone: "error" },
    );
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
  void sealCallKey(useCallSession.getState().controls?.baseKey ?? active.key, publicKey)
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
  if (typeof message.sealed !== "string") return;
  const sealed = message.sealed;
  for (const pending of pendingFor(message.space_id, message.channel_id)) pending.key?.(sealed);
});

onRealtimeMessage("voice.full", (message) => {
  const waiting = pendingFor(message.space_id, message.channel_id);
  for (const pending of waiting) pending.full?.();
  if (waiting.length) return;
  const place = isVoice(useCallStore.getState().active);
  if (!place || place.spaceId !== message.space_id || place.channelId !== message.channel_id) return;
  if (useCallStore.getState().active?.state === "live") return;
  useCallStore.getState().leave();
  notify({ message: "This channel is full, so you left it." });
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
      ? {
          spaceId: place.spaceId,
          channelId: place.channelId,
          micOn: Boolean(state.mic?.on),
          live: state.active?.state === "live",
          deafened: Boolean(state.audio?.deafened),
        }
      : null;
  },
  subscribe(listener: () => void) {
    return useCallStore.subscribe(listener);
  },
  async join(
    channel: { spaceId: string; channelId: string; name: string },
    options?: { muted?: boolean },
  ) {
    const userId = useDirectAccount.getState().userId;
    if (!userId) throw new Error("Sign in to join a voice channel.");
    await enterVoiceChannel(channel, userId, { muted: options?.muted ?? true });
  },
  leave() {
    if (isVoice(useCallStore.getState().active)) useCallStore.getState().leave();
  },
  setMuted(muted: boolean) {
    useCallStore.getState().mic?.set(!muted);
  },
};
