import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Tabs always sit in a sidebar, on the left or the right of the window. */
export const tabSides = ["left", "right"] as const;
export type TabSide = (typeof tabSides)[number];
export interface DockingLayout {
  /** The side opposite the tabs. */
  navigation: TabSide;
  tabs: TabSide;
}
export interface SavedDockingLayout extends DockingLayout {
  id: string;
  name: string;
}
/**
 * A layout as stored. Layouts saved while tabs could also run along the top or bottom keep
 * those positions until they are read; `normalizeDockingLayout` turns them into the left side.
 */
export interface StoredDockingLayout {
  navigation: string;
  tabs: string;
}
export const defaultDockingLayout: DockingLayout = { navigation: "right", tabs: "left" };
/** The tabs' side is the one layout choice; navigation always takes the other side. */
export function normalizeDockingLayout(layout: StoredDockingLayout): DockingLayout {
  const tabs: TabSide = layout.tabs === "right" ? "right" : "left";
  return { tabs, navigation: tabs === "left" ? "right" : "left" };
}
const storedPositions = ["left", "top", "right", "bottom"];
export function validDockingLayout(value: unknown): value is StoredDockingLayout {
  if (!value || typeof value !== "object") return false;
  const layout = value as Partial<StoredDockingLayout>;
  return (
    storedPositions.includes(layout.navigation ?? "") && storedPositions.includes(layout.tabs ?? "")
  );
}
interface DockingState {
  /** Previous device-wide choice, used only for windows without their own layout. */
  initialLayout: DockingLayout;
  savedLayouts: SavedDockingLayout[];
}
export const useDockingLayoutStore = create<DockingState>()(
  persist(
    (): DockingState => ({
      initialLayout: defaultDockingLayout,
      savedLayouts: [],
    }),
    {
      name: "misty:desktop-docking:v1",
      partialize: ({ initialLayout, savedLayouts }) => ({ initialLayout, savedLayouts }),
      merge: (persisted, current) => {
        const saved = persisted as (Partial<DockingState> & { layout?: DockingLayout }) | null;
        const initialLayout = saved?.initialLayout ?? saved?.layout;
        return {
          ...current,
          initialLayout: validDockingLayout(initialLayout)
            ? normalizeDockingLayout(initialLayout)
            : defaultDockingLayout,
          savedLayouts: Array.isArray(saved?.savedLayouts)
            ? saved.savedLayouts
                .filter(
                  (item) =>
                    validDockingLayout(item) &&
                    typeof item.id === "string" &&
                    typeof item.name === "string" &&
                    item.name.trim(),
                )
                .map((item) => ({ ...item, ...normalizeDockingLayout(item) }))
            : [],
        };
      },
    },
  ),
);
