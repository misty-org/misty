import { create } from "zustand";

/**
 * Whether this window's live line to the Misty server (the Spaces realtime socket) is up:
 * `off` while signed out or with no server, `connecting` the first time, `connected`, and
 * `reconnecting` after it drops, until it is back. The window's bottom bar shows it.
 */
export type SpacesConnection = "off" | "connecting" | "connected" | "reconnecting";

export const useSpacesConnection = create<{ state: SpacesConnection }>(() => ({ state: "off" }));

export function setSpacesConnection(state: SpacesConnection): void {
  if (useSpacesConnection.getState().state !== state) useSpacesConnection.setState({ state });
}
