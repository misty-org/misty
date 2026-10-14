import { registerProfileWriter } from "../profiles/bridge";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useDockingLayoutStore, defaultDockingLayout } from "@/features/app-shell/dockingLayout";
import { useSettingsProfiles } from "../profiles/store";
import { searchSettings } from "../components/SettingsSearchResults";
import { LayoutSection } from "./LayoutSection";
import { useWorkspaceStore } from "@/features/workspace";
import { useWindowDockingLayout } from "@/features/workspace/useWindowDockingLayout";

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
const chooseTabs = (orientation: "Horizontal" | "Vertical") =>
  fireEvent.click(
    within(screen.getByRole("radiogroup", { name: "Tabs" })).getByRole("radio", {
      name: orientation,
    }),
  );

it("has no navigation controls: the tab strip carries the navigation", () => {
  render(<LayoutSection />);
  expect(screen.queryByRole("radiogroup", { name: "Navigation position" })).toBeNull();
  expect(screen.queryByText("Auto-hide navigation")).toBeNull();
});
it("switches tabs between horizontal and vertical", () => {
  render(<LayoutSection />);
  const { result } = renderHook(useWindowDockingLayout);
  chooseTabs("Vertical");
  expect(result.current.tabs).toBe("left");
  chooseTabs("Horizontal");
  expect(result.current.tabs).toBe("top");
});
it("saves the current layout by name and lists it for reuse", async () => {
  useSettingsProfiles.setState({ ready: true });
  render(<LayoutSection />);
  chooseTabs("Vertical");
  fireEvent.change(screen.getByRole("textbox", { name: "Layout name" }), {
    target: { value: "Focus" },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
  });
  expect(useDockingLayoutStore.getState().savedLayouts).toEqual([
    expect.objectContaining({ name: "Focus", tabs: "left" }),
  ]);
  expect(searchSettings("Saved layouts")).toContainEqual(
    expect.objectContaining({ page: "layout" }),
  );
});
it("edits the current virtual window and restores its arrangement when switching", () => {
  const firstId = useWorkspaceStore.getState().activeWindowId;
  render(<LayoutSection />);
  const { result } = renderHook(useWindowDockingLayout);
  chooseTabs("Vertical");
  expect(result.current.tabs).toBe("left");
  act(() => {
    useWorkspaceStore.getState().createWindow("Research");
  });
  expect(screen.getByRole("heading", { name: "Layout for Research" })).toBeTruthy();
  expect(result.current).toEqual(defaultDockingLayout);
  act(() => {
    useWorkspaceStore.getState().switchWindow(firstId);
  });
  expect(result.current.tabs).toBe("left");
});
