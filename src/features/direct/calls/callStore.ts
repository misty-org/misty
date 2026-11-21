import { create } from "zustand";
import { isE2EESupported } from "livekit-client";
import { notify } from "@misty/ui";
import { directApi, type CallConfig } from "../api";
import { openRingKey, sealForDm } from "./callKeys";

/** Where a call is: a DM (rung), or a Space's voice channel (dropped into, never rung). */
export type CallPlace =
  | { kind: "dm"; dmId: string }
  | { kind: "voice"; spaceId: string; channelId: string; name: string };

/**
 * The call this window is in. The key never leaves this computer except sealed for the computers of the
 * people in it.
 */
export interface ActiveCall {
  place: CallPlace;
  /** The LiveKit room: `dm:<id>` or `space:<id>:voice:<channel>`. */
  room: string;
  video: boolean;
  /** The call's end-to-end key: media is encrypted with it before LiveKit sees it. */
  key: Uint8Array<ArrayBuffer>;
  state: "connecting" | "live";
  /** This window rang the others. */
  caller: boolean;
  /** Someone else has joined, so leaving doesn't end the ring. */
  answered: boolean;
}

/** A ring from someone in a DM, waiting on Accept or Decline. */
export interface IncomingRing {
  dmId: string;
  from: string;
  video: boolean;
  sealedKeys: Record<string, string>;
}

interface CallState {
  config: CallConfig | null;
  active: ActiveCall | null;
  incoming: IncomingRing | null;
  /** Who is talking in this window's call now, by user id; the sidebar rings their faces. */
  speaking: string[];
  setSpeaking(userIds: string[]): void;
  /** This window's microphone in the call, and how to turn it on or off (from outside the panel). */
  mic: { on: boolean; set(on: boolean): void } | null;
  loadConfig(): void;
  start(dmId: string, video: boolean): Promise<void>;
  /** Joins a room whose key this computer already holds (a voice channel's), with nobody rung. */
  join(place: CallPlace, room: string, key: Uint8Array<ArrayBuffer>, video?: boolean): void;
  accept(): Promise<void>;
  decline(): void;
  ring(ring: IncomingRing | null): void;
  setLive(): void;
  setAnswered(): void;
  /** Ends this window's part in the call; the panel disconnects the room. */
  leave(): void;
}

export const dmRoom = (dmId: string) => `dm:${dmId}`;

/** A Space voice channel's room. */
export const voiceRoom = (spaceId: string, channelId: string) => `space:${spaceId}:voice:${channelId}`;

/** The DM a call is in, if it is in one. */
export const dmOf = (call: ActiveCall | null | undefined) =>
  call?.place.kind === "dm" ? call.place.dmId : undefined;

let configRequested = false;

export const useCallStore = create<CallState>((set, get) => ({
  config: null,
  active: null,
  incoming: null,
  speaking: [],
  mic: null,
  setSpeaking(userIds) {
    const current = get().speaking;
    if (current.length === userIds.length && current.every((id, index) => id === userIds[index])) return;
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
  join(place, room, key, video = false) {
    if (get().active || !isE2EESupported()) return;
    set({
      active: { place, room, video, key, state: "connecting", caller: false, answered: true },
    });
  },
  decline() {
    const incoming = get().incoming;
    set({ incoming: null });
    // The caller hears it was declined; the ring goes on for anyone else in a group.
    if (incoming)
      void directApi.ringDm(incoming.dmId, "declined", incoming.video).catch(() => undefined);
  },
  ring(ring) {
    // A ring for the call this window is already in changes nothing.
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
    set({ active: null, speaking: [], mic: null });
    // Nobody picked up: stop it ringing for the others.
    const dmId = dmOf(active);
    if (dmId && active.caller && !active.answered)
      void directApi.ringDm(dmId, "ended", false).catch(() => undefined);
  },
}));

/** Calls are offered once the server has them and this computer can encrypt them end to end. */
export function useCallsAvailable(): boolean {
  const enabled = useCallStore((state) => Boolean(state.config?.enabled));
  return enabled && isE2EESupported();
}
