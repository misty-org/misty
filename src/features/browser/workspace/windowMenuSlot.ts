import { createContext, useContext, type ReactNode } from "react";

/**
 * The window's Space menu, supplied by the workspace around the browser so the pane layout
 * menu can hold it. Rows go inside dropdown content; the dialog sits outside the menu.
 */
export type WindowMenuSlot = {
  items: ReactNode;
  dialog: ReactNode;
};

export const WindowMenuSlotContext = createContext<WindowMenuSlot | null>(null);
export const useWindowMenuSlot = () => useContext(WindowMenuSlotContext);
