import { registerProfileWriter } from "@/features/settings/profiles/bridge";
import { beforeEach, expect, it } from "vitest";
import {
  dockPositions,
  dockingPresets,
  defaultDockingLayout,
  useDockingLayoutStore,
  validDockingLayout,
} from "./dockingLayout";

beforeEach(() => {
  registerProfileWriter(async (_id, value) => {
    useDockingLayoutStore.setState({ savedLayouts: JSON.parse(String(value)) });
  });
  localStorage.clear();
  useDockingLayoutStore.setState({ initialLayout: defaultDockingLayout, savedLayouts: [] });
});
it("accepts all sixteen edge pairs, including shared edges", () => {
  for (const navigation of dockPositions)
    for (const tabs of dockPositions) expect(validDockingLayout({ navigation, tabs })).toBe(true);
  for (const preset of dockingPresets) expect(validDockingLayout(preset)).toBe(true);
});
it("restores named presets without changing the default for other windows", async () => {
  await useDockingLayoutStore.getState().saveLayout("  Focus  ", dockingPresets[2]);
  const stored = localStorage.getItem("misty:desktop-docking:v1")!;
  useDockingLayoutStore.setState({ savedLayouts: [] });
  localStorage.setItem("misty:desktop-docking:v1", stored);
  await useDockingLayoutStore.persist.rehydrate();
  expect(useDockingLayoutStore.getState().initialLayout).toEqual(defaultDockingLayout);
  expect(useDockingLayoutStore.getState().savedLayouts).toEqual([
    expect.objectContaining({ name: "Focus", navigation: "bottom", tabs: "left" }),
  ]);
});
it("updates a named preset without duplicates and allows deleting it", async () => {
  const state = useDockingLayoutStore.getState();
  expect(await state.saveLayout(" ", defaultDockingLayout)).toBeNull();
  expect(validDockingLayout({ navigation: "center", tabs: "top" })).toBe(false);
  const id = await state.saveLayout("Focus", defaultDockingLayout);
  expect(await state.saveLayout("focus", dockingPresets[3])).toBe(id);
  expect(useDockingLayoutStore.getState().savedLayouts).toHaveLength(1);
  expect(useDockingLayoutStore.getState().savedLayouts[0].navigation).toBe("right");
  await state.removeLayout(id!);
  expect(useDockingLayoutStore.getState().savedLayouts).toEqual([]);
});
it("preserves the old global choice as the initial layout for unmigrated windows", async () => {
  localStorage.setItem(
    "misty:desktop-docking:v1",
    JSON.stringify({
      state: { layout: dockingPresets[2], savedLayouts: [dockingPresets[1]] },
      version: 0,
    }),
  );
  await useDockingLayoutStore.persist.rehydrate();
  expect(useDockingLayoutStore.getState().initialLayout).toEqual(dockingPresets[2]);
  expect(useDockingLayoutStore.getState().savedLayouts).toEqual([dockingPresets[1]]);
});
it("repairs invalid stored edges and discards malformed named layouts", async () => {
  localStorage.setItem(
    "misty:desktop-docking:v1",
    JSON.stringify({
      state: {
        layout: { navigation: "center", tabs: "bottom" },
        savedLayouts: [
          null,
          { id: "bad", name: "Bad", navigation: "center", tabs: "top" },
          dockingPresets[1],
        ],
      },
      version: 0,
    }),
  );
  await useDockingLayoutStore.persist.rehydrate();
  expect(useDockingLayoutStore.getState().initialLayout).toEqual(defaultDockingLayout);
  expect(useDockingLayoutStore.getState().savedLayouts).toEqual([dockingPresets[1]]);
});
