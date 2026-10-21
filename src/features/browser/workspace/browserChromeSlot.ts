import { createContext, useContext, type ReactNode } from "react";

/** What the app around the browser lends its menu: the account rows of the browser menu. */
export type BrowserChromeSlot = {
  accountItems: ReactNode;
};

export const BrowserChromeSlotContext = createContext<BrowserChromeSlot | null>(null);
export const useBrowserChromeSlot = () => useContext(BrowserChromeSlotContext);
