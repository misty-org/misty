import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { useDockingLayoutStore, defaultDockingLayout } from "@/features/app-shell/dockingLayout";
import { LayoutSection } from "./LayoutSection";
import { useWorkspaceStore } from "@/features/workspace";
import { useWindowDockingLayout } from "@/features/workspace/useWindowDockingLayout";
import { renderHook } from "@testing-library/react";

beforeEach(() => {
  useDockingLayoutStore.setState({ initialLayout: defaultDockingLayout, savedLayouts: [] });
  useWorkspaceStore.getState().reset();
});
afterEach(cleanup);
it("disables occupied edges in both directions and updates them with presets", () => {
  render(<LayoutSection />);
  const nav = within(screen.getByRole("group", { name: "Navigation" }));
  const tabs = within(screen.getByRole("group", { name: "Tabs" }));
  expect((nav.getByRole("button", { name: "top" }) as HTMLButtonElement).disabled).toBe(true);
  expect((tabs.getByRole("button", { name: "left" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Bottom dock" }));
  expect((tabs.getByRole("button", { name: "bottom" }) as HTMLButtonElement).disabled).toBe(true);
  expect((nav.getByRole("button", { name: "left" }) as HTMLButtonElement).disabled).toBe(true);
  expect((tabs.getByRole("button", { name: "top" }) as HTMLButtonElement).disabled).toBe(false);
});
it("saves, restores, and deletes a named layout", () => {
  render(<LayoutSection />);
  fireEvent.click(screen.getByRole("button", { name: "Right rail" }));
  fireEvent.change(screen.getByLabelText("Save as a preset"), { target: { value: "Writing" } });
  fireEvent.click(screen.getByRole("button", { name: "Save preset" }));
  fireEvent.click(screen.getByRole("button", { name: "Reset to Classic" }));
  fireEvent.click(screen.getByRole("button", { name: "Writing" }));
  expect(screen.getByRole("button", { name: "Right rail" }).getAttribute("aria-pressed")).toBe(
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: "Delete layout Writing" }));
  expect(screen.queryByRole("button", { name: "Writing" })).toBeNull();
});

it("edits the current virtual window and restores its own arrangement when switching", () => {
  const firstId = useWorkspaceStore.getState().activeVirtualWindowId;
  render(<LayoutSection />);
  const { result } = renderHook(useWindowDockingLayout);
  fireEvent.click(screen.getByRole("button", { name: "Bottom dock" }));
  expect(result.current).toEqual({ navigation: "bottom", tabs: "left" });
  act(() => {
    useWorkspaceStore.getState().createVirtualWindow("Research");
  });
  expect(screen.getByRole("heading", { name: "Layout for Research" })).toBeTruthy();
  expect(result.current).toEqual(defaultDockingLayout);
  fireEvent.click(screen.getByRole("button", { name: "Right rail" }));
  expect(result.current).toEqual({ navigation: "right", tabs: "bottom" });
  act(() => {
    useWorkspaceStore.getState().switchVirtualWindow(firstId);
  });
  expect(result.current).toEqual({ navigation: "bottom", tabs: "left" });
  expect(screen.getByRole("button", { name: "Bottom dock" }).getAttribute("aria-pressed")).toBe(
    "true",
  );
});
