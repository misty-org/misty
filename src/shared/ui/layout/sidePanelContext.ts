import { createContext } from "react";

// The panel's contexts live in a module of their own that imports nothing of the app's, so a hot
// reload of SidePanel (or anything it imports) never makes a second copy: a view loaded later
// (the panel's content is lazy) would read that copy, miss its panel and draw its header controls
// in the body.

/** Where an open view puts its own controls: the panel's header row. */
export const HeaderSlot = createContext<HTMLElement | null>(null);
/** Whether the tree is inside a SidePanel, so SidePanelHeader waits for its slot. */
export const InPanel = createContext(false);
