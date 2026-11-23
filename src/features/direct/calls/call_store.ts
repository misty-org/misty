import { create } from "zustand";
import { callEncryptionSupported } from "./call_support";
import { notify } from "@misty/ui";
import { directApi, type CallConfig } from "../api";
import { newCallKey, openRingKey, sealForDm } from "./call_keys";
import { checkCallRoom } from "./call_room";
import { useMissedCalls } from "./missed_calls";
import { peekDm } from "../direct_data";

export type CallPlace =
  | { kind: "dm"; dmId: string }
  | { kind: "voice"; spaceId: string; channelId: string; name: string };

export interface ActiveCall {
  place: CallPlace;
  room: string;
  video: boolean;
  muted?: boolean;
  key: Uint8Array<ArrayBuffer>;
  state: "connecting" | "live";
  caller: boolean;
  answered: boolean;
  ringFrom?: string;
}

export interface IncomingRing {
  dmId: string;
  from: string;
  video: boolean;
  sealedKeys: Record<string, string>;
}

export interface LiveCallAudio {
  micOn: boolean;
  deafened: boolean;
  noiseReduction: boolean;
  toggleMic(): void;
  toggleDeafen(): void;
  setNoiseReduction(on: boolean): void;
  activeDevice(kind: "audioinput" | "audiooutput"): string;
  pickDevice(kind: "audioinput" | "audiooutput", deviceId: string): void;
}

interface CallState {
  config: CallConfig | null;
  active: ActiveCall | null;
  incoming: IncomingRing | null;
  speaking: string[];
  setSpeaking(userIds: string[]): void;
  mic: { on: boolean; set(on: boolean): void } | null;
  audio: LiveCallAudio | null;
  loadConfig(): void;
  start(dmId: string, video: boolean): Promise<void>;
  join(
    place: CallPlace,
    room: string,
    key: Uint8Array<ArrayBuffer>,
    video?: boolean,
    muted?: boolean,
  ): void;
  accept(): Promise<void>;
  decline(): void;
  ring(ring: IncomingRing | null): void;
  ringEnded(dmId: string, from: string): void;
  answeredElsewhere(dmId: string): void;
  setLive(): void;
  setAnswered(): void;
  leave(): void;
}

export const dmRoom = (dmId: string) => `dm:${dmId}`;

export const voiceRoom = (spaceId: string, channelId: string) =>
  `space:${spaceId}:voice:${channelId}`;

export const dmOf = (call: ActiveCall | null | undefined) =>
  call?.place.kind === "dm" ? call.place.dmId : undefined;

let configRequested = false;
let accepting: IncomingRing | null = null;
const starting = new Map<string, Promise<void>>();

const missRing = (ring: IncomingRing) =>
  useMissedCalls
    .getState()
    .miss(ring.dmId, { from: ring.from, video: ring.video, at: Date.now() });

const isGroupDm = (dmId: string) => peekDm(dmId)?.kind === "group";

const tellAnswered = (dmId: string, video: boolean) =>
  void directApi.ringDm(dmId, "answered", video).catch(() => undefined);

function busyForWaiting() {
  const { active, incoming } = useCallStore.getState();
  if (!active || !incoming || dmOf(active) === incoming.dmId) return;
  useCallStore.setState({ incoming: null });
  void directApi.ringDm(incoming.dmId, "busy", incoming.video).catch(() => undefined);
  missRing(incoming);
}

export const useCallStore = create<CallState>((set, get) => ({
  config: null,
  active: null,
  incoming: null,
  speaking: [],
  mic: null,
  audio: null,
  setSpeaking(userIds) {
    const current = get().speaking;
    if (current.length === userIds.length && current.every((id, index) => id === userIds[index]))
      return;
    set({ speaking: userIds });
  },
  loadConfig() {
    if (configRequested) return;
    configRequested = true;
    void directApi
      .callConfig()
      .then((config) => set({ config }))
      .catch(() => {
        configRequested = false;
      });
  },
  start(dmId, video) {
    const running = starting.get(dmId);
    if (running) return running;
    const run = startCall(dmId, video).finally(() => {
      if (starting.get(dmId) === run) starting.delete(dmId);
    });
    starting.set(dmId, run);
    return run;
  },
  async accept() {
    const ring = get().incoming;
    if (!ring || get().active || !callEncryptionSupported()) return;
    set({ incoming: null });
    accepting = ring;
    const key = await openRingKey(ring.sealedKeys).then(
      (opened) => opened ?? null,
      () => undefined,
    );
    const ended = accepting !== ring;
    if (accepting === ring) accepting = null;
    if (ended) {
      notify({ message: "The call ended before you joined." });
      return;
    }
    if (!key) {
      notify({
        message:
          key === null
            ? "This call can’t be opened on this computer."
            : "The call’s key couldn’t be opened.",
        tone: "error",
      });
      return;
    }
    if (get().active) return;
    tellAnswered(ring.dmId, ring.video);
    set({
      active: {
        place: { kind: "dm", dmId: ring.dmId },
        room: dmRoom(ring.dmId),
        video: ring.video,
        key,
        state: "connecting",
        caller: false,
        answered: true,
        ringFrom: ring.from,
      },
    });
    busyForWaiting();
  },
  join(place, room, key, video = false, muted = false) {
    if (get().active || !callEncryptionSupported()) return;
    set({
      active: {
        place,
        room,
        video,
        muted,
        key,
        state: "connecting",
        caller: false,
        answered: true,
      },
    });
  },
  decline() {
    const incoming = get().incoming;
    set({ incoming: null });
    if (incoming)
      void directApi.ringDm(incoming.dmId, "declined", incoming.video).catch(() => undefined);
  },
  ring(ring) {
    const active = get().active;
    if (ring && dmOf(active) === ring.dmId) return;
    if (ring && active) {
      void directApi.ringDm(ring.dmId, "busy", ring.video).catch(() => undefined);
      missRing(ring);
      return;
    }
    const replaced = get().incoming;
    if (ring && replaced && replaced.dmId !== ring.dmId) missRing(replaced);
    set({ incoming: ring });
  },
  ringEnded(dmId, from) {
    if (accepting?.dmId === dmId && accepting.from === from) accepting = null;
    const active = get().active;
    if (dmOf(active) === dmId && active?.ringFrom === from && active.state === "connecting") {
      get().leave();
      notify({ message: "The call ended." });
      return;
    }
    const incoming = get().incoming;
    if (incoming?.dmId !== dmId || incoming.from !== from) return;
    set({ incoming: null });
    missRing(incoming);
  },
  answeredElsewhere(dmId) {
    if (get().incoming?.dmId === dmId) set({ incoming: null });
  },
  setLive() {
    const active = get().active;
    if (active) set({ active: { ...active, state: "live" } });
  },
  setAnswered() {
    const active = get().active;
    if (active && !active.answered) set({ active: { ...active, answered: true } });
  },
  leave() {
    const active = get().active;
    if (!active) return;
    set({ active: null, speaking: [], mic: null, audio: null });
    const dmId = dmOf(active);
    if (dmId && active.caller && !active.answered)
      void directApi.ringDm(dmId, "ended", false).catch(() => undefined);
  },
}));

async function startCall(dmId: string, video: boolean): Promise<void> {
  const get = useCallStore.getState;
  const set = useCallStore.setState;
  if (get().active || !callEncryptionSupported()) return;
  if (get().incoming?.dmId === dmId) return get().accept();
  const room = dmRoom(dmId);
  try {
    const check = await checkCallRoom(room);
    if (check.full) {
      notify({ message: "This call is full." });
      return;
    }
    if (get().active) return;
    if (get().incoming?.dmId === dmId) return get().accept();
    if (check.people?.length && isGroupDm(dmId)) {
      set({
        active: {
          place: { kind: "dm", dmId },
          room,
          video,
          key: newCallKey(),
          state: "connecting",
          caller: false,
          answered: true,
        },
      });
      tellAnswered(dmId, video);
      busyForWaiting();
      return;
    }
    const { callKey, sealedKeys, senderKeyId } = await sealForDm(dmId);
    if (get().active) return;
    if (get().incoming?.dmId === dmId) return get().accept();
    await directApi.ringDm(dmId, "ringing", video, sealedKeys, senderKeyId);
    const now = get().active;
    if (now) {
      if (!(dmOf(now) === dmId && now.caller && !now.answered))
        void directApi.ringDm(dmId, "ended", false).catch(() => undefined);
      return;
    }
    const incoming = get().incoming;
    const glare = incoming?.dmId === dmId;
    set({
      incoming: glare ? null : incoming,
      active: {
        place: { kind: "dm", dmId },
        room,
        video,
        key: callKey,
        state: "connecting",
        caller: true,
        answered: false,
      },
    });
    if (glare) tellAnswered(dmId, video);
    busyForWaiting();
  } catch {
    notify({ message: "The call couldn’t start.", tone: "error" });
  }
}

export function useCallsAvailable(): boolean {
  const enabled = useCallStore((state) => Boolean(state.config?.enabled));
  return enabled && callEncryptionSupported();
}
