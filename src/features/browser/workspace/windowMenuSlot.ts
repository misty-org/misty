import { createContext, useContext, type ReactNode } from "react";

/**
 * The virtual window menu, supplied by the workspace around the browser so the pane layout
 * menu can hold it. Rows go inside dropdown content; the dialog sits outside the menu.
 */
export type WindowMenuSlot = {
  items: ReactNode;
  dialog: ReactNode;
  /** Registers the element the window color picker opens beside. */
  registerAnchor(element: HTMLElement | null): () => void;
};

export const WindowMenuSlotContext = createContext<WindowMenuSlot | null>(null);
export const useWindowMenuSlot = () => useContext(WindowMenuSlotContext);
