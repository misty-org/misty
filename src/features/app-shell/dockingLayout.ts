import { create } from "zustand";
import { persist } from "zustand/middleware";

export const dockPositions = ["left", "top", "right", "bottom"] as const;
export type DockPosition = (typeof dockPositions)[number];
export interface DockingLayout {
  navigation: DockPosition;
  tabs: DockPosition;
}
export interface SavedDockingLayout extends DockingLayout {
  id: string;
  name: string;
}
export const dockingPresets: SavedDockingLayout[] = [
  { id: "classic", name: "Classic", navigation: "left", tabs: "top" },
  { id: "top-bar", name: "Top bar", navigation: "top", tabs: "left" },
  { id: "bottom-dock", name: "Bottom dock", navigation: "bottom", tabs: "left" },
  { id: "right-rail", name: "Right rail", navigation: "right", tabs: "bottom" },
];
export const defaultDockingLayout: DockingLayout = { navigation: "left", tabs: "top" };
export const isSideDock = (position: DockPosition) => position === "left" || position === "right";
const isPosition = (value: unknown): value is DockPosition =>
  dockPositions.includes(value as DockPosition);
export function validDockingLayout(value: unknown): value is DockingLayout {
  if (!value || typeof value !== "object") return false;
  const layout = value as Partial<DockingLayout>;
  return (
    isPosition(layout.navigation) && isPosition(layout.tabs) && layout.navigation !== layout.tabs
  );
}
interface DockingState {
  /** Previous device-wide choice, used only for windows without their own layout. */
  initialLayout: DockingLayout;
  savedLayouts: SavedDockingLayout[];
  saveLayout(name: string, layout: DockingLayout): string | null;
  removeLayout(id: string): void;
}
export const useDockingLayoutStore = create<DockingState>()(
  persist(
    (set, get) => ({
      initialLayout: defaultDockingLayout,
      savedLayouts: [],
      saveLayout: (name, layout) => {
        if (!validDockingLayout(layout)) return null;
        const trimmed = name.trim().slice(0, 40);
        if (!trimmed) return null;
        const existing = get().savedLayouts.find(
          (layout) => layout.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase(),
        );
        const id = existing?.id ?? crypto.randomUUID();
        const saved = { navigation: layout.navigation, tabs: layout.tabs, id, name: trimmed };
        set({
          savedLayouts: existing
            ? get().savedLayouts.map((item) => (item.id === id ? saved : item))
            : [...get().savedLayouts, saved],
        });
        return id;
      },
      removeLayout: (id) =>
        set({ savedLayouts: get().savedLayouts.filter((item) => item.id !== id) }),
    }),
    {
      name: "misty:desktop-docking:v1",
      partialize: ({ initialLayout, savedLayouts }) => ({ initialLayout, savedLayouts }),
      merge: (persisted, current) => {
        const saved = persisted as (Partial<DockingState> & { layout?: DockingLayout }) | null;
        const initialLayout = saved?.initialLayout ?? saved?.layout;
        return {
          ...current,
          initialLayout: validDockingLayout(initialLayout) ? initialLayout : defaultDockingLayout,
          savedLayouts: Array.isArray(saved?.savedLayouts)
            ? saved.savedLayouts.filter(
                (item) =>
                  validDockingLayout(item) &&
                  typeof item.id === "string" &&
                  typeof item.name === "string" &&
                  item.name.trim(),
              )
            : [],
        };
      },
    },
  ),
);
