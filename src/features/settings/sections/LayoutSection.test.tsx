import { registerProfileWriter } from "../profiles/bridge";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useDockingLayoutStore, defaultDockingLayout } from "@/features/app-shell/dockingLayout";
import { useSettingsStore } from "../store/useSettingsStore";
import { useSettingsProfiles } from "../profiles/store";
import { searchSettings } from "../components/SettingsSearchResults";
import { LayoutSection } from "./LayoutSection";
import { useWorkspaceStore } from "@/features/workspace";
import { useWindowDockingLayout } from "@/features/workspace/useWindowDockingLayout";
import { renderHook } from "@testing-library/react";

beforeEach(() => {
  registerProfileWriter(async (id, value) => {
    if (id === "app.layout.presets")
      useDockingLayoutStore.setState({ savedLayouts: JSON.parse(String(value)) });
  });
  useDockingLayoutStore.setState({ initialLayout: defaultDockingLayout, savedLayouts: [] });
  useWorkspaceStore.getState().reset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const choose = (group: string, edge: string) =>
  fireEvent.click(
    within(screen.getByRole("radiogroup", { name: group })).getByRole("radio", { name: edge }),
  );
it.each(["Left", "Top", "Right", "Bottom"])(
  "allows navigation and tabs to share the %s edge",
  (edge) => {
    render(<LayoutSection />);
    const { result } = renderHook(useWindowDockingLayout);
    choose("Navigation position", edge);
    choose("Tabs position", edge);
    expect(result.current).toEqual({ navigation: edge.toLowerCase(), tabs: edge.toLowerCase() });
    expect(
      screen.getAllByRole("radio").every((radio) => !(radio as HTMLButtonElement).disabled),
    ).toBe(true);
  },
);
it("has no preset controls or orphaned saved-layout search result", () => {
  render(<LayoutSection />);
  expect(screen.queryByText(/preset/i)).toBeNull();
  expect(screen.queryByRole("button", { name: /classic|bottom dock|right rail/i })).toBeNull();
  expect(searchSettings("Saved layouts")).not.toContainEqual(
    expect.objectContaining({ focus: "Saved layouts" }),
  );
});
it("edits the current virtual window and restores its arrangement when switching", () => {
  const firstId = useWorkspaceStore.getState().activeWindowId;
  render(<LayoutSection />);
  const { result } = renderHook(useWindowDockingLayout);
  choose("Navigation position", "Bottom");
  choose("Tabs position", "Left");
  expect(result.current).toEqual({ navigation: "bottom", tabs: "left" });
  act(() => {
    useWorkspaceStore.getState().createWindow("Research");
  });
  expect(screen.getByRole("heading", { name: "Layout for Research" })).toBeTruthy();
  expect(result.current).toEqual(defaultDockingLayout);
  choose("Navigation position", "Right");
  choose("Tabs position", "Bottom");
  expect(result.current).toEqual({ navigation: "right", tabs: "bottom" });
  act(() => {
    useWorkspaceStore.getState().switchWindow(firstId);
  });
  expect(result.current).toEqual({ navigation: "bottom", tabs: "left" });
  expect(
    within(screen.getByRole("radiogroup", { name: "Navigation position" }))
      .getByRole("radio", {
        name: "Bottom",
      })
      .getAttribute("aria-checked"),
  ).toBe("true");
});

it("saves navigation visibility through account settings and appears in Layout search", () => {
  useSettingsProfiles.setState({ ready: true });
  useSettingsStore.setState({ working: false });
  const update = vi
    .spyOn(useSettingsStore.getState(), "updateSetting")
    .mockImplementation(() => {});
  render(<LayoutSection />);
  fireEvent.click(screen.getByRole("switch", { name: "Auto-hide navigation" }));
  expect(update).toHaveBeenCalledWith("appearance", "navigator_auto_hide", true);
  expect(searchSettings("Auto-hide navigation")).toContainEqual(
    expect.objectContaining({ page: "layout", focus: "Auto-hide navigation" }),
  );
});

it("supports same-edge selection with pill keyboard shortcuts", () => {
  render(<LayoutSection />);
  choose("Tabs position", "Bottom");
  const nav = screen.getByRole("radiogroup", { name: "Navigation position" });
  fireEvent.keyDown(nav, { key: "End" });
  expect(within(nav).getByRole("radio", { name: "Bottom" }).getAttribute("aria-checked")).toBe(
    "true",
  );
  expect(within(nav).getByRole("radio", { name: "Right" }).getAttribute("aria-checked")).toBe(
    "false",
  );
});
