import { cleanup, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultDockingLayout, useDockingLayoutStore } from "@/features/app-shell/dockingLayout";
import { useWorkspaceStore } from "@/features/workspace";
import { useWindowDockingLayout } from "@/features/workspace/useWindowDockingLayout";
import { settingsPage, canonicalSettingsSection } from "../settingsRegistry";
import type { SettingsContentProps } from "../settingsTypes";
import { AppearanceSection } from "./AppearanceSection";

const props: SettingsContentProps = {
  document: {},
  launchOnLogin: null,
  working: false,
  onSettingChange: vi.fn(),
  onLoad: vi.fn(async () => undefined),
  onShortcutChange: vi.fn(async () => undefined),
  onShortcutReassign: vi.fn(async () => undefined),
  onResetShortcuts: vi.fn(async () => undefined),
  shortcuts: null,
  app: null,
};

beforeEach(() => {
  useDockingLayoutStore.setState({ initialLayout: defaultDockingLayout, savedLayouts: [] });
  useWorkspaceStore.getState().reset();
});
afterEach(cleanup);

const chooseTabs = (side: "Left" | "Right") =>
  fireEvent.click(
    within(screen.getByRole("radiogroup", { name: "Tabs" })).getByRole("radio", { name: side }),
  );

it("moves this window's tab sidebar between the left and the right from Appearance", () => {
  render(<AppearanceSection {...props} />);
  const { result } = renderHook(useWindowDockingLayout);
  chooseTabs("Right");
  expect(result.current).toEqual({ tabs: "right", navigation: "left" });
  chooseTabs("Left");
  expect(result.current).toEqual({ tabs: "left", navigation: "right" });
});

it("has no Layout page of its own; old links open Appearance", () => {
  expect(settingsPage("layout")).toBeUndefined();
  expect(canonicalSettingsSection("layout")).toBe("appearance");
});
