import { beforeEach, expect, it, vi } from "vitest";
import { settleDeviceSettings } from "@/tests/fakeDeviceSettings";

const db = await vi.hoisted(async () =>
  (await import("@/tests/fakeDeviceSettings")).fakeDeviceSettings(),
);
vi.mock("@/shared/platform/nativeInvoke", () => ({ invoke: db.invoke }));

import {
  defaultDockingLayout,
  rememberDockingLayout,
  useDockingLayoutStore,
} from "./dockingLayout";

beforeEach(async () => {
  await settleDeviceSettings();
  db.reset();
  localStorage.clear();
});

it("opens new windows with the tab side last chosen, kept in misty.db", async () => {
  rememberDockingLayout({ navigation: "left", tabs: "right" });
  expect(useDockingLayoutStore.getState().initialLayout).toEqual({
    navigation: "left",
    tabs: "right",
  });
  await settleDeviceSettings();
  expect(db.read("docking-layout")).toEqual({ navigation: "left", tabs: "right" });
});

it("starts a new window from the side another window saved, reading an old layout as the left", async () => {
  db.write("docking-layout", { navigation: "left", tabs: "right" });
  vi.resetModules();
  const fresh = await import("./dockingLayout");
  await settleDeviceSettings();
  expect(fresh.useDockingLayoutStore.getState().initialLayout).toEqual({
    navigation: "left",
    tabs: "right",
  });

  // Tabs once could run along the top; that layout now puts them on the left.
  db.write("docking-layout", { navigation: "left", tabs: "top" });
  vi.resetModules();
  const older = await import("./dockingLayout");
  await settleDeviceSettings();
  expect(older.useDockingLayoutStore.getState().initialLayout).toEqual(defaultDockingLayout);
});
