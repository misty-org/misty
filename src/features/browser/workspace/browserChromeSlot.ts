import { createContext, useContext, type ReactNode } from "react";

/**
 * What the app around the browser lends its toolbar and menu: the sync status, the profile
 * button and the account rows of the browser menu. The tab strip is the only bar; Spaces and
 * agents are pages reached from the ⌘T panel.
 */
export type BrowserChromeSlot = {
  /** The sync status button. */
  sync: ReactNode;
  /** The profile button. */
  profile: ReactNode;
  accountItems: ReactNode;
};

export const BrowserChromeSlotContext = createContext<BrowserChromeSlot | null>(null);
export const useBrowserChromeSlot = () => useContext(BrowserChromeSlotContext);
