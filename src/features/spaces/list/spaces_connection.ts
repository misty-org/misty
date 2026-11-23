import { create } from "zustand";

export type SpacesConnection = "off" | "connecting" | "connected" | "reconnecting";

export const useSpacesConnection = create<{ state: SpacesConnection }>(() => ({ state: "off" }));

export function setSpacesConnection(state: SpacesConnection): void {
  if (useSpacesConnection.getState().state !== state) useSpacesConnection.setState({ state });
}
