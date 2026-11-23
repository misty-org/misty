import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createDeviceSetting } from "@/shared/lib/device_setting";

export const tabSides = ["left", "right"] as const;
export type TabSide = (typeof tabSides)[number];
export interface DockingLayout {
  navigation: TabSide;
  tabs: TabSide;
}
export interface SavedDockingLayout extends DockingLayout {
  id: string;
  name: string;
}
export interface StoredDockingLayout {
  navigation: string;
  tabs: string;
}
export const defaultDockingLayout: DockingLayout = { navigation: "right", tabs: "left" };
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

const newWindowLayout = createDeviceSetting<DockingLayout>({
  scope: "docking-layout",
  defaults: defaultDockingLayout,
  normalize: (stored) =>
    validDockingLayout(stored) ? normalizeDockingLayout(stored) : defaultDockingLayout,
  seed: () => useDockingLayoutStore.getState().initialLayout,
});
newWindowLayout.subscribe((state) => {
  if (state.loaded) useDockingLayoutStore.setState({ initialLayout: state.value });
});

export function rememberDockingLayout(layout: DockingLayout) {
  useDockingLayoutStore.setState({ initialLayout: layout });
  newWindowLayout.getState().set(layout);
}
