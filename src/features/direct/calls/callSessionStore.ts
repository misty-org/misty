import { create } from "zustand";
import type { PipCorner } from "@misty/ui";
import { dmPath } from "../directData";
import type { ActiveCall } from "./callStore";
import type { CallControls } from "./useLiveKitCall";
import type { CallAgentPart } from "./useCallAgent";

/**
 * The call this window is in, as everything that draws it reads it: the room is joined once, by
 * `CallSession` at the window's root, and its controls are published here so the call can show on
 * its own page (a voice channel's), above a DM's messages, full screen or in the mini player
 * without ever reconnecting.
 */
interface CallSessionState {
  controls: CallControls | null;
  /** The call's agents: their tiles, rows and menu (`useCallAgent`), drawn by whatever shows the call. */
  agent: CallAgentPart | null;
  /** The name a person in the call goes by here: the DM's or the Space's. */
  nameOf: (userId: string) => string;
  /** The call fills the window (and the window fills the screen). */
  fullscreen: boolean;
  /** Who is shown large: a person picked, else whoever shares a watched screen. */
  pinned: string | null;
  /** Where the mini player rests. */
  pipCorner: PipCorner;
  publish(session: Pick<CallSessionState, "controls" | "agent" | "nameOf">): void;
  clear(): void;
  setFullscreen(on: boolean): void;
  pin(personId: string | null): void;
  setPipCorner(corner: PipCorner): void;
}

export const useCallSession = create<CallSessionState>((set) => ({
  controls: null,
  agent: null,
  nameOf: (userId) => userId,
  fullscreen: false,
  pinned: null,
  pipCorner: "bottom-right",
  publish: (session) => set(session),
  clear: () => set({ controls: null, agent: null, fullscreen: false, pinned: null }),
  setFullscreen: (fullscreen) => set({ fullscreen }),
  pin: (pinned) => set({ pinned }),
  setPipCorner: (pipCorner) => set({ pipCorner }),
}));

/** The address of a voice channel's call page. */
export const voicePath = (spaceId: string, channelId: string) =>
  `/spaces/${encodeURIComponent(spaceId)}/voice/${encodeURIComponent(channelId)}`;

/** Where a call is shown in full: its voice channel's page, or its DM. */
export function callPath(call: ActiveCall): string {
  return call.place.kind === "voice"
    ? voicePath(call.place.spaceId, call.place.channelId)
    : dmPath(call.place.dmId);
}
