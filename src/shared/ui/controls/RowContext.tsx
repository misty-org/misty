import { createContext, useContext, type ReactNode } from "react";

/**
 * Whether a control sits on a row (a tree's, a list's, a file's). A row is 32px; a 32px button on
 * it would fill it edge to edge and look taller than the row, with its padding opening wide gaps
 * between icons. So on a row every IconButton is 24px (sm), set here, never by the feature: 4px
 * of the row shows around each, and icons sit close together.
 */
const OnRow = createContext(false);

/** Makes the controls inside a row's own: their IconButtons are 24px. Rows give it to their
 * control slots (ListRow's `trailing`, TreeRow's `end`, RowTools); features never do. */
export function RowControls({ children }: { children: ReactNode }) {
  return <OnRow.Provider value>{children}</OnRow.Provider>;
}

/** Ends a row's reach: what a control opens (a menu, a dialog) portals out of the row, but React
 * context follows it there, so each overlay's content starts off the row again. */
export function OutOfRow({ children }: { children: ReactNode }) {
  return <OnRow.Provider value={false}>{children}</OnRow.Provider>;
}

/** Whether the control is on a row, so IconButton takes the row's size. */
export function useOnRow(): boolean {
  return useContext(OnRow);
}
