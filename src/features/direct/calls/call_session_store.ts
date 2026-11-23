import { create } from "zustand";
import type { PipCorner } from "@misty/ui";
import { dmPath } from "../direct_data";
import type { ActiveCall } from "./call_store";
import type { CallControls } from "./use_live_kit_call";
import type { CallAgentPart } from "./UseCallAgent";

interface CallSessionState {
  controls: CallControls | null;
  agent: CallAgentPart | null;
  nameOf: (userId: string) => string;
  fullscreen: boolean;
  pinned: string | null;
  pipCorner: PipCorner;
  devicesOpen: "audio" | "camera" | null;
  screenZoom: number;
  setScreenZoom(zoom: number): void;
  setDevicesOpen(which: "audio" | "camera" | null): void;
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
  devicesOpen: null,
  screenZoom: 1,
  setScreenZoom: (screenZoom) => set({ screenZoom }),
  setDevicesOpen: (devicesOpen) => set({ devicesOpen }),
  publish: (session) => set(session),
  clear: () =>
    set({
      controls: null,
      agent: null,
      fullscreen: false,
      pinned: null,
      devicesOpen: null,
      screenZoom: 1,
    }),
  setFullscreen: (fullscreen) => set({ fullscreen }),
  pin: (pinned) => set({ pinned }),
  setPipCorner: (pipCorner) => set({ pipCorner }),
}));

export const voicePath = (spaceId: string, channelId: string) =>
  `/spaces/${encodeURIComponent(spaceId)}/voice/${encodeURIComponent(channelId)}`;

export function callPath(call: ActiveCall): string {
  return call.place.kind === "voice"
    ? voicePath(call.place.spaceId, call.place.channelId)
    : dmPath(call.place.dmId);
}
