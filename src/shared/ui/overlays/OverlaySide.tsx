import { createContext, useContext } from "react";

export type OverlaySide = "top" | "right" | "bottom" | "left";
const OverlaySideContext = createContext<OverlaySide | undefined>(undefined);
/** Docked chrome points menus, popovers and hints inward, including portals. */
export const OverlaySideProvider = OverlaySideContext.Provider;
export const useOverlaySide = () => useContext(OverlaySideContext);
export const inwardSide: Record<OverlaySide, OverlaySide> = {
  left: "right",
  right: "left",
  top: "bottom",
  bottom: "top",
};
