import { createContext, useContext, type ReactNode } from "react";

/**
 * What the app around the browser lends its toolbar and menu: the Spaces button beside Misty,
 * the profile button beside it, and the sync row that closes the browser menu.
 */
export type BrowserChromeSlot = {
  spaces: ReactNode;
  /** The agents pill, beside Spaces. */
  agents: ReactNode;
  /** The sync status button. */
  sync: ReactNode;
  /** The profile button, beside Spaces. */
  profile: ReactNode;
  accountItems: ReactNode;
};

export const BrowserChromeSlotContext = createContext<BrowserChromeSlot | null>(null);
export const useBrowserChromeSlot = () => useContext(BrowserChromeSlotContext);
