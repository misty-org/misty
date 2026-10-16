import { createContext, useContext } from "react";

/**
 * The pane's toolbar row. A pane with horizontal tabs owns one toolbar for every page it
 * shows: a browser page portals its live toolbar into this element, and any other page
 * rests the same toolbar there. Null where no pane hosts a toolbar (vertical tabs, a
 * standalone browser), and the browser page then draws its own row.
 */
const PaneToolbarHost = createContext<HTMLElement | null>(null);

export const PaneToolbarHostProvider = PaneToolbarHost.Provider;

export function usePaneToolbarHost() {
  return useContext(PaneToolbarHost);
}
