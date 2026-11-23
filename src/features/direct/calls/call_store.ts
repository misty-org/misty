import { create } from "zustand";
import { isE2EESupported } from "livekit-client";
import { notify } from "@misty/ui";
import { directApi, type CallConfig } from "../api";
import { openRingKey, sealForDm } from "./call_keys";

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
  async start(dmId, video) {
    if (get().active || !isE2EESupported()) return;
    try {
      const { callKey, sealedKeys, senderKeyId } = await sealForDm(dmId);
      await directApi.ringDm(dmId, "ringing", video, sealedKeys, senderKeyId);
      set({
        active: {
          place: { kind: "dm", dmId },
          room: dmRoom(dmId),
          video,
          key: callKey,
          state: "connecting",
          caller: true,
          answered: false,
        },
      });
    } catch {
      notify({ message: "The call couldn’t start.", tone: "error" });
    }
  },
  async accept() {
    const ring = get().incoming;
    if (!ring || !isE2EESupported()) return;
    set({ incoming: null });
    const key = await openRingKey(ring.sealedKeys).catch(() => undefined);
    if (!key) {
      notify({ message: "This call can’t be opened on this computer.", tone: "error" });
      return;
    }
    set({
      active: {
        place: { kind: "dm", dmId: ring.dmId },
        room: dmRoom(ring.dmId),
        video: ring.video,
        key,
        state: "connecting",
        caller: false,
        answered: true,
      },
    });
  },
  join(place, room, key, video = false, muted = false) {
    if (get().active || !isE2EESupported()) return;
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
    if (ring && dmOf(get().active) === ring.dmId) return;
    set({ incoming: ring });
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

export function useCallsAvailable(): boolean {
  const enabled = useCallStore((state) => Boolean(state.config?.enabled));
  return enabled && isE2EESupported();
}
