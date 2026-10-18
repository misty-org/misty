import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FirstRunSetup } from "./FirstRunSetup";
import { isSetupCompletedForAccount, setupStorageKey, useSetupStore } from "./useSetupStore";

const mocks = vi.hoisted(() => ({
  native: false,
  suspend: vi.fn(),
  updateSetting: vi.fn(),
  setLayout: vi.fn(),
  layout: { navigation: "left", tabs: "top" },
}));
vi.mock("@/features/auth", () => ({
  useAuth: () => ({ user: { id: "account-1" }, transitioning: false }),
}));
vi.mock("@/features/webviews/browserRuntime", () => ({
  setBrowserWebviewsSuspended: mocks.suspend,
}));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => mocks.native }));
vi.mock("@/features/settings", () => ({
  selectAppearancePreferences: () => ({ themeMode: "dark" }),
  useSettingsStore: (select: (state: unknown) => unknown) =>
    select({ settings: null, updateSetting: mocks.updateSetting }),
}));
vi.mock("@/features/workspace", () => ({
  useWindowDockingLayout: () => mocks.layout,
  useWorkspaceStore: (select: (state: unknown) => unknown) =>
    select({ setWindowDockingLayout: mocks.setLayout }),
}));
vi.mock("@/features/browser-import", () => ({
  BrowserImportFlow: (props: { onClose(): void; closeLabel?: string }) => (
    <button type="button" onClick={props.onClose}>
      {props.closeLabel}
    </button>
  ),
}));

beforeEach(() => {
  localStorage.clear();
  useSetupStore.setState({ isOpen: false, step: "spaces", completedAccounts: {} });
  mocks.native = false;
  vi.clearAllMocks();
});
afterEach(cleanup);

it("introduces Spaces, asks for a layout with no default, then a theme, and finishes", () => {
  render(<FirstRunSetup />);
  act(() => useSetupStore.getState().startSetup());
  expect(screen.getByText("Meet Spaces")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));

  expect(screen.getByText("Choose a layout")).toBeTruthy();
  expect(screen.getByRole("radio", { name: /Horizontal tabs/ }).getAttribute("aria-checked")).toBe(
    "false",
  );
  expect(screen.getByRole("radio", { name: /Vertical tabs/ }).getAttribute("aria-checked")).toBe(
    "false",
  );
  expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  fireEvent.click(screen.getByRole("radio", { name: /Vertical tabs/ }));
  expect(mocks.setLayout).toHaveBeenCalledWith({ navigation: "right", tabs: "left" });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));

  expect(screen.getByText("Choose a theme")).toBeTruthy();
  fireEvent.click(screen.getByRole("radio", { name: /Light/ }));
  expect(mocks.updateSetting).toHaveBeenCalledWith("appearance", "theme_mode", "light");
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.queryByText("Choose a theme")).toBeNull();
  expect(isSetupCompletedForAccount(useSetupStore.getState(), "account-1")).toBe(true);
  expect(isSetupCompletedForAccount(useSetupStore.getState(), "account-2")).toBe(false);
});

it("ends with importing from another browser in the desktop app", () => {
  mocks.native = true;
  render(<FirstRunSetup />);
  act(() => useSetupStore.getState().startSetup());
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("radio", { name: /Horizontal tabs/ }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByText("Import from your browser")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Skip" }));
  expect(isSetupCompletedForAccount(useSetupStore.getState(), "account-1")).toBe(true);
});

it("can be skipped, and hides page views while open", () => {
  render(<FirstRunSetup />);
  act(() => useSetupStore.getState().startSetup());
  expect(mocks.suspend).toHaveBeenLastCalledWith(true, "first-run-setup");
  fireEvent.click(screen.getByRole("button", { name: "Skip setup" }));
  expect(mocks.suspend).toHaveBeenLastCalledWith(false, "first-run-setup");
  expect(isSetupCompletedForAccount(useSetupStore.getState(), "account-1")).toBe(true);
});

it("treats accounts that finished the old walkthrough as already set up", async () => {
  localStorage.setItem(
    "misty-app-tour",
    JSON.stringify({ state: { completedAccounts: { "account-1": true } }, version: 0 }),
  );
  localStorage.removeItem(setupStorageKey);
  await useSetupStore.persist.rehydrate();
  expect(isSetupCompletedForAccount(useSetupStore.getState(), "account-1")).toBe(true);
});
